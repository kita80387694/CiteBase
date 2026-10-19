import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {engineeringReport,costIndependentPackets,templates,loadCostIndependent} from './quality-cost-independent-packets.mjs';
import {costIndependentComparison} from './quality-cost-independent-comparison.mjs';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 const text='Synthetic evidence',items=[],rows=[],questions=[];
 for(let i=0;i<40;i++){
  const baseCaseId=`synthetic-${i}`,evidence=[{documentName:'fixture.md',sourceHash:hash(text),quote:text,page:1,paragraph:1,startOffset:0,endOffset:text.length,groupId:'g'}];
  questions.push({id:baseCaseId,split:'test',question:`Synthetic question ${i}`,answerable:true,expectedAnswer:text,evidence});
  for(const arm of ['control','candidate']){
   const qs=Array.from({length:i<20?1:2},(_,j)=>({caseId:`case-${i}-${j}`,phase:j?'warm':'cold'}));
   items.push({baseCaseId,arm,batchId:`batch-${i}`,questions:qs});
   for(const q of qs)for(const mode of ['vector','hybrid'])rows.push({arm,baseCaseId,...q,mode,runId:`run-${i}-${arm}`,failed:i===0,result:{question:`Synthetic question ${i}`,answerable:true,answer:'Synthetic evidence [uuid]',evidence:[{id:'uuid',documentName:'fixture.md',text,page:1,paragraph:1,startOffset:0,endOffset:text.length}],citations:['uuid'],retrievalMs:10,totalMs:20,recallAtK:1,mrr:1,diagnostics:{cost:{cache:{status:'MISS'}}}}});
  }
 }
 return {plan:{schema:'citebase-assisted-cost-independent-registration-v1',items,freeze:{runtime:{modelConfig:{chatModel:'fixture-model'}}}},dataset:{questions},rows,documents:{'fixture.md':text}};
}
function packageFixture(){const f=fixture();return costIndependentPackets(f.plan,f.dataset,f.rows,f.documents);}
function scores(p){return templates(p).map(f=>({...f,scores:f.scores.map(s=>({...s,correctness:'CORRECT',completeness:'CORRECT',citationSupport:'SUPPORTED',unsupportedContent:'NONE',refusal:'NOT_REFUSED',rationale:'Synthetic fixture only',reviewedAt:'2026-10-10T00:00:00Z'}))}));}
test('240 anonymous answers, 48 duplicate reviews, balanced 144 assignments and 40/40/40/24 batches',()=>{
 const r=packageFixture();assert.equal(r.packets.packets.length,240);const ts=templates(r.packets);assert.deepEqual(ts.map(t=>t.scores.length),[144,144]);for(const t of ts)assert.deepEqual([0,40,80,120].map(i=>t.scores.slice(i,i+40).length),[40,40,40,24]);assert.equal(new Set(ts.flatMap(t=>t.scores.map(s=>s.packetId))).size,240);assert(!JSON.stringify(r.packets).includes('candidate'));assert(r.packets.packets.every(p=>p.answer==='Synthetic evidence [1]'&&p.score===null));assert(r.mapping.items.every(m=>m.rawAnswerSha256===hash('Synthetic evidence [uuid]')));
});
test('partial rows and absent ledger stay pending and unknown; failures retained',()=>{
 const f=fixture(),r=engineeringReport(f.plan,f.rows.slice(1));assert.equal(r.complete,false);assert.equal(r.pending.length,1);assert.equal(r.byArm.control.expected,120);assert.equal(r.actualUsage.calls,null);assert.equal(r.byArm.control.errorRate,null);assert.equal(r.byArm.candidate.failures,2);assert.equal(r.byArm.candidate.retrievalMs.p95,10);assert.equal(r.byArm.candidate.cache.MISS,120);
 const tasks=Array.from({length:80},(_,i)=>({id:`t${i}`,kind:'EVALUATION',status:'SUCCEEDED',externalCalls:[]}));assert.equal(engineeringReport(f.plan,f.rows,tasks).actualUsage.calls,0);tasks[1].id=tasks[0].id;assert.throws(()=>engineeringReport(f.plan,f.rows,tasks),/Duplicate task ledger/);
});
test('missing tokens are null and partial ledger calls are observed only',()=>{
 const f=fixture(),r=engineeringReport(f.plan,f.rows,[{id:'t',kind:'EVALUATION',externalCalls:[{callId:'c',provider:'generation',status:'FAILED'}]}]);assert.equal(r.actualUsage.calls,null);assert.equal(r.actualUsage.observedCalls,1);assert.equal(r.actualUsage.byProviderModel[0].tokens.totalTokens.observedSum,null);
});
test('comparison clusters forty questions; failures zero and missing/NA null',()=>{
 const r=packageFixture(),s=scores(r.packets);let c=costIndependentComparison(r.packets,r.mapping,s);assert.equal(c.receivedScores,288);assert.equal(c.pairs.length,120);assert.equal(c.clusters.length,40);assert.equal(c.interval.clusters,40);assert.equal(c.byArm.control.correctness,118/120);assert.equal(c.humanReviewed,false);assert.equal(c.selectedDefault,null);
 const p=r.packets.packets.find(p=>!p.executionFailed);for(const f of s)f.scores=f.scores.filter(x=>x.packetId!==p.id);c=costIndependentComparison(r.packets,r.mapping,s);assert.equal(c.interval,null);assert.equal(c.complete,false);assert.equal(c.rows.find(x=>x.packetId===p.id).dimensions.correctness,null);
 const na=scores(r.packets);for(const f of na)for(const x of f.scores)if(x.packetId===p.id){x.correctness='NA';x.naReasons={correctness:'Synthetic unassessable'};}c=costIndependentComparison(r.packets,r.mapping,na);assert.equal(c.interval,null);assert.equal(c.qualitySelectable,false);
});
test('duplicate rows, modified gold, forged pairing and unsigned answer rejected',()=>{
 let f=fixture();f.rows[1]=f.rows[0];assert.throws(()=>costIndependentPackets(f.plan,f.dataset,f.rows,f.documents));f=fixture();f.documents['fixture.md']='tampered';assert.throws(()=>costIndependentPackets(f.plan,f.dataset,f.rows,f.documents));let r=packageFixture();r.mapping.items[1]={...r.mapping.items[0],packetId:r.mapping.items[1].packetId};assert.throws(()=>costIndependentComparison(r.packets,r.mapping,scores(r.packets)));r=packageFixture();r.packets.packets[0].answer='tampered';assert.throws(()=>costIndependentComparison(r.packets,r.mapping,[{source:'ASSISTED',reviewer:'A',scores:[]},{source:'ASSISTED',reviewer:'B',scores:[]}]));
});
test('pending and malformed synthetic raw files produce partial hashed report',()=>{
 const f=fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'cost-independent-fixture-'));
 try{fs.mkdirSync(path.join(root,'runs'));fs.writeFileSync(path.join(root,'registration.json'),JSON.stringify(f.plan));const prefix=`CostIndependent-${hash(JSON.stringify(f.plan)).slice(0,20)}`;for(const [i,item]of f.plan.items.slice(0,2).entries())fs.writeFileSync(path.join(root,'runs',`${prefix}-${item.batchId}-${item.arm}.raw.json`),i?'{' : JSON.stringify({status:'RUNNING',results:[]}));const r=loadCostIndependent(root);assert.equal(r.pending.length,240);assert.equal(r.unreadable.length,2);assert.equal(r.inputs.length,3);assert(r.inputs.every(i=>/^[a-f0-9]{64}$/.test(i.sha256)));const out=path.join(root,'report.json');execFileSync(process.execPath,[fileURLToPath(new URL('./quality-cost-independent-packets.mjs',import.meta.url)),'report',root,out]);assert.equal(JSON.parse(fs.readFileSync(out)).terminalRows,0);}finally{assert(root.startsWith(path.join(os.tmpdir(),'cost-independent-fixture-')));fs.rmSync(root,{recursive:true});}
});

test('comparison CLI writes hashed synthetic inputs without changing defaults',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'cost-independent-fixture-'));try{const r=packageFixture(),s=scores(r.packets);const files=['packets','mapping','A','B'].map((n,i)=>{const file=path.join(root,n+'.json');fs.writeFileSync(file,JSON.stringify([r.packets,r.mapping,...s][i]));return file;});const out=path.join(root,'comparison.json');execFileSync(process.execPath,[fileURLToPath(new URL('./quality-cost-independent-comparison.mjs',import.meta.url)),...files,out]);const c=JSON.parse(fs.readFileSync(out));assert.equal(c.inputs.length,4);assert.equal(c.complete,true);assert.equal(c.defaultChanged,false);}finally{assert(root.startsWith(path.join(os.tmpdir(),'cost-independent-fixture-')));fs.rmSync(root,{recursive:true});}});

test('failed task preserves successful checkpoint rows and unknown calls stay counted',()=>{
 const f=fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'cost-independent-fixture-'));
 try{
  fs.mkdirSync(path.join(root,'runs'));fs.mkdirSync(path.join(root,'tasks'));fs.writeFileSync(path.join(root,'registration.json'),JSON.stringify(f.plan));
  const item=f.plan.items[0],prefix=`CostIndependent-${hash(JSON.stringify(f.plan)).slice(0,20)}`;
  const results=['vector','hybrid'].map(mode=>({...f.rows.find(r=>r.arm===item.arm&&r.baseCaseId===item.baseCaseId&&r.mode===mode).result,caseId:item.questions[0].caseId,mode,error:mode==='vector'?null:'ATTEMPTS_EXHAUSTED'}));
  fs.writeFileSync(path.join(root,'runs',`${prefix}-${item.batchId}-${item.arm}.raw.json`),JSON.stringify({id:'synthetic-interrupted',taskId:'synthetic-interrupted',status:'FAILED',results}));
  fs.writeFileSync(path.join(root,'tasks','fixture.json'),JSON.stringify({id:'synthetic-interrupted',kind:'EVALUATION',status:'FAILED',externalCalls:[{callId:'unknown-call',provider:'generation',status:'UNKNOWN'}]}));
  const report=loadCostIndependent(root);assert.equal(report.terminalRows,2);assert.equal(report.byArm[item.arm].failures,1);assert.equal(report.byArm[item.arm].observedTerminalErrorRate,0.5);assert.equal(report.byArm[item.arm].taskStatusRows.FAILED,2);assert.equal(report.actualUsage.calls,null);assert.equal(report.actualUsage.observedCalls,1);assert.equal(report.byArm[item.arm].actualUsage.observedCalls,1);assert.equal(report.byArm[item.arm].actualUsage.calls,null);assert.equal(report.actualUsage.byProviderModel[0].statuses.UNKNOWN,1);assert.equal(report.actualUsage.byProviderModel[0].tokens.totalTokens.observedSum,null);
 }finally{assert(root.startsWith(path.join(os.tmpdir(),'cost-independent-fixture-')));fs.rmSync(root,{recursive:true});}
});
test('nine-day recovery keeps 48 old rows and segment provenance without continuous latency claim',()=>{
 const f=fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'cost-independent-fixture-'));
 try{
  const old={...f.plan.freeze.runtime,containerImageId:'sha256:synthetic-image',containerId:'old',startedAt:'2026-10-01T00:00:00Z'},current={...old,startedAt:'2026-10-10T00:00:00Z'};f.plan.freeze.runtime=old;
  fs.mkdirSync(path.join(root,'runs'));const recoveryDir=path.join(root,'recovery');fs.mkdirSync(recoveryDir);const registrationFile=path.join(root,'registration.json');fs.writeFileSync(registrationFile,JSON.stringify(f.plan));
  const prefix=`CostIndependent-${hash(JSON.stringify(f.plan)).slice(0,20)}`;
  for(const [index,item]of f.plan.items.entries()){
   const runtime=index<24?old:current,date=index<24?'2026-10-01':'2026-10-10';const stem=path.join(root,'runs',`${prefix}-${item.batchId}-${item.arm}`);
   fs.writeFileSync(stem+'.raw.json',JSON.stringify({id:`run-${index}`,status:'SUCCEEDED',results:f.rows.filter(r=>r.arm===item.arm&&r.baseCaseId===item.baseCaseId).map(r=>({...r.result,caseId:r.caseId,mode:r.mode}))}));
   fs.writeFileSync(stem+'.state.json',JSON.stringify({spec:{runtime,options:{cache:false}},createdAt:date+'T01:00:00Z',completedAt:date+'T02:00:00Z'}));
  }
  const exports={};for(const kind of ['evaluation','task']){const file=path.join(recoveryDir,`interrupted-${kind}.json`);fs.writeFileSync(file,JSON.stringify({id:'interrupted',status:'FAILED',externalCalls:[]}));exports[kind]={file,sha256:hash(fs.readFileSync(file))};}
  const manifest={schema:'citebase-assisted-cost-recovery-v1',interrupted:exports,registrationSha256:hash(JSON.stringify(f.plan)),originalRuntime:old,currentRuntime:current,continuousLatencyComparable:false,segments:[{id:'original',runtime:old},{id:'recovery',runtime:current}],originalFiles:[{file:registrationFile,sha256:hash(fs.readFileSync(registrationFile))}]};fs.writeFileSync(path.join(recoveryDir,'manifest.json'),JSON.stringify(manifest));
  const report=loadCostIndependent(root,false,recoveryDir),p=report.runtimeProvenance;assert.equal(report.terminalRows,240);assert.equal(p.continuousLatencyComparable,false);assert.deepEqual(p.segments.map(s=>s.rows),[48,192]);assert.equal(p.rowSources.length,240);assert.equal(p.segments[0].collectionStartedAt,'2026-10-01T01:00:00Z');assert.equal(p.segments[1].collectionStartedAt,'2026-10-10T01:00:00Z');assert(p.rowSources.every(r=>r.runtime&&r.inputs.length===2&&r.requestOptions.cache===false));assert(report.inputs.some(i=>i.file===path.join(recoveryDir,'manifest.json')));assert.deepEqual(p.initialRuntime,old);
  manifest.originalFiles[0].sha256='0'.repeat(64);fs.writeFileSync(path.join(recoveryDir,'manifest.json'),JSON.stringify(manifest));assert.throws(()=>loadCostIndependent(root,false,recoveryDir),/Recovery source changed/);
 }finally{assert(root.startsWith(path.join(os.tmpdir(),'cost-independent-fixture-')));fs.rmSync(root,{recursive:true});}
});
test('arm ledgers attribute actual rerank model, isolate indexing, preserve missing tokens and phase denominators',()=>{
 const f=fixture();f.plan.freeze.runtime.modelConfig.reranker={model:'synthetic-reranker',provider:'synthetic'};
 const tasks=f.plan.items.map((item,i)=>({id:`task-${i}`,kind:'EVALUATION',status:'SUCCEEDED',externalCalls:[{callId:`call-${i}`,provider:'rerank',status:'SUCCEEDED',usage:{totalTokens:3}}]}));
 for(const [i,item]of f.plan.items.entries()){
  const baseIndex=Number(item.baseCaseId.split('-')[1]);for(const q of item.questions){q.phase=baseIndex<20?'cold':baseIndex<30?(q.caseId.endsWith('-0')?'cold':'warm'):(q.caseId.endsWith('-0')?'mixed-new':'mixed-repeat');for(const row of f.rows.filter(r=>r.arm===item.arm&&r.caseId===q.caseId)){row.phase=q.phase;row.taskId=tasks[i].id;}}
 }
 tasks.push({id:'index-task',kind:'INDEX',status:'SUCCEEDED',externalCalls:[{callId:'index-call',provider:'embedding',status:'SUCCEEDED'}]});
 let r=engineeringReport(f.plan,f.rows,tasks);for(const arm of ['control','candidate']){
  const a=r.byArm[arm];assert.equal(a.actualUsage.calls,40);assert.equal(a.actualUsage.tokens.totalTokens.total,120);assert.equal(a.actualUsage.tokens.promptTokens.total,null);assert.equal(a.actualUsage.byProviderModel[0].model,'synthetic-reranker');assert.equal(a.actualUsage.byProviderModel[0].modelSource,'frozen configuration, not supplier response');assert.deepEqual(Object.values(a.byPhase).map(x=>x.expected),[60,20,20,20]);assert.equal(Object.values(a.byPhase).reduce((n,x)=>n+x.terminal,0),120);assert.deepEqual(Object.values(a.byMode).map(x=>x.expected),[60,60]);
 }assert.equal(r.indexingUsage.calls,1);assert.equal(r.actualUsage.byProviderModel.find(g=>g.provider==='rerank').model,'synthetic-reranker');
 tasks.splice(0,1);r=engineeringReport(f.plan,f.rows,tasks);assert.equal(r.byArm.control.actualUsage.calls,null);assert.equal(r.byArm.control.actualUsage.tokens.totalTokens.total,null);assert.equal(r.byArm.control.actualUsage.observedCalls,39);assert.equal(r.byArm.candidate.actualUsage.calls,40);
 r=engineeringReport(f.plan,[],[]);assert.equal(r.byArm.control.byPhase.warm.terminal,0);assert.equal(r.byArm.control.byPhase.warm.pending,20);assert.equal(r.byArm.control.byPhase.warm.errorRate,null);assert.equal(r.byArm.control.byMode.hybrid.retrievalMs.mean,null);assert.equal(r.byArm.control.byMode.hybrid.mrr.mean,null);
});
