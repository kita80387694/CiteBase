import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha,read,save,immutable,client,evaluation,pause} from './phase2-client.mjs';
import {register,costDeploymentGuard} from './quality-assisted-cost-independent.mjs';
import {verifySnapshot} from './quality-assisted-agent-collector.mjs';
import {recoverChain} from './quality-assisted-cost-recover-chain.mjs';
const ref=file=>({file:path.resolve(file),sha256:sha(fs.readFileSync(file))});
function checkedRef(input){assert(input&&typeof input.file==='string'&&/^[a-f0-9]{64}$/.test(input.sha256));assert.equal(sha(fs.readFileSync(input.file)),input.sha256,'Investigated failure evidence changed');return read(input.file);}
export function validateClearance(root,plan,clearance){
 assert.equal(clearance?.schema,'citebase-cost-investigated-failure-clearance-v1');assert.equal(clearance.registrationSha256,sha(JSON.stringify(plan)));
 assert(Number.isFinite(Date.parse(clearance.investigatedAt)));assert.equal(clearance.source,'ENGINEERING_INVESTIGATION');
 assert(Array.isArray(clearance.entries)&&clearance.entries.length>0);const keys=new Set();
 for(const e of clearance.entries){
  assert.equal(e.error,'PROVIDER_TIMEOUT','Only investigated provider timeout is eligible; source/config drift never cleared');
  assert(['vector','hybrid'].includes(e.mode));assert(typeof e.caseId==='string'&&typeof e.runId==='string');
  const key=JSON.stringify([e.runId,e.caseId,e.mode,e.error]);assert(!keys.has(key),'Duplicate clearance');keys.add(key);
  assert(typeof e.investigation==='string'&&e.investigation.trim().length>=30,'Explicit investigation required');
  const raw=checkedRef(e.raw),task=checkedRef(e.task),journal=checkedRef(e.journal);
  assert.equal(raw.id,e.runId);assert.equal(raw.taskId??raw.id,task.id);assert.equal(journal.runId,e.runId);
  assert(['COMPLETED','COMPLETED_WITH_ERRORS','SUCCEEDED','FAILED'].includes(raw.status));assert(['SUCCEEDED','FAILED'].includes(task.status));
  assert.equal(task.kind,'EVALUATION');assert(Array.isArray(task.externalCalls),'Task external call ledger required');
  const stem=path.join(path.resolve(root),'runs',journal.id);assert.equal(path.resolve(e.raw.file),stem+'.raw.json');assert.equal(path.resolve(e.journal.file),stem+'.state.json');
  assert.equal(sha(fs.readFileSync(e.raw.file)),journal.rawSha256,'Journal must bind saved raw bytes');
  assert.equal(raw.results.filter(r=>r.caseId===e.caseId&&r.mode===e.mode&&r.error===e.error).length,1,'Clearance does not identify one saved failure');
 }
 return clearance;
}
export function assertInfrastructureCleared(root,plan,clearance,run){
 validateClearance(root,plan,clearance);
 for(const row of run.results){
  if(!/PROVIDER|SOURCE_CHANGED|CONFIG_CHANGED/.test(row.error??''))continue;
  const entry=clearance.entries.find(e=>e.runId===run.id&&e.caseId===row.caseId&&e.mode===row.mode&&e.error===row.error);assert(entry,'Infrastructure failure retained; investigate before resuming');assert.deepEqual(run,read(entry.raw.file),'Allowed failure cannot alter any saved result');
 }
}
export async function executeInvestigated(stage,root,plan,api,{guard=()=>costDeploymentGuard(plan.freeze.runtime),bytes=fs.readFileSync,wait=pause,evaluate=evaluation,clearance}={}){
 assert.equal(stage,'collect','Investigated continuation is collect-only');validateClearance(root,plan,clearance);
 assert(['seed','smoke','collect'].includes(stage));guard();assert.deepEqual(register(plan.freeze,plan.freeze.runtime,bytes),plan);const dataset=JSON.parse(bytes(plan.freeze.dataset.file));fs.mkdirSync(root,{recursive:true});immutable(`${root}/registration.json`,plan);
 const dependencies=['quality-assisted-cost-independent.mjs','quality-assisted-independent.mjs','quality-assisted-agent-collector.mjs','phase2-client.mjs','phase2-comparability.mjs','phase2-metrics.mjs'];immutable(`${root}/collector-provenance.json`,{scope:'collector-not-backend',files:Object.fromEntries(dependencies.map(n=>[n,sha(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),n)))]))});
 const journal=`${root}/state.json`,id=sha(JSON.stringify(plan)),prefix=`CostIndependent-${id.slice(0,20)}`;const state=fs.existsSync(journal)?read(journal):{registrationSha256:id};assert.equal(state.registrationSha256,id);const persist=()=>save(journal,state);persist();
 if(!state.kbId){assert.equal(stage,'seed');const found=(await api.request('/api/knowledge-bases')).filter(k=>k.name===prefix);assert(found.length<=1);if(!state.createIntent){assert.equal(found.length,0,'Do not adopt unrelated KB');state.createIntent={name:prefix};persist();}guard();state.kbId=(found[0]??await api.request('/api/knowledge-bases',{name:prefix})).id;persist();}
 fs.mkdirSync(`${root}/tasks`,{recursive:true});
 const audit=async(taskId,label)=>{const file=`${root}/tasks/${label}.json`;if(fs.existsSync(file))return;let task;for(let p=0;p<120;p++){task=await api.request(`/api/tasks/${taskId}`);if(['SUCCEEDED','FAILED','CANCELLED'].includes(task.status))break;await wait(1000);}assert(['SUCCEEDED','FAILED','CANCELLED'].includes(task.status),'Task pending: resume same journal');immutable(file,task);};
 if(stage==='seed'){const initial=await api.request(`/api/knowledge-bases/${state.kbId}/documents`);assert(initial.every(d=>plan.documents.some(m=>m.documentName===d.name)));for(const d of plan.documents){guard();const file=path.join(path.dirname(plan.freeze.manifest.file),'documents',d.documentName);assert.equal(sha(bytes(file)),d.sourceHash);await api.upload(state.kbId,file,plan.freeze.chunkProfile);}let ok=false;for(let p=0;p<600;p++){const docs=await api.request(`/api/knowledge-bases/${state.kbId}/documents`);assert(!docs.some(d=>d.status==='FAILED'));if(docs.length===12&&docs.every(d=>d.status==='SUCCESS')){state.documents=docs;ok=true;break;}await wait(1000);}assert(ok,'Index pending');immutable(`${root}/indexed-documents.json`,state.documents);for(const t of await api.request(`/api/tasks?kbId=${state.kbId}&kind=INDEX`))await audit(t.id,`index-${t.id}`);state.indexed=true;persist();return state;}
 assert(state.indexed,'Seed first');if(stage==='collect')assert(state.smokeCompleted,'Smoke first');
 for(const item of plan.items.filter(x=>stage==='collect'||plan.smokeCaseIds.includes(x.baseCaseId))){guard();const q=dataset.questions.find(q=>q.id===item.baseCaseId),key=`${item.batchId}-${item.arm}`;const opts=item.arm==='control'?plan.freeze.baselineOptions:plan.freeze.selectedOptions;
 const run=await evaluate(api,{root:`${root}/runs`,id:`${prefix}-${key}`,kbId:state.kbId,dataset:{version:dataset.version,questions:item.questions.map(x=>({...q,id:x.caseId}))},options:opts,topK:5,runtime:plan.freeze.runtime});
 assert.equal(run.results.length,item.questions.length*2);assert.deepEqual(run.results.map(r=>[r.caseId,r.mode]).sort(),item.questions.flatMap(x=>['vector','hybrid'].map(m=>[x.caseId,m])).sort());verifySnapshot(run.config.dataVersions,state.documents);immutable(`${root}/snapshot.json`,run.config.dataVersions);
 const config={...run.config};delete config.dataset;immutable(`${root}/${item.arm}-config.json`,config);for(const[k,v]of Object.entries(plan.freeze.runtime.modelConfig))assert.deepEqual(run.config[k],v,`Model configuration drift: ${k}`);await audit(run.taskId??run.id,key);
 immutable(`${root}/${key}-mapping.json`,{...item,runId:run.id,cache:run.results.map(r=>({caseId:r.caseId,phase:item.questions.find(q=>q.caseId===r.caseId).phase,mode:r.mode,observed:r.diagnostics?.cost?.cache??null})),source:'ASSISTED'});
 for(const row of run.results){if(!row.error){assert(row.citationValid);for(const c of row.citations??[])await api.request(`/api/evaluations/${run.id}/citations/${typeof c==='string'?c:c.id}`);}}assertInfrastructureCleared(root,plan,clearance,run);
 }
 if(stage==='smoke')state.smokeCompleted=true;else state.collectionCompleted=true;persist();return state;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[root,recoveryRoot,previousRoot,runtimeFile,clearanceFile]=process.argv.slice(2);assert(root&&recoveryRoot&&previousRoot&&runtimeFile&&clearanceFile);
 const plan=read(path.join(root,'registration.json')),runtime=read(runtimeFile),clearance=read(clearanceFile);validateClearance(root,plan,clearance);
 costDeploymentGuard(runtime);process.env.CITEBASE_URL=runtime.apiUrl;
 immutable(path.join(path.dirname(clearanceFile),'continuation-provenance.json'),{schema:'citebase-cost-investigated-continuation-provenance-v1',clearance:ref(clearanceFile),files:['quality-assisted-cost-continue-investigated.mjs','quality-assisted-cost-recover-chain.mjs','quality-assisted-cost-recover.mjs','quality-assisted-cost-independent.mjs'].map(f=>ref(path.join(path.dirname(fileURLToPath(import.meta.url)),f))),interpretation:'Only the hash-bound investigated failure is allowed to remain in the sample; no failed request is retried, no result is changed, and unregistered infrastructure failures stop collection.'});
 await recoverChain(root,recoveryRoot,previousRoot,plan,runtime,await client(),{collector:(stage,root,plan,api,options)=>executeInvestigated(stage,root,plan,api,{...options,clearance})});
}
