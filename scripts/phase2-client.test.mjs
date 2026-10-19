import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {evaluation,save,sha} from './phase2-client.mjs';
const dataset={version:'fixture',questions:[{id:'a'}]},runtime={commit:'fixture'},options={rerank:false};
async function fixture(action){const root=mkdtempSync(join(tmpdir(),'citebase-client-'));try{await action(root);}finally{assert(resolve(root).startsWith(resolve(tmpdir())+sep));assert(root.split(sep).at(-1).startsWith('citebase-client-'));rmSync(root,{recursive:true});}}
const spec={kbId:'kb',datasetSha256:sha(JSON.stringify(dataset)),options,topK:5,runtime};
const args=root=>({root,id:'x',kbId:'kb',dataset,options,runtime});
test('uncertain prior submit never blindly posts a paid run',()=>fixture(async root=>{
  save(root+'/x.state.json',{id:'x',spec,status:'SUBMITTING'});const calls=[];
  await assert.rejects(evaluation({request:async(path,body)=>{calls.push({path,body});return[];}},args(root)),/Uncertain submission/);
  assert.equal(calls.length,1);assert.equal(calls[0].body,undefined);
}));
test('server-persisted run is adopted without another POST, including failed rows',()=>fixture(async root=>{
  const run={id:'r',name:'p2opt-x',status:'COMPLETED_WITH_ERRORS',config:{dataset,retrievalOptions:options,topK:5,dataVersions:[{id:'doc',version_id:'v1'}]},results:[{caseId:'a',mode:'vector',error:'timeout'},{caseId:'a',mode:'hybrid'}]};const calls=[];
  const result=await evaluation({request:async(path,body)=>{calls.push({path,body});return path==='/api/evaluations'?[run]:path.endsWith('/documents')?[{id:'doc',activeVersionId:'v1'}]:run;}},args(root));
  assert.equal(result.results[0].error,'timeout');assert(calls.every(x=>x.body===undefined));
  assert.deepEqual(JSON.parse(readFileSync(root+'/x.raw.json')),run);
}));

test('same-name server run from another KB is rejected without any paid POST',()=>fixture(async root=>{
  const run={id:'r',name:'p2opt-x',status:'COMPLETED',config:{dataset,retrievalOptions:options,topK:5,dataVersions:[{id:'foreign',version_id:'v1'}]},results:[{},{}]};const calls=[];
  await assert.rejects(evaluation({request:async(path,body)=>{calls.push({path,body});return path==='/api/evaluations'?[run]:path.endsWith('/documents')?[{id:'owned',activeVersionId:'v1'}]:run;}},args(root)),/another KB/);
  assert(calls.every(call=>call.body===undefined));
}));

test('known run ID resumes directly even when it falls outside the recent list',()=>fixture(async root=>{
  save(root+'/x.state.json',{id:'x',spec,status:'RUNNING',runId:'old-run'});
  const run={id:'old-run',status:'COMPLETED',config:{dataset,retrievalOptions:options,topK:5,dataVersions:[]},results:[{caseId:'a',mode:'vector'},{caseId:'a',mode:'hybrid'}]};
  const calls=[];await evaluation({request:async(path,body)=>{calls.push(path);assert.equal(body,undefined);return path.endsWith('/documents')?[]:run;}},args(root));assert(!calls.includes('/api/evaluations'));
}));
test('partial failed run remains immutable and cannot become a passing resumed run',()=>fixture(async root=>{
  save(root+'/x.state.json',{id:'x',spec,status:'FAILED'});save(root+'/x.raw.json',{status:'FAILED',results:[]});
  await assert.rejects(evaluation({request:()=>{throw Error('Must not call provider');}},args(root)),/failed\/interrupted/);
  assert.equal(JSON.parse(readFileSync(root+'/x.raw.json')).status,'FAILED');
}));
