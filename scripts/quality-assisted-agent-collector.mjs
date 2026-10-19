import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {read,save,sha,immutable,pause} from './phase2-client.mjs';
import {retrievalMetrics} from './phase2-metrics.mjs';
export const BUDGET={maxPlannerSteps:4,maxTools:4,maxSearch:2,maxEvidence:12,maxEvidenceChars:20000,deadlineSeconds:120,maxPlannerOutputTokens:256,maxFinalOutputTokens:1024,maxExternalCalls:10};
const terminal=new Set(['COMPLETED','FAILED','CANCELLED','INTERRUPTED']);
export function verifySnapshot(snapshot,documents){
 const pairs=rows=>rows.map(v=>[v.id,v.version_id??v.activeVersionId]).sort(([a],[b])=>a.localeCompare(b));
 assert.deepEqual(pairs(snapshot),pairs(documents.filter(v=>v.activeVersionId||v.version_id)),'Active source snapshot drift; do not continue or recreate');
}
export function verifyRun(run,spec){
 assert.equal(run.kbId,spec.body.kbId);assert.equal(run.request.question,spec.body.question);
 const expectedStrategy=spec.body.strategy??'original';assert(['original','inspection-free-v1','stop-aware-v1','combined-v1','grounded-answer-v1','combined-grounded-v1'].includes(expectedStrategy),'Unknown Agent strategy');assert.equal(run.request.strategy??'original',expectedStrategy,'Run request drift: strategy');assert.equal(run.config.agentStrategy??'original',expectedStrategy,'Run config drift: strategy');if(run.result?.strategy!==undefined)assert.equal(run.result.strategy,expectedStrategy,'Run result drift: strategy');
 assert.equal(run.config.generationPolicy??'original',expectedStrategy.includes('grounded')?'grounded-answer-v1':'original','Generation policy drift');
 for(const key of ['mode','topK','retrievalOptions','budget','idempotencyKey'])assert.deepEqual(run.request[key],spec.body[key],`Run request drift: ${key}`);
 assert.deepEqual(run.snapshot,spec.snapshot,'Run snapshot differs from frozen comparison corpus');
 assert.equal(run.config.modelMode,'real');
 for(const key of ['chatModel','embeddingModel'])assert.equal(run.config[key],spec.modelConfig[key],`Model drift: ${key}`);
 if(spec.baselineConfig)for(const[key,value]of Object.entries(spec.baselineConfig))assert.deepEqual(run.config[key],value,`Generation/retrieval configuration drift: ${key}`);
 if(spec.serverConfig)assert.deepEqual(run.config,spec.serverConfig,'Actual planner/provider/policy configuration drift');
}
export async function collectAgent(api,{root,id,spec,configFile,pollMs=1500,maxPolls=400}){
 assert(/^[a-z0-9_-]+$/i.test(id));mkdirSync(root,{recursive:true});
 const stateFile=`${root}/${id}.state.json`,rawFile=`${root}/${id}.raw.json`;
 const state=existsSync(stateFile)?read(stateFile):{spec,status:'INTENT_SAVED',createdAt:new Date().toISOString()};
 assert.deepEqual(state.spec,spec,'Experiment specification drift');save(stateFile,state);
 if(existsSync(rawFile)){const run=read(rawFile);verifyRun(run,spec);assert(terminal.has(run.status));return run;}
 verifySnapshot(spec.snapshot,await api.request(`/api/knowledge-bases/${spec.body.kbId}/documents`));
 let run;
 if(state.runId)run=await api.request(`/api/agent-runs/${state.runId}`);
 else {
  // The same persisted key/body is safe to replay after an uncertain creation response.
  state.status='CREATING';save(stateFile,state);
  run=await api.request('/api/agent-runs',spec.body);state.runId=run.id;state.status=run.status;save(stateFile,state);
 }
 verifyRun(run,spec);
 if(configFile){assert(run.config.agentPlanner?.model&&run.config.agentPlanner?.endpoint&&run.config.agentPolicyVersion,'Actual planner configuration missing');immutable(configFile,run.config);}
 if(run.status==='CREATED'&&!run.taskId){
  // GET precedes every retry. The server compare-and-set execute claim prevents duplicate execution.
  state.status='EXECUTING';save(stateFile,state);
  try{run=await api.request(`/api/agent-runs/${run.id}/execute`,{});}
  catch(error){state.lastTransportError='Execute response unavailable; reconciled by GET, never recreated';save(stateFile,state);run=await api.request(`/api/agent-runs/${state.runId}`);}
 }
 for(let poll=0;!terminal.has(run.status)&&poll<maxPolls;poll++){
  if(run.status==='CREATED'&&!run.taskId)throw new Error('Execution not claimed (possibly capacity 429); retry this same journal later');
  await pause(pollMs);run=await api.request(`/api/agent-runs/${state.runId}`);
 }
 verifyRun(run,spec);assert(terminal.has(run.status),'Run still in progress; retain journal and resume, never recreate');
 immutable(rawFile,run);state.status=run.status;state.rawSha256=sha(readFileSync(rawFile));state.finishedAt=new Date().toISOString();save(stateFile,state);
 return run;
}
export function deriveRow(run,question){
 const result=run.result||{},evidence=result.evidence||[];
 const top=retrievalMetrics(question.evidence,evidence.slice(0,5),run.snapshot),all=retrievalMetrics(question.evidence,evidence,run.snapshot);
 const error=run.errorCode||result.error||(run.status==='COMPLETED'?null:run.status);
 const normalize=x=>String(x??'').toLowerCase().replace(/\s+/g,'');
 return {caseId:question.id,mode:run.request.mode,category:question.category,split:question.split,answerable:question.answerable,
   status:run.status,error,answer:result.answer??null,evidence,citations:result.citations||[],citationValid:result.citationValid??false,
   recallAt5:question.answerable?top.recallAtK:null,mrrAt5:question.answerable?top.mrr:null,
   accumulatedRecall:question.answerable?all.recallAtK:null,accumulatedMrr:question.answerable?all.mrr:null,
   metricNote:'First five retained evidence items in acquisition order, not a newly reranked final top-5; accumulated evidence may contain up to the published budget.',
   abstentionCorrect:question.answerable?null:run.status==='COMPLETED'&&!error&&result.abstained===true&&result.citationValid===true,
   referenceAnswerMatch:question.expectedAnswer==null?null:normalize(result.answer).includes(normalize(question.expectedAnswer)),
   answerCorrect:null,citationSupported:null,gradingSource:null,retrievalMs:result.retrievalMs??null,
   retrievalLatencyDefinition:'Sum of search-tool elapsed time, including query embedding/rerank; excludes planner, neighbors, final generation.',
   totalMs:result.totalMs??null,budgetUsed:result.budgetUsed??null,usage:result.usage??null,
   inFlightUsageUnavailable:result.inFlightUsageUnavailable??null,rawRunId:run.id};
}
