import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// Completion order is not submission order under concurrent closed-loop load.
export function summarizeLoad(rows) {
 assert(rows.length > 0, 'No measurement samples');
 const starts=rows.map(r=>Date.parse(r.startedAt));
 const ends=rows.map((r,i)=>starts[i]+r.elapsedMs);
 assert(starts.every(Number.isFinite) && rows.every(r=>Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0), 'Invalid load timestamps');
 const elapsed=(Math.max(...ends)-Math.min(...starts))/1000;
 assert(elapsed>0, 'Zero measurement window');
 const lat=rows.map(r=>r.elapsedMs).sort((a,b)=>a-b),failures=rows.filter(r=>!r.success).length;
 return {samples:rows.length,failures,errorRate:failures/rows.length,actualWindowSeconds:elapsed,
 completedPerSecond:rows.length/elapsed,successfulPerSecond:(rows.length-failures)/elapsed,
 latencyMs:{mean:lat.reduce((a,b)=>a+b,0)/lat.length,p50:lat[Math.ceil(lat.length*.5)-1],p95:lat[Math.ceil(lat.length*.95)-1]}};
}
export function assertWithdrawnState(value){
 for(const key of ['task','items','calls','chunks'])assert.deepEqual(value[key],[],`Deleted ${key} reappeared`);
 assert.equal(value.stageParts,0,'Deleted staged content remains');
}
export async function runOperationsScenarios(h){
 const {api,state,upload,taskFinished,evaluate,gate,held,until,delay,kill,start,container,database,kb,documentName,raw,check,report,save}=h;
 assert(/^citebase-phase4-process-\d+$/.test(container));
 const agent=async(kbId,marker)=>{const r=await api('/agent-runs',{body:{kbId,question:`恢复规则是什么？ ${marker}`,idempotencyKey:crypto.randomUUID()}});await api(`/agent-runs/${r.id}/execute`,{body:{},expected:202});return r;};
 const finishAny=async id=>until(async()=>{const r=await api(`/tasks/${id}`);return ['SUCCEEDED','FAILED','CANCELLED'].includes(r.status)?r:false;},'task did not terminate');
 // One completed checkpoint precedes the database outage. Only this harness-owned DB is paused.
 gate.setRules([{operation:'generation',marker:'P4_GATE_DB_OUTAGE',skip:1,remaining:1,action:'hold'}]);
 const outage=await evaluate(kb.id,documentName,'P4_GATE_DB_OUTAGE');
 const blocked=await until(()=>held('P4_GATE_DB_OUTAGE'),'database-outage gate missing');
 const before=await state(outage.id);raw('db-outage-before',before);
 const completed=before.items.filter(i=>i.resultHash);assert.equal(completed.length,1);
 let restoredAt;
 try{execFileSync('docker',['pause',container],{stdio:'ignore'});await delay(8000);}
 finally{execFileSync('docker',['unpause',container],{stdio:'ignore'});restoredAt=Date.now();}
 gate.release([blocked.id]);await taskFinished(outage.id);
 const after=await state(outage.id);raw('db-outage-after',after);
 assert.equal(after.items.find(i=>i.case_id===completed[0].case_id&&i.mode===completed[0].mode).resultHash,completed[0].resultHash);
 check('dedicated PostgreSQL outage recovers with first checkpoint unchanged',{taskId:outage.id,outageMs:8000,recoveryMs:Date.now()-restoredAt,unknownCalls:after.calls.filter(c=>c.status==='UNKNOWN').length});
 // Actual loopback HTTP status responses; finite indexing retries must stop at configured 3 attempts.
 for(const status of [429,504]){
  const marker=`P4_GATE_STATUS_${status}`;
  gate.setRules([{operation:'embedding',marker,remaining:20,action:'fail',status}]);
  const work=await upload(kb.id,`fault-${status}.md`,`故障测试 ${marker}`);
  const done=await taskFinished(work.task.id,'FAILED');const receipt=await state(work.task.id);raw(`provider-${status}`,receipt);
  const calls=gate.state().calls.filter(c=>c.marker===marker);assert.equal(done.attempts,3);assert.equal(calls.length,3);
  for(let i=1;i<calls.length;i++)assert(Date.parse(calls[i].receivedAt)-Date.parse(calls[i-1].receivedAt)>=700,'Retry storm / delay not enforced');
  check(`HTTP ${status} has finite retries and spacing`,{taskId:done.id,attempts:done.attempts,calls:calls.length,receivedAt:calls.map(c=>c.receivedAt)});
 }
 gate.setRules([]);
 // A real Java HttpClient deadline, distinct from an HTTP 504 response.
 const timeoutMarker='P4_GATE_SOCKET_TIMEOUT';
 gate.setRules([{operation:'embedding',marker:timeoutMarker,remaining:20,action:'delay',delayMs:5000}]);
 const timeoutWork=await upload(kb.id,'socket-timeout.md',`Client timeout proof ${timeoutMarker}`);
 const timeoutDone=await taskFinished(timeoutWork.task.id,'FAILED');
 assert.equal(timeoutDone.attempts,3);assert.equal(timeoutDone.errorCode,'PROVIDER_TIMEOUT');
 const timeoutCalls=gate.state().calls.filter(c=>c.taskId===timeoutWork.task.id);
 assert.equal(timeoutCalls.length,3);
 for(let i=1;i<timeoutCalls.length;i++)assert(Date.parse(timeoutCalls[i].receivedAt)-Date.parse(timeoutCalls[i-1].receivedAt)>=2700,'Client deadline plus retry delay not enforced');
 await until(()=>gate.state().calls.filter(c=>c.taskId===timeoutWork.task.id).every(c=>c.state==='RETURNED'),'late timeout gate responses did not finish');
 const lateTimeoutCalls=gate.state().calls.filter(c=>c.taskId===timeoutWork.task.id);
 assert(lateTimeoutCalls.every(c=>c.status===200),'This test must exercise client timeout, not HTTP error status');
 const timeoutReceipts=fs.readdirSync(h.directory).filter(n=>/^worker-.*\.txt$/.test(n))
  .flatMap(n=>fs.readFileSync(path.join(h.directory,n),'utf8').split(/\r?\n/))
  .filter(line=>line.includes(`PROCESS_HARNESS_TIMEOUT taskId=${timeoutWork.task.id} `));
 assert.equal(timeoutReceipts.length,3,'Each attempted call must log an actual HttpTimeoutException');
 for(const line of timeoutReceipts){
  assert(line.includes('exception=HttpTimeoutException'));const ms=Number(/elapsedMs=(\d+)/.exec(line)?.[1]);
  assert(ms>=1800&&ms<5000,`Client must time out before delayed success: ${line}`);
 }
 const timeoutState=await state(timeoutWork.task.id);raw('client-timeout-terminal',timeoutState);
 raw('client-timeout-receipts',{client:timeoutReceipts,lateProvider:lateTimeoutCalls});
 assert.equal(timeoutState.task[0].status,'FAILED');assert.equal(timeoutState.chunks.length,0);assert.equal(timeoutState.stageParts,0);
 assert(timeoutState.calls.every(c=>c.status!=='RETURNED'),'Late provider HTTP success is not a saved client result');
 check('real HttpClient timeout has three bounded attempts and rejects late success',{taskId:timeoutWork.task.id,clientDeadlineMs:2000,providerDelayMs:5000,attempts:3,errorCode:timeoutDone.errorCode,lateProviderStatus:200,persistedChunks:0});
 gate.setRules([]);
 // Agent cannot safely replay an in-flight generation after process death.
 gate.setRules([{operation:'generation',marker:'P4_GATE_AGENT_CRASH',remaining:1,action:'hold'}]);
 const interrupted=await agent(kb.id,'P4_GATE_AGENT_CRASH');const call=await until(()=>held('P4_GATE_AGENT_CRASH'),'Agent crash gate missing');
 const owner=call.process;await kill(owner);h.setBase(owner==='A'?'http://127.0.0.1:28084':'http://127.0.0.1:28083');
 const failed=await finishAny(interrupted.id);assert.equal(failed.status,'FAILED');
 const ar=await api(`/agent-runs/${interrupted.id}`);raw('agent-crash-terminal',ar);
 assert.equal(ar.status,'FAILED');assert.equal(ar.errorCode,'UNSAFE_TO_RESUME');
 assert.equal(ar.result.finishReason,'UNSAFE_TO_RESUME');assert.equal(ar.result.answer,'');
 assert.equal(ar.result.inFlightUsageUnavailable,true);
 assert(ar.result.usage.some(c=>c.kind==='generation'&&c.status==='UNKNOWN'));
 assert.equal(gate.state().calls.filter(c=>c.marker==='P4_GATE_AGENT_CRASH'&&c.operation==='generation').length,1);
 gate.release([call.id]);await start(owner);
 check('Agent crash explains interruption instead of replaying paid action',{runId:ar.id,status:ar.status,errorCode:ar.errorCode});
 gate.setRules([{operation:'generation',marker:'P4_GATE_AGENT_CANCEL',remaining:1,action:'hold'}]);
 const cancelled=await agent(kb.id,'P4_GATE_AGENT_CANCEL');const cc=await until(()=>held('P4_GATE_AGENT_CANCEL'),'Agent cancel gate missing');
 await api(`/agent-runs/${cancelled.id}/cancel`,{body:{}});gate.release([cc.id]);await taskFinished(cancelled.id,'CANCELLED');
 const cr=await api(`/agent-runs/${cancelled.id}`);raw('agent-cancel-terminal',cr);assert.equal(cr.status,'CANCELLED');
 check('Agent cancellation rejects late success',{runId:cr.id,status:cr.status});
 // Deletion withdrawal while another worker has obtained evidence.
 gate.setRules([]);const deletionKb=await api('/knowledge-bases',{body:{name:'OperationsDeletion'}});
 const doc=await upload(deletionKb.id,'delete-proof.md','CiteBase 恢复规则是保留已完成检查点，仅继续未完成工作。');await taskFinished(doc.task.id);
 const answered=await api('/questions',{body:{kbId:deletionKb.id,question:'恢复规则是什么？',mode:'vector',topK:3,retrievalOptions:{cache:true}}});
 assert(answered.citations.length>0);
 gate.setRules([{operation:'generation',marker:'P4_GATE_DELETE',remaining:1,action:'hold'}]);
 const deletion=await evaluate(deletionKb.id,'delete-proof.md','P4_GATE_DELETE');const dc=await until(()=>held('P4_GATE_DELETE'),'delete gate missing');
 await api(`/documents/${doc.doc.id}`,{method:'DELETE'});gate.release([dc.id]);
 // DocumentService intentionally purges this KB's derived questions/evaluations/Agent tasks.
 // A deleted task is absent (404), not a retained CANCELLED/FAILED tombstone.
 await until(()=>gate.state().calls.find(c=>c.id===dc.id)?.state==='RETURNED','deleted task late provider return missing');
 await delay(2000); // Allow the original worker to attempt its fenced late publication.
 const withdrawn={taskId:deletion.id,documentId:doc.doc.id,providerReceipt:gate.state().calls.find(c=>c.id===dc.id),workers:[]};
 for(const base of ['http://127.0.0.1:28083','http://127.0.0.1:28084']){
  const gone=route=>h.request(base,`/api${route}`,{expected:404});
  await gone(`/tasks/${deletion.id}`);await gone(`/evaluations/${deletion.id}`);
  const exportResponse=await gone(`/evaluations/${deletion.id}/export`);
  assert(!JSON.stringify(exportResponse).includes('恢复规则是保留已完成检查点'));
  for(const c of answered.citations)await gone(`/citations/${typeof c==='string'?c:c.id}`);
  const empty=await h.request(base,'/api/retrieval-diagnostics',{body:{kbId:deletionKb.id,question:'恢复规则是什么？',mode:'vector',topK:3,retrievalOptions:{cache:true}}});
  assert.equal(empty.evidence.length,0);
  withdrawn.workers.push({base,taskStatus:404,evaluationStatus:404,exportStatus:404,citationStatus:404,evidence:empty.evidence});
 }
 const deletedState=await state(deletion.id);assertWithdrawnState(deletedState);withdrawn.persistedState=deletedState;
 // The domain row is also absent; no retained answer or orphan document chunks remain.
 for(const id of [deletion.id,doc.doc.id])assert(/^[0-9a-f-]{36}$/.test(id));
 const counts=execFileSync('docker',['exec',container,'psql','-U','citebase_harness','-d',database,'-Atc',
  `select (select count(*) from evaluation_run where id='${deletion.id}'),(select count(*) from document where id='${doc.doc.id}'),(select count(*) from chunk where document_id='${doc.doc.id}')`],{encoding:'utf8'}).trim();
 assert.equal(counts,'0|0|0');withdrawn.domainRowCounts=counts;raw('deleted-evaluation',withdrawn);
 check('two-worker in-flight deletion withdraws export citations and cached retrieval',{taskId:deletion.id,status:'DELETED',workers:2,persistedEvaluationRows:0,persistedDocumentRows:0,persistedChunks:0});
 gate.setRules([]);
 await mixedLoad(h);
}

async function mixedLoad(h){
 const {api,upload,evaluate,until,gate,raw,report,save,directory}=h;
 const readKb=await api('/knowledge-bases',{body:{name:'OperationsLoadRead'}}),writeKb=await api('/knowledge-bases',{body:{name:'OperationsLoadIndex'}});
 const doc=await upload(readKb.id,'load.md','CiteBase 恢复规则是保留已完成检查点，仅继续未完成工作。');await h.taskFinished(doc.task.id);
 const samples=[],resources=[];let serial=0,stop=false,sampling;
 const local=async base=>{const r=await fetch(`${base}/api/operations/local`,{headers:{'X-Operations-Token':h.operationsToken},signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);return r.json();};
 const sample=async()=>{const at=new Date().toISOString();const processes=await Promise.all(['http://127.0.0.1:28083','http://127.0.0.1:28084'].map(local));
  const connections=Number(execFileSync('docker',['exec',h.container,'psql','-U','citebase_harness','-d',h.database,'-Atc',"select count(*) from pg_stat_activity where datname=current_database()"],{encoding:'utf8'}).trim());
  const point={at,processes,databaseConnections:connections,summary:await api('/operations/summary?windowMinutes=60')};resources.push(point);fs.appendFileSync(path.join(directory,'resource-samples.jsonl'),JSON.stringify(point)+'\n');
  assert(processes.every(p=>p.heapUsedBytes<=p.heapMaxBytes),'Heap usage exceeds declared maximum');};
 const terminal=async id=>until(async()=>{const r=await api(`/tasks/${id}`);return ['SUCCEEDED','FAILED','CANCELLED'].includes(r.status)?r:false;},'load task remains active',120000);
 async function operation(level,phase){
  const n=serial++,slot=n%10,kind=slot===0?'INDEX':slot<=4?'RAG':slot<=6?'AGENT':'EVALUATION',started=Date.now();const record={serial:n,level,phase,kind,startedAt:new Date(started).toISOString()};
  try{
   if(kind==='INDEX'){const x=await upload(writeKb.id,`load-${n}.md`,`Original load document ${n}`);record.taskId=x.task.id;record.result=await terminal(x.task.id);}
   else if(kind==='RAG')record.result=await api('/questions',{body:{kbId:readKb.id,question:'恢复规则是什么？ P4_GATE_LOAD',mode:'vector',topK:3}});
   else if(kind==='AGENT'){const r=await api('/agent-runs',{body:{kbId:readKb.id,question:'恢复规则是什么？ P4_GATE_LOAD',idempotencyKey:crypto.randomUUID()}});record.taskId=r.id;await api(`/agent-runs/${r.id}/execute`,{body:{},expected:202});record.result=await terminal(r.id);}
   else{const r=await evaluate(readKb.id,'load.md','P4_GATE_LOAD');record.taskId=r.id;record.result=await terminal(r.id);}
   record.success=kind==='RAG'?!record.result.error:record.result.status==='SUCCEEDED';
  }catch(e){record.success=false;record.error=e.message;}
  record.elapsedMs=Date.now()-started;samples.push(record);fs.appendFileSync(path.join(directory,'load-samples.jsonl'),JSON.stringify(record)+'\n');
 }
 // Delay is test-adapter work, not real provider latency. Max 1000 matching calls per step per operation.
 for(const level of report.registration.load.concurrency){
  gate.setRules(['embedding','generation','planner'].map(operation=>({operation,action:'delay',delayMs:100,remaining:1000})));
  await sample();let phase='warmup',end=Date.now()+report.registration.load.warmupSeconds*1000;
  await Promise.all(Array.from({length:level},async()=>{while(Date.now()<end)await operation(level,phase);}));
  phase='measurement';end=Date.now()+report.registration.load.measurementSeconds*1000;let submitted=0;
  let samplingFailure;
  sampling=(async()=>{while(!stop){await h.delay(5000);if(!stop)await sample();}})()
    .catch(error=>{samplingFailure=error;stop=true;});
  await Promise.all(Array.from({length:level},async()=>{while(!stop&&Date.now()<end&&submitted<report.registration.load.maxOperationsPerStep){submitted++;await operation(level,phase);}}));
  stop=true;await sampling;if(samplingFailure)throw samplingFailure;stop=false;await sample();
  const rows=samples.filter(s=>s.level===level&&s.phase==='measurement');
  report.load??=[];report.load.push({concurrency:level,...summarizeLoad(rows),
   byKind:Object.fromEntries(['INDEX','RAG','AGENT','EVALUATION'].map(kind=>{
    const subset=rows.filter(r=>r.kind===kind);return [kind,subset.length?summarizeLoad(subset):{samples:0}];
   })),
   timingDefinition:'earliest submitted measurement operation through latest completion; includes drain, excludes warmup and sampler drain',
   plannedMeasurementSeconds:report.registration.load.measurementSeconds,cap:report.registration.load.maxOperationsPerStep,capReached:submitted===report.registration.load.maxOperationsPerStep});save();
 }
 gate.setRules([]);raw('load-resource-summary',{samples:resources.length,scope:'two local JVM snapshots and dedicated real PostgreSQL, controlled mock provider'});
 h.check('closed-loop mixed load completed with actual resource and terminal-task sampling',{levels:report.load,modelMode:'mock/fault-test-only',qualityConclusion:null});
}
