import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sha,save,read} from './phase2-client.mjs';
import {BASELINE,register} from './quality-assisted-cost-independent.mjs';
import {guardRecovery,prepareRecovery,recover,verifyManifest,comparableCalls} from './quality-assisted-cost-recover.mjs';

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
 const journal=(s,id)=>({id:s.id,spec:{kbId:s.kbId,datasetSha256:sha(JSON.stringify(s.dataset)),options:s.options,topK:s.topK,runtime:s.runtime},expectedRows:s.dataset.questions.length*2,runId:id,status:'RUNNING'});
 const old=spec(plan.items[0]),interrupted=spec(plan.items[1]),fresh=spec(plan.items[2]);
 const oldRun=makeRun(old,'old-run');save(path.join(old.root,`${old.id}.raw.json`),oldRun);const oldJournal=journal(old,oldRun.id);oldJournal.rawSha256=sha(fs.readFileSync(path.join(old.root,`${old.id}.raw.json`)));save(path.join(old.root,`${old.id}.state.json`),oldJournal);
 const run=makeRun(interrupted,'interrupted-run','FAILED');run.results[1].error='ATTEMPTS_EXHAUSTED';run.externalCalls=[{callId:'unknown-call',status:'UNKNOWN',usage:null,outcome:'PROCESS_INTERRUPTED'}];
 const task={id:run.id,kind:'EVALUATION',status:'FAILED',kbId:'kb',externalCalls:run.externalCalls,payload:{kbId:'kb',name:run.name,dataset:interrupted.dataset,retrievalOptions:interrupted.options,topK:5}};
 save(path.join(interrupted.root,`${interrupted.id}.state.json`),journal(interrupted,run.id));save(path.join(recoveryRoot,'interrupted-evaluation.json'),run);save(path.join(recoveryRoot,'interrupted-task.json'),task);
 for(const item of [old,interrupted]){const config={...makeRun(item,'x').config};delete config.dataset;save(path.join(root,`${item.options===BASELINE?'control':'candidate'}-config.json`),config);}
 return {dir,root,recoveryRoot,bytes,plan,current,runtime,docs,old,interrupted,fresh,run,makeRun,journal,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}

test('segmented recovery preserves failed task, successful checkpoint, unknown usage, and all original states',async()=>{
 const x=fixture();try {
  const originalState=fs.readFileSync(path.join(x.root,'state.json'));const oldJournal=fs.readFileSync(path.join(x.interrupted.root,`${x.interrupted.id}.state.json`));let calls=0;
  const api={request:async()=>x.docs};
  const collector=async(stage,root,plan,api,{evaluate})=>{
   assert.equal((await evaluate(api,x.old)).id,'old-run');const failed=await evaluate(api,x.interrupted);assert.deepEqual(failed,x.run);assert.equal(failed.results[0].answer,'immutable checkpoint');assert.equal(failed.status,'FAILED');
   const fresh=await evaluate(api,x.fresh);assert.equal(fresh.id,'new-run');save(path.join(root,'state.json'),{collectionCompleted:true});return {collectionCompleted:true};
  };
  const evaluate=async(api,spec)=>{calls++;assert.deepEqual(spec.runtime,x.current);const run=x.makeRun(spec,'new-run');save(path.join(spec.root,`${spec.id}.state.json`),x.journal(spec,run.id));save(path.join(spec.root,`${spec.id}.raw.json`),run);return run;};
  await recover(x.root,x.recoveryRoot,x.plan,x.current,api,{bytes:x.bytes,guard:()=>{},collector,evaluate});
  assert.equal(calls,1);assert.deepEqual(fs.readFileSync(path.join(x.root,'state.json')),originalState);assert.deepEqual(fs.readFileSync(path.join(x.interrupted.root,`${x.interrupted.id}.state.json`)),oldJournal);
  const manifest=read(path.join(x.recoveryRoot,'manifest.json'));verifyManifest(manifest);assert.equal(manifest.continuousLatencyComparable,false);assert.deepEqual(manifest.interrupted.externalCalls,x.run.externalCalls);
  await recover(x.root,x.recoveryRoot,x.plan,x.current,api,{bytes:x.bytes,guard:()=>{},collector,evaluate});assert.equal(calls,1);
 }finally{x.cleanup();}
});

test('rejects runtime identity, source, model and cache changes before collection',()=>{
 const x=fixture();try {
  for(const key of ['commit','sourceSha256','containerName','containerImageId','containerId','apiUrl','modelConfig'])assert.throws(()=>guardRecovery(x.plan,{...x.current,[key]:'changed'},x.bytes));
  assert.throws(()=>guardRecovery(x.plan,x.runtime,x.bytes));
  const cached=fixture(true);try{assert.throws(()=>guardRecovery(cached.plan,cached.current,cached.bytes),/Cache-enabled/);}finally{cached.cleanup();}
 }finally{x.cleanup();}
});

test('rejects altered evidence identity, version, config and incomplete keys',()=>{
 for(const mutate of [r=>r.id='another-run',r=>r.config.dataVersions[0].version_id='v2',r=>r.config.topK=7,r=>r.results.pop(),r=>r.results[1].caseId='wrong',r=>r.externalCalls=[]]){
  const x=fixture();try {const file=path.join(x.recoveryRoot,'interrupted-evaluation.json'),run=read(file);mutate(run);save(file,run);assert.throws(()=>prepareRecovery(x.root,x.recoveryRoot,x.plan,x.current,{bytes:x.bytes}));}finally{x.cleanup();}
 }
});

test('manifest hashes prevent changing original raw or supplied terminal audit',()=>{
 for(const target of ['raw','task']){const x=fixture();try{const manifest=prepareRecovery(x.root,x.recoveryRoot,x.plan,x.current,{bytes:x.bytes});const file=target==='raw'?path.join(x.old.root,`${x.old.id}.raw.json`):path.join(x.recoveryRoot,'interrupted-task.json');fs.appendFileSync(file,' ');assert.throws(()=>verifyManifest(manifest),/changed/);}finally{x.cleanup();}}
});

test('external call audit compares SQL and API naming without losing microseconds or UNKNOWN outcomes',()=>{
 assert.deepEqual(comparableCalls([{call_id:'x',finished_at:'2026-10-10T12:53:06.82909+00:00',status:'UNKNOWN',usage:null}]),comparableCalls([{callId:'x',finishedAt:'2026-10-10T12:53:06.829090Z',status:'UNKNOWN',usage:null}]));
 assert.notDeepEqual(comparableCalls([{finished_at:'2026-10-10T12:53:06.829091+00:00'}]),comparableCalls([{finishedAt:'2026-10-10T12:53:06.829090Z'}]));
});

test('live version drift refuses new work and original journal is retained on failure',async()=>{
 const x=fixture();try{let calls=0;const state=fs.readFileSync(path.join(x.root,'state.json'));await assert.rejects(recover(x.root,x.recoveryRoot,x.plan,x.current,{request:async()=>[{id:'doc',activeVersionId:'v2'}]},{bytes:x.bytes,guard:()=>{},evaluate:async()=>{calls++;},collector:async(s,r,p,a,{evaluate})=>evaluate(a,x.fresh)}),/snapshot drift/);assert.equal(calls,0);assert.deepEqual(fs.readFileSync(path.join(x.root,'state.json')),state);}finally{x.cleanup();}
});
