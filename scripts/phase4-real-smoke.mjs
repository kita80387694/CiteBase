import assert from 'node:assert/strict';
import {existsSync,mkdirSync} from 'node:fs';
import {client,read,save,immutable,pause,sha} from './phase2-client.mjs';
const root=process.argv[2]||'docs/results/phase4/real-smoke';
const runtimeFile=process.argv[3];
assert(runtimeFile,'Pass frozen just-built runtime manifest; this script makes real supplier calls');
mkdirSync(root,{recursive:true});
const runtime=read(runtimeFile),journal=`${root}/state.json`;
const state=existsSync(journal)?read(journal):{createdAt:new Date().toISOString(),runtime};
assert.deepEqual(state.runtime,runtime,'Runtime changed; preserve old journal');
save(journal,state);
const api=await client();
const persist=()=>save(journal,state);
async function terminal(path,field='status'){
  for(let i=0;i<400;i++){const value=await api.request(path);if(!['CREATED','QUEUED','RUNNING','RETRY_WAIT','CANCEL_REQUESTED'].includes(value[field]))return value;await pause(1000);}
  throw Error('Still running; resume same journal, never recreate');
}
const label=`Phase4真实闭环-${sha(state.createdAt).slice(0,12)}`;
if(!state.kbId){let kb=(await api.request('/api/knowledge-bases')).find(k=>k.name===label);kb??=await api.request('/api/knowledge-bases',{name:label});state.kbId=kb.id;persist();}
const kbId=state.kbId;
if(!state.indexed){
  await api.upload(kbId,'samples/documents/atlas-api.md',{strategy:'structure-v1',size:900,overlap:200});
  let docs;
  for(let i=0;i<180;i++){docs=await api.request(`/api/knowledge-bases/${kbId}/documents`);if(docs.length&&docs.every(d=>['SUCCESS','FAILED'].includes(d.status)))break;await pause(1000);}
  immutable(`${root}/documents.json`,docs);assert(docs.every(d=>d.status==='SUCCESS'),'Index failure preserved');state.indexed=true;persist();
}
const question=read('samples/evaluation.json').questions[0];
if(!existsSync(`${root}/rag.json`)){
  // A lost synchronous response must be reconciled from history before repeating a paid call.
  let answer=(await api.request(`/api/questions?kbId=${kbId}`)).find(r=>r.question===question.question);
  if(!answer){assert(!state.ragSubmitting,'Unknown synchronous response: reconcile question history before any new paid call');state.ragSubmitting=true;persist();answer=await api.request('/api/questions',{kbId,question:question.question,mode:'vector',topK:5});}
  immutable(`${root}/rag.json`,answer);
}
const rag=read(`${root}/rag.json`);assert(!rag.error&&rag.citationValid&&rag.citations.length,'Real RAG failed; retained raw');
const citation=rag.citations[0];immutable(`${root}/citation.json`,await api.request(`/api/citations/${typeof citation==='string'?citation:citation.id}`));
if(!state.agentId){const run=await api.request('/api/agent-runs',{kbId,question:question.question,mode:'vector',topK:5,idempotencyKey:`${label}-agent`});state.agentId=run.id;persist();}
let agent=await api.request(`/api/agent-runs/${state.agentId}`);
if(agent.status==='CREATED'&&!agent.taskId)await api.request(`/api/agent-runs/${state.agentId}/execute`,{});
agent=await terminal(`/api/agent-runs/${state.agentId}`);
immutable(`${root}/agent.json`,agent);assert.equal(agent.status,'COMPLETED','Real Agent failed; do not silently retry');
if(!state.evaluationId){const run=await api.request('/api/evaluations',{kbId,name:label,dataset:{version:'phase4-real-smoke-v1',questions:read('samples/evaluation.json').questions.slice(0,2)},topK:5,idempotencyKey:`${label}-evaluation`});state.evaluationId=run.id;persist();}
const id=state.evaluationId;
if(!state.cancelled){
  await api.request(`/api/tasks/${id}/cancel`,{});
  const cancelled=await terminal(`/api/tasks/${id}`);
  immutable(`${root}/cancelled-task.json`,cancelled);
  immutable(`${root}/partial-export.json`,await api.request(`/api/evaluations/${id}/export`));
  assert.equal(cancelled.status,'CANCELLED','Cancellation lost race; record honestly');state.cancelled=true;persist();
}
if(!state.retryRequested){const current=await api.request(`/api/tasks/${id}`);if(current.retryGeneration===0)await api.request(`/api/tasks/${id}/retry`,{});state.retryRequested=true;persist();}
const evaluation=await terminal(`/api/evaluations/${id}/export`);
immutable(`${root}/evaluation.json`,evaluation);
assert.equal(evaluation.results.length,4);assert(evaluation.results.every(r=>!r.error),'Real eval failure retained');
immutable(`${root}/task.json`,await api.request(`/api/tasks/${id}`));
state.complete=true;persist();
console.log(JSON.stringify({root,kbId,agentId:state.agentId,evaluationId:id,real:true,rows:4,cancelledAndResumed:true}));
