import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sha,save,read} from './phase2-client.mjs';
import {BASELINE,register} from './quality-assisted-cost-independent.mjs';
import {validateClearance,assertInfrastructureCleared,executeInvestigated} from './quality-assisted-cost-continue-investigated.mjs';

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

function investigationFixture(){
 const x=fixture(),rawFile=path.join(x.old.root,`${x.old.id}.raw.json`),journalFile=rawFile.replace('.raw.json','.state.json');
 const run=read(rawFile);run.results.forEach(r=>r.citationValid=true);run.results[0].error='PROVIDER_TIMEOUT';save(rawFile,run);
 const j=read(journalFile);j.rawSha256=sha(fs.readFileSync(rawFile));save(journalFile,j);
 const taskFile=path.join(x.root,'tasks',`${x.plan.items[0].batchId}-${x.plan.items[0].arm}.json`);
 save(taskFile,{id:run.id,kind:'EVALUATION',status:'SUCCEEDED',externalCalls:[{callId:'timeout',status:'RETURNED',outcome:'PROVIDER_TIMEOUT',usage:null}]});
 const ref=file=>({file:path.resolve(file),sha256:sha(fs.readFileSync(file))});
 const clearance={schema:'citebase-cost-investigated-failure-clearance-v1',registrationSha256:sha(JSON.stringify(x.plan)),investigatedAt:new Date().toISOString(),source:'ENGINEERING_INVESTIGATION',entries:[{runId:run.id,caseId:run.results[0].caseId,mode:run.results[0].mode,error:'PROVIDER_TIMEOUT',investigation:'Fixture investigation confirms bounded timeout, subsequent request normal, failure remains in sample without retry.',raw:ref(rawFile),journal:ref(journalFile),task:ref(taskFile)}]};
 return {...x,clearance,run};
}
test('only exact investigated failure is accepted, without changing result or zeroing error',()=>{
 const x=investigationFixture();try{
  const before=JSON.stringify(x.run);assertInfrastructureCleared(x.root,x.plan,x.clearance,x.run);assert.equal(JSON.stringify(x.run),before);assert.equal(x.run.results[0].error,'PROVIDER_TIMEOUT');
  for(const field of ['id','caseId','mode','error']){const r=structuredClone(x.run);if(field==='id')r.id='different';else r.results[0][field]=field==='error'?'PROVIDER_RATE_LIMIT':'different';assert.throws(()=>assertInfrastructureCleared(x.root,x.plan,x.clearance,r),/Infrastructure failure/);}
  const altered=structuredClone(x.run);altered.results[1].answer='altered';assert.throws(()=>assertInfrastructureCleared(x.root,x.plan,x.clearance,altered),/alter any saved/);
 }finally{x.cleanup();}
});
test('changed hash, journal binding, config/source error and missing clearance fail closed',()=>{
 for(const mutate of [c=>c.entries[0].raw.sha256='0'.repeat(64),c=>c.entries[0].journal.sha256='0'.repeat(64),c=>c.entries[0].task.sha256='0'.repeat(64),c=>c.entries[0].error='SOURCE_CHANGED',c=>c.entries[0].error='CONFIG_CHANGED',c=>c.entries=[],c=>c.registrationSha256='wrong']){
  const x=investigationFixture();try{mutate(x.clearance);assert.throws(()=>validateClearance(x.root,x.plan,x.clearance));}finally{x.cleanup();}
 }
});
test('continuation reuses all saved results, retains timeout, submits only missing work, and new error stops before next item',async()=>{
 const x=investigationFixture();try{
  const originalRaw=fs.readFileSync(x.clearance.entries[0].raw.file);let submissions=0,visited=0;
  const api={request:async url=>({id:url.split('/').at(-1),kind:'EVALUATION',status:'SUCCEEDED',externalCalls:[]})};
  const evaluate=async(a,s)=>{visited++;const file=path.join(s.root,`${s.id}.raw.json`);if(fs.existsSync(file))return read(file);submissions++;const r=x.makeRun(s,`new-${submissions}`);r.results.forEach(row=>row.citationValid=true);r.results[0].error='PROVIDER_TIMEOUT';save(file,r);return r;};
  await assert.rejects(executeInvestigated('collect',x.root,x.plan,api,{guard:()=>{},bytes:x.bytes,evaluate,clearance:x.clearance}),/Infrastructure failure/);
  assert.equal(visited,2);assert.equal(submissions,1);assert.deepEqual(fs.readFileSync(x.clearance.entries[0].raw.file),originalRaw);assert.equal(read(path.join(x.root,'state.json')).collectionCompleted,undefined);
 }finally{x.cleanup();}
});
test('copied collector retains all frozen checks except explicitly investigated infrastructure gate',()=>{
 const original=fs.readFileSync(new URL('./quality-assisted-cost-independent.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const copy=fs.readFileSync(new URL('./quality-assisted-cost-continue-investigated.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 let expected=original.slice(original.indexOf('export async function execute('),original.indexOf('\nif(process.argv[1]')).replace('export async function execute(','export async function executeInvestigated(');
 expected=expected.replace('evaluate=evaluation}={}){',"evaluate=evaluation,clearance}={}){\n assert.equal(stage,'collect','Investigated continuation is collect-only');validateClearance(root,plan,clearance);");
 expected=expected.replace("assert(!run.results.some(r=>/PROVIDER|SOURCE_CHANGED|CONFIG_CHANGED/.test(r.error??'')),'Infrastructure failure retained; investigate before resuming');",'assertInfrastructureCleared(root,plan,clearance,run);');
 assert.equal(copy.slice(copy.indexOf('export async function executeInvestigated('),copy.indexOf('\nif(process.argv[1]')),expected);
});
test('complete registered collection preserves investigated failure in all 240 rows and reuses its saved task',async()=>{
 const x=investigationFixture();try{
  const before=fs.readFileSync(x.clearance.entries[0].raw.file);let submissions=0,visited=0;
  const api={request:async url=>({id:url.split('/').at(-1),kind:'EVALUATION',status:'SUCCEEDED',externalCalls:[]})};
  const evaluate=async(a,s)=>{visited++;const file=path.join(s.root,`${s.id}.raw.json`);if(fs.existsSync(file))return read(file);submissions++;const r=x.makeRun(s,`new-${submissions}`);r.results.forEach(row=>row.citationValid=true);save(file,r);return r;};
  const result=await executeInvestigated('collect',x.root,x.plan,api,{guard:()=>{},bytes:x.bytes,evaluate,clearance:x.clearance});
  assert.equal(result.collectionCompleted,true);assert.equal(visited,80);assert.equal(submissions,79);assert.deepEqual(fs.readFileSync(x.clearance.entries[0].raw.file),before);
  const rows=fs.readdirSync(x.old.root).filter(f=>f.endsWith('.raw.json')).flatMap(f=>read(path.join(x.old.root,f)).results);assert.equal(rows.length,240);assert.equal(rows.filter(r=>r.error==='PROVIDER_TIMEOUT').length,1);
 }finally{x.cleanup();}
});
