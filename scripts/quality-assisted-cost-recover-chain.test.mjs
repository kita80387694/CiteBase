import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sha,save,read} from './phase2-client.mjs';
import {BASELINE,register} from './quality-assisted-cost-independent.mjs';
import {guardRecovery,prepareRecovery,recover,verifyManifest,comparableCalls} from './quality-assisted-cost-recover.mjs';

import {prepareChain,recoverChain,verifyChain} from './quality-assisted-cost-recover-chain.mjs';
import {loadCostIndependent} from './quality-cost-independent-packets.mjs';
function fixture(cache = false) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cost-recovery-')),root=path.join(dir,'old'),recoveryRoot=path.join(dir,'recovery');
 fs.mkdirSync(path.join(root,'runs'),{recursive:true});fs.mkdirSync(path.join(root,'tasks'));fs.mkdirSync(recoveryRoot);
 const selected={...BASELINE,candidateK:5,rerankPolicy:'candidate-pressure-v1'};
 if(cache)selected.cache=true;
 const dataset={version:'fixture',questions:Array.from({length:40},(_,i)=>({id:`q${i}`,split:'test',answerable:i%2===0,question:`fixture ${i}`,evidence:[]}))};
 const values={dev:Buffer.from(JSON.stringify({source:'ASSISTED',complete:true,qualitySelectable:true,eligibleByAssistedGates:true,decision:'QUALITY_ELIGIBLE',selectedOptions:selected})),dataset:Buffer.from(JSON.stringify(dataset)),manifest:Buffer.from(JSON.stringify({documents:Array.from({length:12},(_,i)=>({documentName:`d${i}.md`,sourceHash:'f'.repeat(64)}))}))};
 const runtime={commit:'a'.repeat(40),sourceSha256:'b'.repeat(64),containerName:'fixture',containerImageId:'sha256:'+'c'.repeat(64),containerId:'d'.repeat(64),startedAt:'2026-10-01T00:00:00Z',apiUrl:'http://localhost:28096',modelConfig:{chatModel:'chat',embeddingModel:'embedding',reranker:{model:'rerank'}}};
 const freeze={schema:'citebase-assisted-cost-independent-freeze-v1',frozenAt:'2026-10-01',devReport:{file:'dev',sha256:sha(values.dev)},dataset:{file:'dataset',sha256:sha(values.dataset)},manifest:{file:'manifest',sha256:sha(values.manifest)},baselineOptions:BASELINE,selectedOptions:selected,runtime,chunkProfile:{strategy:'structure-v1',size:900,overlap:200}};
 const bytes=f=>values[f],plan=register(freeze,runtime,bytes),current={...runtime,startedAt:'2026-10-10T00:00:00Z'};
 const docs=[{id:'doc',activeVersionId:'v1'}],snapshot=[{id:'doc',version_id:'v1'}],prefix=`CostIndependent-${sha(JSON.stringify(plan)).slice(0,20)}`;
 save(path.join(root,'registration.json'),plan);save(path.join(root,'state.json'),{registrationSha256:sha(JSON.stringify(plan)),kbId:'kb',indexed:true,smokeCompleted:true,documents:docs});save(path.join(root,'snapshot.json'),snapshot);
 const spec=item=>({root:path.join(root,'runs'),id:`${prefix}-${item.batchId}-${item.arm}`,kbId:'kb',dataset:{version:dataset.version,questions:item.questions.map(x=>({...dataset.questions.find(q=>q.id===item.baseCaseId),id:x.caseId}))},options:item.arm==='control'?BASELINE:selected,topK:5,runtime});
 const makeRun=(s,id,status='COMPLETED')=>({id,name:`p2opt-${s.id}`,taskId:id,status,config:{...runtime.modelConfig,topK:5,dataset:s.dataset,retrievalOptions:s.options,dataVersions:snapshot},results:s.dataset.questions.flatMap(q=>['vector','hybrid'].map(mode=>({caseId:q.id,mode,error:null,answer:'immutable checkpoint'}))),externalCalls:[]});
 const journal=(s,id)=>({id:s.id,spec:{kbId:s.kbId,datasetSha256:sha(JSON.stringify(s.dataset)),options:s.options,topK:s.topK,runtime:s.runtime},expectedRows:s.dataset.questions.length*2,runId:id,status:'RUNNING',createdAt:new Date(Date.parse(s.runtime.startedAt)+1000).toISOString()});
 const old=spec(plan.items[0]),interrupted=spec(plan.items[1]),fresh=spec(plan.items[2]);
 const oldRun=makeRun(old,'old-run');save(path.join(old.root,`${old.id}.raw.json`),oldRun);const oldJournal=journal(old,oldRun.id);oldJournal.rawSha256=sha(fs.readFileSync(path.join(old.root,`${old.id}.raw.json`)));save(path.join(old.root,`${old.id}.state.json`),oldJournal);
 const run=makeRun(interrupted,'interrupted-run','FAILED');run.results[1].error='ATTEMPTS_EXHAUSTED';run.externalCalls=[{callId:'unknown-call',status:'UNKNOWN',usage:null,outcome:'PROCESS_INTERRUPTED'}];
 const task={id:run.id,kind:'EVALUATION',status:'FAILED',kbId:'kb',externalCalls:run.externalCalls,payload:{kbId:'kb',name:run.name,dataset:interrupted.dataset,retrievalOptions:interrupted.options,topK:5}};
 save(path.join(interrupted.root,`${interrupted.id}.state.json`),journal(interrupted,run.id));save(path.join(recoveryRoot,'interrupted-evaluation.json'),run);save(path.join(recoveryRoot,'interrupted-task.json'),task);
 for(const item of [old,interrupted]){const config={...makeRun(item,'x').config};delete config.dataset;save(path.join(root,`${item.options===BASELINE?'control':'candidate'}-config.json`),config);}
 return {dir,root,recoveryRoot,bytes,plan,current,runtime,docs,old,interrupted,fresh,run,makeRun,journal,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}

async function chainFixture(status='FAILED'){
 const x=fixture();
 await assert.rejects(recover(x.root,x.recoveryRoot,x.plan,x.current,{request:async()=>x.docs},{bytes:x.bytes,guard:()=>{},collector:async()=>{
  const spec={...x.fresh,runtime:x.current};save(path.join(spec.root,`${spec.id}.state.json`),x.journal(spec,'second-run'));throw new Error('simulated second crash');
 }}),/second crash/);
 const nextRoot=path.join(x.dir,'next');fs.mkdirSync(nextRoot);
 const run=x.makeRun(x.fresh,'second-run',status);if(status==='FAILED')for(const row of run.results)row.error='ATTEMPTS_EXHAUSTED';
 run.externalCalls=[{callId:'late-call',status:'UNKNOWN',usage:null}];
 const task={id:run.id,kind:'EVALUATION',status:status==='COMPLETED'?'SUCCEEDED':status,kbId:'kb',externalCalls:run.externalCalls,payload:{kbId:'kb',name:run.name,dataset:x.fresh.dataset,retrievalOptions:x.fresh.options,topK:5}};
 save(path.join(nextRoot,'interrupted-evaluation.json'),run);save(path.join(nextRoot,'interrupted-task.json'),task);
 return {...x,nextRoot,nextRuntime:{...x.current,startedAt:'2026-10-19T00:00:00Z'},secondRun:run};
}
test('second recovery preserves all old hashes and adopts all-failed terminal run without calls',async()=>{
 const x=await chainFixture();try{
  const oldState=fs.readFileSync(path.join(x.root,'state.json'));let calls=0;
  const result=await recoverChain(x.root,x.nextRoot,x.recoveryRoot,x.plan,x.nextRuntime,{request:async()=>x.docs},{bytes:x.bytes,guard:()=>{},evaluate:async()=>{calls++;throw new Error('must not call');},collector:async(s,r,p,a,{evaluate})=>{
   assert.equal((await evaluate(a,x.old)).id,'old-run');assert.equal((await evaluate(a,x.interrupted)).id,'interrupted-run');assert.deepEqual(await evaluate(a,x.fresh),x.secondRun);return {collectionCompleted:true};
  }});
  assert.equal(calls,0);assert(result.collectionCompleted);assert.deepEqual(fs.readFileSync(path.join(x.root,'state.json')),oldState);
  const m=read(path.join(x.nextRoot,'manifest.json'));assert.equal(verifyChain(m).length,3);assert.equal(m.interrupted.externalCalls[0].usage,null);assert.equal(m.interrupted.externalCalls[0].status,'UNKNOWN');
  assert.deepEqual(prepareChain(x.root,x.nextRoot,x.recoveryRoot,x.plan,x.nextRuntime,{bytes:x.bytes}),m);
 }finally{x.cleanup();}
});
test('already successful terminal run is adopted without re-submission',async()=>{
 const x=await chainFixture('COMPLETED');try{
  let calls=0;await recoverChain(x.root,x.nextRoot,x.recoveryRoot,x.plan,x.nextRuntime,{request:async()=>x.docs},{bytes:x.bytes,guard:()=>{},evaluate:async()=>calls++,collector:async(s,r,p,a,{evaluate})=>{assert.equal((await evaluate(a,x.fresh)).status,'COMPLETED');return {};}});assert.equal(calls,0);
 }finally{x.cleanup();}
});
test('rejects changed runtime, non-increasing segment, and unregistered journal before manifest creation',async()=>{
 for(const mutate of ['runtime','time','journal']){
  const x=await chainFixture();try{
   if(mutate==='runtime')x.nextRuntime.containerId='changed';
   if(mutate==='time')x.nextRuntime.startedAt=x.current.startedAt;
   if(mutate==='journal'){const f=path.join(x.fresh.root,`${x.fresh.id}.state.json`),j=read(f);j.spec.runtime={...x.current,sourceSha256:'changed'};save(f,j);}
   assert.throws(()=>prepareChain(x.root,x.nextRoot,x.recoveryRoot,x.plan,x.nextRuntime,{bytes:x.bytes}));assert(!fs.existsSync(path.join(x.nextRoot,'manifest.json')));
  }finally{x.cleanup();}
 }
});
test('hash chain detects mutations to previous manifest, previous records and terminal exports',async()=>{
 for(const target of ['manifest','raw','export']){
  const x=await chainFixture();try{
   const m=prepareChain(x.root,x.nextRoot,x.recoveryRoot,x.plan,x.nextRuntime,{bytes:x.bytes});
   const f=target==='manifest'?path.join(x.recoveryRoot,'manifest.json'):target==='raw'?path.join(x.fresh.root,`${x.old.id}.raw.json`):path.join(x.nextRoot,'interrupted-evaluation.json');fs.appendFileSync(f,' ');assert.throws(()=>verifyChain(m),/changed/);
  }finally{x.cleanup();}
 }
});
test('run identity, duplicate keys, snapshot and external audit drift are rejected',async()=>{
 for(const mutate of [r=>r.id='wrong',r=>r.results.push(r.results[0]),r=>r.config.dataVersions[0].version_id='changed',r=>r.externalCalls=[]]){
  const x=await chainFixture();try{const f=path.join(x.nextRoot,'interrupted-evaluation.json'),r=read(f);mutate(r);save(f,r);assert.throws(()=>prepareChain(x.root,x.nextRoot,x.recoveryRoot,x.plan,x.nextRuntime,{bytes:x.bytes}));}finally{x.cleanup();}
 }
});
test('third restart extends chain and only a new task uses new runtime',async()=>{
 const x=await chainFixture();try{
  const makeSpec=item=>({root:x.fresh.root,id:`CostIndependent-${sha(JSON.stringify(x.plan)).slice(0,20)}-${item.batchId}-${item.arm}`,kbId:'kb',dataset:{version:x.fresh.dataset.version,questions:item.questions.map(q=>({...JSON.parse(x.bytes('dataset')).questions.find(v=>v.id===item.baseCaseId),id:q.caseId}))},options:item.arm==='control'?x.plan.freeze.baselineOptions:x.plan.freeze.selectedOptions,topK:5,runtime:x.nextRuntime});
  const third=makeSpec(x.plan.items[3]);
  await assert.rejects(recoverChain(x.root,x.nextRoot,x.recoveryRoot,x.plan,x.nextRuntime,{request:async()=>x.docs},{bytes:x.bytes,guard:()=>{},collector:async()=>{save(path.join(third.root,`${third.id}.state.json`),x.journal(third,'third-run'));throw new Error('third crash');}}),/third crash/);
  const thirdRoot=path.join(x.dir,'third');fs.mkdirSync(thirdRoot);const run=x.makeRun(third,'third-run','FAILED');run.results.forEach(r=>r.error='ATTEMPTS_EXHAUSTED');
  save(path.join(thirdRoot,'interrupted-evaluation.json'),run);save(path.join(thirdRoot,'interrupted-task.json'),{id:run.id,kind:'EVALUATION',status:'FAILED',kbId:'kb',externalCalls:[],payload:{kbId:'kb',name:run.name,dataset:third.dataset,retrievalOptions:third.options,topK:5}});
  const runtime={...x.nextRuntime,startedAt:'2026-10-20T00:00:00Z'};let calls=0;
  const newer=makeSpec(x.plan.items[4]);
  await recoverChain(x.root,thirdRoot,x.nextRoot,x.plan,runtime,{request:async()=>x.docs},{bytes:x.bytes,guard:()=>{},evaluate:async(a,s)=>{calls++;assert.deepEqual(s.runtime,runtime);const result=x.makeRun(s,'new');save(path.join(s.root,`${s.id}.state.json`),x.journal(s,result.id));save(path.join(s.root,`${s.id}.raw.json`),result);return result;},collector:async(s,r,p,a,{evaluate})=>{assert.equal((await evaluate(a,third)).id,'third-run');await evaluate(a,newer);return {};}});
  assert.equal(calls,1);assert.equal(verifyChain(read(path.join(thirdRoot,'manifest.json'))).length,4);
  const report=loadCostIndependent(x.root,false,thirdRoot);assert.equal(report.runtimeProvenance.segments.length,4);assert.equal(report.runtimeProvenance.continuousLatencyComparable,false);assert(report.runtimeProvenance.rowSources.every(row=>row.runtime&&row.inputs.length===2));
 }finally{x.cleanup();}
});
test('new unresolved submission is never resubmitted and restores original state',async()=>{
 const x=await chainFixture();try{
  let calls=0;const original=fs.readFileSync(path.join(x.root,'state.json'));
  await assert.rejects(recoverChain(x.root,x.nextRoot,x.recoveryRoot,x.plan,x.nextRuntime,{request:async()=>x.docs},{bytes:x.bytes,guard:()=>{},evaluate:async()=>calls++,collector:async(s,r,p,a,{evaluate})=>{
   const unknown={...x.fresh,id:'unresolved',runtime:x.nextRuntime};save(path.join(unknown.root,`${unknown.id}.state.json`),x.journal(unknown,'unknown-run'));
   await evaluate(a,unknown);
  }}),/Unresolved submission/);
  assert.equal(calls,0);assert.deepEqual(fs.readFileSync(path.join(x.root,'state.json')),original);
 }finally{x.cleanup();}
});
test('journal cannot claim a known runtime whose time window excludes its creation',async()=>{
 const x=await chainFixture();try{
  const f=path.join(x.fresh.root,`${x.fresh.id}.state.json`),j=read(f);j.spec.runtime=x.runtime;save(f,j);
  assert.throws(()=>prepareChain(x.root,x.nextRoot,x.recoveryRoot,x.plan,x.nextRuntime,{bytes:x.bytes}),/creation does not belong/);
 }finally{x.cleanup();}
});
