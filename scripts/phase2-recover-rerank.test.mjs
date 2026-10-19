import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {recover,evaluationRow,missingPairs} from './phase2-recover-rerank.mjs';
import {save,read,sha,evaluation,assertComposite} from './phase2-client.mjs';
const options={candidateK:40,keywordWeight:1,rerank:true,citationStyle:'uuid'},runtime={commit:'frozen'};
const dataset={version:'fixture',questions:Array.from({length:16},(_,i)=>({id:'q'+i,question:'Question '+i,answerable:false,evidence:[]}))};
const versions=[{id:'d',name:'doc',version_id:'v',content_hash:'hash',chunk_strategy:'structure-v1',chunk_size:900,chunk_overlap:200}];
async function fixture(action){
  const root=mkdtempSync(join(tmpdir(),'citebase-recover-'));let calls=0;const history=[];
  const original={id:'old',status:'RUNNING',config:{dataset,retrievalOptions:options,topK:5,dataVersions:versions},results:dataset.questions.flatMap(c=>['vector','hybrid'].map(mode=>({caseId:c.id,mode,untouched:true}))).slice(0,25)};
  save(root+'/c-rerank.interrupted.raw.json',original);
  save(root+'/c-rerank.state.json',{spec:{runtime,kbId:'kb',options,topK:5,datasetSha256:sha(JSON.stringify(dataset))}});
  const api={request:async(path,body)=>{
    if(path.endsWith('/documents'))return [{id:'d',activeVersionId:'v'}];
    if(path.endsWith('/versions'))return [{id:'v',contentHash:'hash',chunkStrategy:'structure-v1',chunkSize:900,chunkOverlap:200}];
    if(path.startsWith('/api/questions?'))return history;
    assert.equal(path,'/api/questions');calls++;
    const answer={id:'answer'+calls,question:body.question,mode:body.mode,modelMode:'real',retrievalOptions:options,diagnostics:{dataVersions:versions},evidence:[],answer:'无法回答',error:null,abstained:true,citationValid:true,usage:null};
    history.push(answer);return answer;
  }};
  try{await action({root,original,api,history,calls:()=>calls});}finally{assert(resolve(root).startsWith(resolve(tmpdir())+sep));assert(root.split(sep).at(-1).startsWith('citebase-recover-'));rmSync(root,{recursive:true});}
}
test('recover only seven missing rows, preserve 25 and raw answers, reuse composite without API',()=>fixture(async({root,original,api,calls})=>{
  const result=await recover(api,{root,runtime});assert.equal(calls(),7);assert.deepEqual(result.results.slice(0,25),original.results);
  assert.equal(result.recovery.operationalInterruption.usage,null);assert.equal(result.recovery.operationalInterruption.qualityError,false);
  assertComposite(result,{dataset,runtime,kbId:'kb'});
  await recover(api,{root,runtime});assert.equal(calls(),7);
  await evaluation({request:()=>{throw Error('No API allowed');}},{root,id:'c-rerank',kbId:'kb',dataset,options,runtime});
  assert.equal(read(root+'/c-rerank.interrupted.raw.json').status,'RUNNING');
}));
test('lost response reconciles one new persisted history answer without repeating POST',()=>fixture(async({root,api,calls})=>{
  const request=api.request;let lose=true;api.request=async(path,body)=>{const result=await request(path,body);if(body&&lose){lose=false;throw Error('lost response');}return result;};
  await assert.rejects(recover(api,{root,runtime}),/lost response/);assert.equal(calls(),1);
  await recover(api,{root,runtime});assert.equal(calls(),7);
  assert.equal(read(root+'/c-rerank.recovery/q12.hybrid.receipt.json').source,'uniquely-reconciled-history');
}));
test('unknown submission with no history cannot be retried or masquerade as complete',()=>fixture(async({root,api,calls})=>{
  const request=api.request;api.request=async(path,body)=>{if(body)throw Error('unknown network outcome');return request(path,body);};
  await assert.rejects(recover(api,{root,runtime}),/unknown network/);
  api.request=request;await assert.rejects(recover(api,{root,runtime}),/exactly one new match/);
  assert.equal(calls(),0);assert(!existsSync(root+'/c-rerank.raw.json'));
}));
test('multiple history matches reject, active source/runtime changes reject before payment',()=>fixture(async({root,api,history,calls})=>{
  await assert.rejects(recover(api,{root,runtime:{commit:'changed'}}),/Runtime differs/);
  const request=api.request;api.request=async(path,body)=>{const result=await request(path,body);if(body){history.push({...result,id:'ambiguous'});throw Error('lost');}return result;};
  await assert.rejects(recover(api,{root,runtime}),/lost/);api.request=request;
  await assert.rejects(recover(api,{root,runtime}),/exactly one new match/);assert.equal(calls(),1);
  api.request=async(path,body)=>path.endsWith('/documents')?[{id:'foreign',activeVersionId:'other'}]:request(path,body);
  await assert.rejects(recover(api,{root,runtime}),/snapshot changed/);assert.equal(calls(),1);
}));
test('incomplete or tampered composite cannot be loaded',()=>fixture(async({root,api})=>{
  const run=await recover(api,{root,runtime});const args={dataset,runtime,kbId:'kb'};
  assert.throws(()=>assertComposite({...run,results:run.results.slice(1)},args),/32 rows/);
  assert.throws(()=>assertComposite({...run,results:[...run.results.slice(0,31),run.results[0]]},args),/case\/mode/);
  const changed=structuredClone(run);changed.results[0].untouched=false;assert.throws(()=>assertComposite(changed,args),/Original rows changed/);
  save(run.rawSources[1].file,{forged:true});assert.throws(()=>assertComposite(run,args),/raw source changed/);
}));
test('actual provider error stays quality error, normal refusal passes; no correctness inference',()=>{
  const answer={evidence:[],answer:'无法回答',error:'Rerank failed',abstained:true,citationValid:true};
  const row=evaluationRow(answer,dataset.questions[0],versions,{});assert.equal(row.abstentionCorrect,false);assert.equal(row.error,'Rerank failed');assert.equal(row.answerCorrect,null);
  assert.equal(evaluationRow({...answer,error:null},dataset.questions[0],versions,{}).abstentionCorrect,true);
  assert.equal(evaluationRow(answer,{...dataset.questions[0],answerable:true},versions,{}).abstentionCorrect,null);
  assert.throws(()=>missingPairs({results:[{caseId:'bad',mode:'vector'}]},dataset),/Unexpected/);
});
