import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {client,read,save,sha,immutable,pause} from './phase2-client.mjs';
import {retrievalMetrics} from './phase2-metrics.mjs';
export const BUDGET={maxPlannerSteps:4,maxTools:4,maxSearch:2,maxEvidence:12,maxEvidenceChars:20000,deadlineSeconds:120,maxPlannerOutputTokens:256,maxFinalOutputTokens:1024,maxExternalCalls:10};
const terminal=new Set(['COMPLETED','FAILED','CANCELLED','INTERRUPTED']);
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export function verifySnapshot(snapshot,documents){
 const pairs=rows=>rows.map(v=>[v.id,v.version_id??v.activeVersionId]).sort(([a],[b])=>a.localeCompare(b));
 assert.deepEqual(pairs(snapshot),pairs(documents.filter(v=>v.activeVersionId||v.version_id)),'Active source snapshot drift; do not continue or recreate');
}
export function verifyRun(run,spec){
 assert.equal(run.kbId,spec.body.kbId);assert.equal(run.request.question,spec.body.question);
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
export function registration({runtime,snapshot,modelConfig,kbId,options,budget,devHash,testHash,baselineConfig,serverConfig=null}){
 assert(runtime.sourceSha256&&runtime.imageId,'Runtime source/image identity required');
 return {version:'phase3-agent-v1',collectorSha256:sha(readFileSync(new URL(import.meta.url))),runtime,snapshot,modelConfig,kbId,options,budget,devHash,testHash,baselineConfig,serverConfig,
   comparison:'Same phase2 frozen test52, vector/hybrid, topK5; no test-based tuning. Agent accumulated evidence capped separately.',
   independentTestLimitation:'This set was already used once for the preregistered phase2 comparison. It is a fixed common benchmark, not newly unseen data for phase3.'};
}
async function main(){
 const argv=process.argv.slice(2),stage=argv[0]&&!argv[0].startsWith('--')?argv.shift():'smoke';
 assert(['smoke','dev','freeze','test'].includes(stage));
 const flags={};while(argv.length){const key=argv.shift();assert(key.startsWith('--')&&argv.length,'Expected --name value');flags[key.slice(2)]=argv.shift();}
 const root=flags.root||'docs/results/phase3',runtimeFile=flags.runtime||'.tools/phase3-runtime.json';mkdirSync(root,{recursive:true});
 const runtime=read(runtimeFile);for(const [file,hash]of Object.entries(runtime.fileHashes||{}))assert.equal(sha(readFileSync(file)),hash,`Runtime source changed ${file}`);
 const suite=read('docs/results/phase2/optimization/suite.json'),final=suite.finalConfiguration;assert(final,'Phase2 freeze missing');
 const variant=suite.variants[final.candidate],baseline=read(variant.rawFile),snapshot=baseline.config.dataVersions;
 const dev=read('samples/phase2/dev.json'),test=read('samples/phase2/test.json');
 const budget=flags.budget?read(flags.budget):BUDGET;
 const configFile=`${root}/server-config.json`;
 const baselineConfig=Object.fromEntries(['modelMode','chatModel','embeddingModel','topK','fusion','rrfConstant','candidateK','retrievalOptions','reranker','keywordAnalyzer','temperature','provider','chunking','minimumSimilarity','abstentionPolicy'].map(key=>[key,baseline.config[key]]));
 let serverConfig=null;
 if(stage!=='smoke'){
  serverConfig=read(configFile);
  const smoke=read(`${root}/smoke.derived.json`);assert.equal(smoke.rows.length,4,'Complete smoke required before freeze/dev/test');
  assert.deepEqual(smoke.registration.runtime,runtime,'Smoke runtime differs');
  for(const q of dev.questions.slice(0,2))for(const mode of ['vector','hybrid']){
   const id=`${q.id}-${mode}`,raw=read(`${root}/smoke/${id}.raw.json`),state=read(`${root}/smoke/${id}.state.json`);
   assert(terminal.has(raw.status));assert.deepEqual(raw.config,serverConfig,'Smoke configuration inconsistent');
   assert.deepEqual(state.spec.runtime,runtime);assert.equal(state.rawSha256,sha(readFileSync(`${root}/smoke/${id}.raw.json`)));
  }
 }
 const reg=registration({runtime,snapshot,modelConfig:{chatModel:baseline.config.chatModel,embeddingModel:baseline.config.embeddingModel},
  kbId:suite.profiles[final.profileId].kbId,options:final.options,budget,devHash:sha(canonical(dev)),testHash:sha(canonical(test)),baselineConfig,serverConfig});
 const freezeFile=flags['testfreeze']||`${root}/registration.json`;
 if(stage==='freeze'){assert(!existsSync(`${root}/test`),'Cannot register after test directory exists');immutable(freezeFile,{...reg,frozenAt:existsSync(freezeFile)?read(freezeFile).frozenAt:new Date().toISOString()});console.log(`Frozen ${freezeFile}`);return;}
 if(stage==='test'){const frozen=read(freezeFile);const {frozenAt,...locked}=frozen;assert(frozenAt);assert.deepEqual(locked,reg,'Frozen test configuration changed');assert.equal(test.questions.length,52);}
 const dataset=stage==='test'?test:{...dev,questions:stage==='smoke'?dev.questions.slice(0,2):dev.questions};
 assert(dataset.questions.every(q=>q.split===(stage==='test'?'test':'dev')));
 const api=await client();verifySnapshot(snapshot,await api.request(`/api/knowledge-bases/${reg.kbId}/documents`));
 const tasks=dataset.questions.flatMap(question=>['vector','hybrid'].map(mode=>({question,mode}))),results=new Array(tasks.length);
 let next=0;
 await Promise.all(Array.from({length:Math.min(2,tasks.length)},async()=>{while(next<tasks.length){const index=next++,{question,mode}=tasks[index],id=`${question.id}-${mode}`;
  const intent={kbId:reg.kbId,question:question.question,mode,topK:5,retrievalOptions:reg.options,budget};
  const body={...intent,idempotencyKey:`p3-${sha(canonical({root,stage,id,reg,intent})).slice(0,60)}`};
  const run=await collectAgent(api,{root:`${root}/${stage}`,id,configFile,spec:{body,snapshot,modelConfig:reg.modelConfig,baselineConfig,serverConfig:reg.serverConfig,runtime,datasetHash:stage==='test'?reg.testHash:reg.devHash}});
  results[index]=deriveRow(run,question);console.log(`${stage} ${id}: ${run.status}`);
 }}));
 immutable(`${root}/${stage}.derived.json`,{registration:reg,stage,rows:results,rawDirectory:`${root}/${stage}`,humanReviewed:false});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
