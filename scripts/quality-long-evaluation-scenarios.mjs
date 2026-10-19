import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
export function registration(os){return {version:'long-evaluation-mixed-v1',machine:{cpus:os.cpus().length,totalMemory:os.totalmem(),platform:os.platform()},workerProcesses:2,perWorker:{heapMiB:384,taskConcurrency:1,poolMax:6},questions:40,modes:2,expectedItems:80,providerDelayMs:250,mixedRounds:4,resourceIntervalMs:1000,timeoutMs:120000,stop:['unexpected terminal failure','checkpoint altered','worker disappears','scope violation','timeout'],modelMode:'mock/fault-test-only',qualityConclusion:null};}
export function dataset(){return {version:'long-evaluation-mixed-v1',questions:Array.from({length:40},(_,i)=>({id:`long-${i}`,question:`CiteBase 恢复规则是什么？ P4_GATE_LONG_${i}`,answerable:true,expectedAnswer:'保留已完成检查点',evidence:[{documentName:'long.md',page:1,paragraph:1,quote:'CiteBase 恢复规则是保留已完成检查点，仅继续未完成工作。',groupId:'recovery'}]}))};}
export function verifyCheckpoints(before,after){assert(before.length>0);for(const old of before){const row=after.find(x=>x.case_id===old.case_id&&x.mode===old.mode);assert(row,'checkpoint missing');assert.equal(row.resultHash,old.resultHash,'checkpoint changed');}}
export async function runLongMixed(h){
 const {api,state,upload,taskFinished,gate,until,delay,raw,check,report,save,directory}=h;
 const read=await api('/knowledge-bases',{body:{name:'LongMixedRead'}}),write=await api('/knowledge-bases',{body:{name:'LongMixedWrite'}});
 const doc=await upload(read.id,'long.md','CiteBase 恢复规则是保留已完成检查点，仅继续未完成工作。');await taskFinished(doc.task.id);
 gate.setRules(['embedding','generation','planner'].map(operation=>({operation,action:'delay',delayMs:250,remaining:1000})));
 const start=Date.now();const run=await api('/evaluations',{expected:202,body:{kbId:read.id,name:'Long mixed 40 questions',idempotencyKey:crypto.randomUUID(),topK:3,retrievalOptions:{candidateK:10,rerank:false,citationStyle:'uuid'},dataset:dataset()}});
 report.longTask=run.id;save();
 const first=await until(async()=>{const s=await state(run.id);return s.items.filter(x=>x.resultHash).length>=2?s:false;},'first checkpoints missing');raw('checkpoint-before',first);
 assert.equal(first.items.length,80);const retained=first.items.filter(x=>x.resultHash);
 let stop=false,sampleFailure;const samples=[],operations=[];
 async function sample(){const at=new Date().toISOString();const processes=await Promise.all([28083,28084].map(async port=>{const r=await fetch(`http://127.0.0.1:${port}/api/operations/local`,{headers:{'X-Operations-Token':h.operationsToken},signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);return r.json();}));
 const connections=Number(execFileSync('docker',['exec',h.container,'psql','-U','citebase_harness','-d',h.database,'-Atc','select count(*) from pg_stat_activity where datname=current_database()'],{encoding:'utf8'}).trim());
 const activeByWorker=JSON.parse(execFileSync('docker',['exec',h.container,'psql','-U','citebase_harness','-d',h.database,'-Atc',"select coalesce(json_agg(t),'[]'::json) from (select lease_owner,count(*) active from work_task where status in ('RUNNING','CANCEL_REQUESTED') and lease_until>now() group by lease_owner) t"],{encoding:'utf8'}).trim());assert(activeByWorker.every(x=>x.active<=1),'worker concurrent tasks exceeded registration');assert(activeByWorker.length<=2);const current=await state(run.id);const point={at,activeByWorker,processes,databaseConnections:connections,summary:await api('/operations/summary?windowMinutes=60'),longStatus:current.task[0].status,completedItems:current.items.filter(x=>x.resultHash).length};samples.push(point);fs.appendFileSync(path.join(directory,'resources.jsonl'),JSON.stringify(point)+'\n');}
 const sampler=(async()=>{while(!stop){await sample();await delay(1000);}})().catch(e=>{sampleFailure=e;stop=true;});
 async function operation(kind,n){const record={kind,n,startedAt:new Date().toISOString()};try{let result;
 if(kind==='INDEX'){const x=await upload(write.id,`mixed-${n}.md`,`Mixed independent source ${n}`);record.taskId=x.task.id;result=await taskFinished(x.task.id);}
 else if(kind==='RAG')result=await api('/questions',{body:{kbId:read.id,question:'恢复规则是什么？ P4_GATE_MIXED',mode:'vector',topK:3}});
 else {const x=await api('/agent-runs',{body:{kbId:read.id,question:'恢复规则是什么？ P4_GATE_MIXED',idempotencyKey:crypto.randomUUID()}});record.taskId=x.id;await api(`/agent-runs/${x.id}/execute`,{body:{},expected:202});result=await taskFinished(x.id);}
 record.success=kind==='RAG'?!result.error:result.status==='SUCCEEDED';record.longStatusAtCompletion=(await state(run.id)).task[0].status;record.result=result;
 }catch(e){record.success=false;record.error=e.message;}finally{record.finishedAt=new Date().toISOString();record.elapsedMs=Date.parse(record.finishedAt)-Date.parse(record.startedAt);operations.push(record);fs.appendFileSync(path.join(directory,'operations.jsonl'),JSON.stringify(record)+'\n');}}
 try{
 for(let n=0;n<4;n++)await Promise.all(['INDEX','RAG','AGENT'].map(kind=>operation(kind,n)));
 assert.equal(operations.length,12);assert(operations.every(x=>x.success),'mixed operation failed');
 for(const kind of ['INDEX','RAG','AGENT'])assert(operations.some(x=>x.kind===kind&&x.longStatusAtCompletion==='RUNNING'),`${kind} made no progress during long evaluation`);
 const beforeCancel=await state(run.id);raw('before-cancel',beforeCancel);verifyCheckpoints(retained,beforeCancel.items);assert(beforeCancel.items.filter(x=>x.resultHash).length>retained.length);assert.equal(beforeCancel.task[0].status,'RUNNING');
 const cancellation=await api(`/tasks/${run.id}/cancel`,{body:{}});raw('cancel-response',cancellation);await taskFinished(run.id,'CANCELLED');await delay(700);
 const after=await state(run.id);raw('after-cancel',after);verifyCheckpoints(beforeCancel.items.filter(x=>x.resultHash),after.items);raw('partial-export',await api(`/evaluations/${run.id}/export`));
 const calls=gate.state().calls.filter(x=>x.taskId===run.id).length;await delay(700);assert.equal(gate.state().calls.filter(x=>x.taskId===run.id).length,calls,'cancelled evaluation scheduled more calls');
 await sample();check('40-question evaluation coexists with successful indexing, RAG and Agent; checkpoints survive cancellation',{taskId:run.id,expectedItems:80,completedBeforeCancellation:beforeCancel.items.filter(x=>x.resultHash).length,completedAfterCancellation:after.items.filter(x=>x.resultHash).length,elapsedMs:Date.now()-start,operations:operations.map(({result,...x})=>x),sampleCount:samples.length});
 }finally{stop=true;await sampler;if(sampleFailure)throw sampleFailure;raw('resource-summary',{sampleCount:samples.length,definition:'one-second snapshots, not instantaneous maxima',processCount:2});}
}

