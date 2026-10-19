import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha,read,save,immutable,client,evaluation} from './phase2-client.mjs';
import {execute,costDeploymentGuard} from './quality-assisted-cost-independent.mjs';
import {guardRecovery,verifyManifest,validateRun,comparableCalls} from './quality-assisted-cost-recover.mjs';
import {assertRequestedSubset} from './phase2-comparability.mjs';
import {verifySnapshot} from './quality-assisted-agent-collector.mjs';
const ref=file=>({file:path.resolve(file),sha256:sha(fs.readFileSync(file))});
const filesIn=root=>fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesIn(path.join(root,e.name)):[path.join(root,e.name)]).sort();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const specFor=(spec,runtime)=>({kbId:spec.kbId,datasetSha256:sha(JSON.stringify(spec.dataset)),options:spec.options,topK:spec.topK,runtime});
const terminal=new Set(['SUCCEEDED','COMPLETED','COMPLETED_WITH_ERRORS','FAILED','CANCELLED']);
function checkRefs(refs){for(const source of refs)assert.equal(sha(fs.readFileSync(source.file)),source.sha256,`Recovery source changed: ${source.file}`);}
export function verifyChain(manifest,seen=new Set()) {
 if(manifest.schema==='citebase-assisted-cost-recovery-v1'){
  verifyManifest(manifest);assert.deepEqual(manifest.segments,[{id:'original',runtime:manifest.originalRuntime},{id:'recovery',runtime:manifest.currentRuntime}]);
  const {startedAt:a,...before}=manifest.originalRuntime,{startedAt:b,...after}=manifest.currentRuntime;assert.deepEqual(before,after,'Recovery runtime identity changed');assert(Number.isFinite(Date.parse(b))&&Date.parse(b)>Date.parse(a));return manifest.segments;
 }
 assert.equal(manifest.schema,'citebase-assisted-cost-recovery-chain-v1');
 assert(!seen.has(manifest.previousManifest.file),'Recovery manifest cycle');seen.add(manifest.previousManifest.file);
 checkRefs([manifest.previousManifest,...manifest.originalFiles,manifest.interrupted.evaluation,manifest.interrupted.task]);
 const previous=read(manifest.previousManifest.file),segments=verifyChain(previous,seen);
 assert.equal(manifest.registrationSha256,previous.registrationSha256);
 assert.deepEqual(manifest.originalRuntime,previous.originalRuntime);
 assert.deepEqual(manifest.segments.slice(0,-1),segments);
 const before=segments.at(-1).runtime,{startedAt:oldStart,...oldIdentity}=before,{startedAt:newStart,...newIdentity}=manifest.currentRuntime;
 assert.deepEqual(oldIdentity,newIdentity,'Recovery runtime identity changed');
 assert(Number.isFinite(Date.parse(newStart))&&Date.parse(newStart)>Date.parse(oldStart),'Recovery requires later runtime');
 assert.deepEqual(manifest.segments.at(-1).runtime,manifest.currentRuntime);
 assert.equal(manifest.continuousLatencyComparable,false);
 return manifest.segments;
}
function verifyJournalSegment(journal,segments){
 const index=segments.findIndex(s=>same(s.runtime,journal.spec.runtime));assert(index>=0,'Unregistered journal runtime');
 const created=Date.parse(journal.createdAt),start=Date.parse(segments[index].runtime.startedAt),end=index+1<segments.length?Date.parse(segments[index+1].runtime.startedAt):Infinity;
 assert(Number.isFinite(created)&&created>=start&&created<end,'Journal creation does not belong to recorded runtime segment');
}
function specification(plan,state,dataset,journalId){
 const prefix=`CostIndependent-${sha(JSON.stringify(plan)).slice(0,20)}`;
 const item=plan.items.find(x=>`${prefix}-${x.batchId}-${x.arm}`===journalId);assert(item,'Unregistered journal');
 const q=dataset.questions.find(x=>x.id===item.baseCaseId);assert(q);
 return {id:journalId,kbId:state.kbId,dataset:{version:dataset.version,questions:item.questions.map(x=>({...q,id:x.caseId}))},options:item.arm==='control'?plan.freeze.baselineOptions:plan.freeze.selectedOptions,topK:5};
}
export function prepareChain(root,recoveryRoot,previousRoot,plan,current,{bytes=fs.readFileSync}={}){
 root=path.resolve(root);recoveryRoot=path.resolve(recoveryRoot);previousRoot=path.resolve(previousRoot);
 assert(recoveryRoot!==root&&!recoveryRoot.startsWith(root+path.sep),'Recovery outside original root required');
 assert(recoveryRoot!==previousRoot&&!recoveryRoot.startsWith(previousRoot+path.sep),'Separate recovery directory required');
 guardRecovery(plan,current,bytes);
 const previousFile=path.join(previousRoot,'manifest.json'),previous=read(previousFile),segments=verifyChain(previous);
 assert.equal(previous.registrationSha256,sha(JSON.stringify(plan)));assert.deepEqual(previous.originalRuntime,plan.freeze.runtime);
 const {startedAt:oldStart,...identity}=segments.at(-1).runtime,{startedAt:newStart,...actual}=current;
 assert.deepEqual(actual,identity);assert(Date.parse(newStart)>Date.parse(oldStart),'New recovery must follow latest segment');
 const manifestFile=path.join(recoveryRoot,'manifest.json');
 if(fs.existsSync(manifestFile)){const existing=read(manifestFile);verifyChain(existing);assert.deepEqual(existing.currentRuntime,current);assert.equal(existing.previousManifest.file,previousFile);return existing;}
 assert.deepEqual(read(path.join(root,'registration.json')),plan);
 const state=read(path.join(root,'state.json'));assert(state.indexed&&state.smokeCompleted&&!state.collectionCompleted);
 const dataset=JSON.parse(bytes(plan.freeze.dataset.file));
 const journals=filesIn(path.join(root,'runs')).filter(f=>f.endsWith('.state.json'));
 const missing=[];
 for(const file of journals){
  const j=read(file);assert(j.runId,'Unknown submission cannot be adopted');
  verifyJournalSegment(j,[...segments,{runtime:current}]);
  const spec=specification(plan,state,dataset,j.id);assert.deepEqual(j.spec,specFor(spec,j.spec.runtime));
  const raw=file.replace('.state.json','.raw.json');
  if(!fs.existsSync(raw)){missing.push({file,j,spec});continue;}
  const run=read(raw);assert(terminal.has(run.status),'Saved run is not terminal');validateRun(run,j,spec,state.documents);
  if(j.rawSha256)assert.equal(sha(fs.readFileSync(raw)),j.rawSha256,'Saved raw changed');
 }
 assert.equal(missing.length,1,'Exactly one interrupted journal required');
 const {j:journal,spec}=missing[0];assert.deepEqual(journal.spec.runtime,segments.at(-1).runtime,'Interrupted journal must belong to previous live segment');
 const evaluationFile=path.join(recoveryRoot,'interrupted-evaluation.json'),taskFile=path.join(recoveryRoot,'interrupted-task.json');
 const run=read(evaluationFile),task=read(taskFile);
 assert(terminal.has(run.status));assert(['SUCCEEDED','FAILED','CANCELLED'].includes(task.status));
 assert.equal(run.id,journal.runId);assert.equal(task.id,journal.runId);assert.equal(run.taskId,task.id);assert.equal(task.kind,'EVALUATION');
 assert.equal(task.status,run.status==='COMPLETED'||run.status==='COMPLETED_WITH_ERRORS'?'SUCCEEDED':run.status);
 assert.equal(task.kbId,state.kbId);assert.equal(task.payload.kbId,state.kbId);assert.equal(task.payload.name,run.name);
 assert.deepEqual(comparableCalls(run.externalCalls),comparableCalls(task.externalCalls));
 validateRun(run,journal,spec,state.documents);
 assertRequestedSubset(task.payload.dataset,spec.dataset);assertRequestedSubset(task.payload.retrievalOptions,spec.options);assert.equal(task.payload.topK,spec.topK);
 const item=plan.items.find(x=>journal.id.endsWith(`-${x.batchId}-${x.arm}`));
 const config={...run.config};delete config.dataset;assert.deepEqual(config,read(path.join(root,`${item.arm}-config.json`)));
 assert.deepEqual(run.config.dataVersions,read(path.join(root,'snapshot.json')));
 const manifest={schema:'citebase-assisted-cost-recovery-chain-v1',createdAt:new Date().toISOString(),registrationSha256:sha(JSON.stringify(plan)),previousManifest:ref(previousFile),originalRuntime:plan.freeze.runtime,currentRuntime:current,segments:[...segments,{id:`recovery-${segments.length}`,runtime:current}],continuousLatencyComparable:false,interpretation:'Additional restart segment; no continuous latency comparison. Terminal results and UNKNOWN calls are preserved, never resubmitted.',originalFiles:[...filesIn(root),...filesIn(previousRoot)].map(ref),interrupted:{evaluation:ref(evaluationFile),task:ref(taskFile),runId:run.id,journalId:journal.id,externalCalls:task.externalCalls}};
 immutable(manifestFile,manifest);verifyChain(manifest);return manifest;
}
export async function recoverChain(root,recoveryRoot,previousRoot,plan,current,api,{bytes=fs.readFileSync,guard=()=>costDeploymentGuard(current),evaluate=evaluation,collector=execute}={}){
 guard();const manifest=prepareChain(root,recoveryRoot,previousRoot,plan,current,{bytes});
 const stateFile=path.join(root,'state.json'),original=fs.readFileSync(stateFile),state=JSON.parse(original);
 const raw=path.join(root,'runs',`${manifest.interrupted.journalId}.raw.json`);
 if(fs.existsSync(raw))assert.equal(sha(fs.readFileSync(raw)),manifest.interrupted.evaluation.sha256);else fs.copyFileSync(manifest.interrupted.evaluation.file,raw,fs.constants.COPYFILE_EXCL);
 const key=manifest.interrupted.journalId.replace(`CostIndependent-${manifest.registrationSha256.slice(0,20)}-`,'');
 immutable(path.join(root,'tasks',`${key}.json`),read(manifest.interrupted.task.file));
 immutable(path.join(recoveryRoot,'recovery-provenance.json'),ref(fileURLToPath(import.meta.url)));
 const wrapped=async(api,spec)=>{
  guard();verifyChain(manifest);verifySnapshot(read(path.join(root,'snapshot.json')),await api.request(`/api/knowledge-bases/${state.kbId}/documents`));
  const journalFile=path.join(spec.root,`${spec.id}.state.json`),rawFile=path.join(spec.root,`${spec.id}.raw.json`);
  if(fs.existsSync(rawFile)){
   const j=read(journalFile);verifyJournalSegment(j,manifest.segments);assert.deepEqual(j.spec,specFor(spec,j.spec.runtime));
   // Existing files are hash-protected by the manifest; newly collected journals must use this segment.
   if(!manifest.originalFiles.some(f=>f.file===path.resolve(journalFile)))assert.deepEqual(j.spec.runtime,current);
   const run=read(rawFile);assert(terminal.has(run.status));validateRun(run,j,spec,state.documents);
   if(j.rawSha256)assert.equal(sha(fs.readFileSync(rawFile)),j.rawSha256);return run;
  }
  if(fs.existsSync(journalFile))throw new Error('Unresolved submission must be exported and adopted in a new recovery segment; never resubmit');
  return evaluate(api,{...spec,runtime:current});
 };
 try{const result=await collector('collect',root,plan,api,{guard,bytes,evaluate:wrapped});save(path.join(recoveryRoot,'collection-state.json'),result);return result;}
 finally{fs.writeFileSync(stateFile,original);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,root,recoveryRoot,previousRoot,runtimeFile]=process.argv.slice(2);assert(['prepare','collect'].includes(mode)&&root&&recoveryRoot&&previousRoot&&runtimeFile);
 const plan=read(path.join(root,'registration.json')),current=read(runtimeFile);
 if(mode==='prepare'){prepareChain(root,recoveryRoot,previousRoot,plan,current);}
 else{guardRecovery(plan,current);costDeploymentGuard(current);process.env.CITEBASE_URL=current.apiUrl;await recoverChain(root,recoveryRoot,previousRoot,plan,current,await client());}
}
