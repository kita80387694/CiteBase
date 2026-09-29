import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {collectAgent,deriveRow,verifySnapshot,verifyRun,BUDGET} from './phase3-experiment.mjs';
const snapshot=[{id:'d',version_id:'v',content_hash:'h'}];
const spec={body:{kbId:'kb',question:'q',mode:'vector',topK:5,retrievalOptions:{candidateK:40,keywordWeight:1,rerank:true,citationStyle:'uuid'},budget:BUDGET,idempotencyKey:'unique'},snapshot,modelConfig:{chatModel:'chat',embeddingModel:'embed'},runtime:{sourceSha256:'s'}};
function fixture({loseCreate=false,loseExecute=false,status='COMPLETED',drift=false}={}){
 let run,created=0,executes=0,posts=0;
 const api={async request(path,body){if(path.includes('/documents'))return[{id:'d',activeVersionId:drift?'changed':'v'}];
 if(path==='/api/agent-runs'){posts++;if(!run){created++;run={id:'r',kbId:'kb',request:spec.body,config:{modelMode:'real',...spec.modelConfig},snapshot,status:'CREATED',steps:[],result:null};}
 if(loseCreate){loseCreate=false;throw new Error('lost response');}return structuredClone(run);}
 if(path.endsWith('/execute')){assert.deepEqual(body,{});executes++;run.status=status;run.errorCode=status==='FAILED'?'TIMEOUT':null;run.result={evidence:[],usage:null,abstained:true,citationValid:status==='COMPLETED',error:run.errorCode};if(loseExecute){loseExecute=false;throw new Error('lost execute');}return structuredClone(run);}
 return structuredClone(run);},counts:()=>({created,executes,posts})};return api;
}
async function temp(action){const root=mkdtempSync(join(tmpdir(),'p3-test-'));try{await action(root);}finally{rmSync(root,{recursive:true,force:true});}}
test('uncertain creation replays same idempotency key and never duplicates execution',()=>temp(async root=>{const api=fixture({loseCreate:true});await assert.rejects(collectAgent(api,{root,id:'case',spec}));const result=await collectAgent(api,{root,id:'case',spec});assert.equal(result.status,'COMPLETED');assert.deepEqual(api.counts(),{created:1,executes:1,posts:2});await collectAgent(api,{root,id:'case',spec});assert.equal(api.counts().executes,1);}));
test('uncertain execute reconciles GET and does not POST execute again',()=>temp(async root=>{const api=fixture({loseExecute:true});await collectAgent(api,{root,id:'case',spec});assert.equal(api.counts().executes,1);}));
test('terminal failure kept raw and never silently retried',()=>temp(async root=>{const api=fixture({status:'FAILED'});const run=await collectAgent(api,{root,id:'case',spec});assert.equal(run.errorCode,'TIMEOUT');await collectAgent(api,{root,id:'case',spec});assert.equal(api.counts().executes,1);const row=deriveRow(run,{id:'c',evidence:[],answerable:false});assert.equal(row.abstentionCorrect,false);assert.equal(row.answerCorrect,null);assert.equal(row.usage,null);}));
test('snapshot drift stops before model work',()=>temp(async root=>{const api=fixture({drift:true});await assert.rejects(collectAgent(api,{root,id:'case',spec}),/snapshot drift/);assert.equal(api.counts().created,0);assert.throws(()=>verifySnapshot(snapshot,[]));}));
test('changed request cannot reuse journal',()=>temp(async root=>{const api=fixture();await collectAgent(api,{root,id:'case',spec});await assert.rejects(collectAgent(api,{root,id:'case',spec:{...spec,body:{...spec.body,question:'changed'}}}),/specification drift/);}));
test('top five vs accumulated metrics remain distinct',()=>{const evidence=Array.from({length:6},(_,i)=>({documentName:i===5?'doc':'other',versionId:'v',page:1,paragraph:1,startOffset:0,endOffset:4,text:'fact'}));const run={id:'r',status:'COMPLETED',request:{mode:'vector'},snapshot,result:{evidence,answer:'fact',citationValid:true,abstained:false}};const row=deriveRow(run,{id:'q',answerable:true,expectedAnswer:'fact',evidence:[{documentName:'doc',quote:'fact',sourceHash:'h'}]});assert.equal(row.recallAt5,0);assert.equal(row.accumulatedRecall,1);assert.equal(row.accumulatedMrr,1/6);assert.equal(row.answerCorrect,null);assert.equal(row.referenceAnswerMatch,true);});
test('actual independent planner and generation public configuration drift rejected',()=>{
 const config={modelMode:'real',...spec.modelConfig,topK:5,temperature:0,provider:{chatEndpoint:'https://chat'},agentPolicyVersion:'v1',agentPlanner:{model:'independent-planner',endpoint:'https://planner',temperature:0}};
 const run={kbId:'kb',request:spec.body,snapshot,config};
 const frozen={...spec,serverConfig:config,baselineConfig:{topK:5,temperature:0,provider:config.provider}};
 verifyRun(run,frozen);
 for(const changed of [{...config,agentPlanner:{...config.agentPlanner,model:'other'}},{...config,agentPlanner:{...config.agentPlanner,endpoint:'https://other'}},{...config,temperature:1},{...config,agentPolicyVersion:'v2'},{...config,provider:{chatEndpoint:'https://other'}},{...config,topK:10}])assert.throws(()=>verifyRun({...run,config:changed},frozen),/drift/);
});

test('async queued execute polls same task and never submits again',()=>temp(async root=>{
 const backing=fixture();let queued=false,polls=0,executeCalls=0;
 const api={async request(path,body){
  if(path.endsWith('/execute')){executeCalls++;const r=await backing.request(path,body);queued=true;return {...r,status:'CREATED',taskId:'r',taskStatus:'QUEUED'};}
  const r=await backing.request(path,body);
  if(queued&&path==='/api/agent-runs/r'&&polls++===0)return {...r,status:'CREATED',taskId:'r',taskStatus:'QUEUED'};
  return r;
 }};
 const run=await collectAgent(api,{root,id:'async-case',spec,pollMs:1,maxPolls:5});
 assert.equal(run.status,'COMPLETED');assert.equal(executeCalls,1);assert.equal(polls,2);
}));
