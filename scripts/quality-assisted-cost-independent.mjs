import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sha,read,save,immutable,client,evaluation,pause} from './phase2-client.mjs';
import {deploymentGuard} from './quality-assisted-independent.mjs';
import {verifySnapshot} from './quality-assisted-agent-collector.mjs';
export const BASELINE={candidateK:20,keywordWeight:1,rerank:true,citationStyle:'uuid'};
const digest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function exact(v,keys){assert(v&&typeof v==='object'&&!Array.isArray(v));assert.deepEqual(Object.keys(v).sort(),[...keys].sort(),'Unknown/missing fields');}
export function options(v){
 assert(v&&typeof v==='object');assert(Object.keys(v).every(k=>['candidateK','keywordWeight','rerank','citationStyle','cache','deduplicate','rerankPolicy'].includes(k)),'Unknown retrieval option');
 assert(Number.isInteger(v.candidateK)&&v.candidateK>=5&&v.candidateK<=100);assert(Number.isFinite(v.keywordWeight)&&v.keywordWeight>=0&&v.keywordWeight<=4);assert(typeof v.rerank==='boolean');assert.equal(v.citationStyle,'uuid');
 for(const key of ['cache','deduplicate'])assert(v[key]===undefined||typeof v[key]==='boolean');assert(v.rerankPolicy===undefined||['always','candidate-pressure-v1'].includes(v.rerankPolicy));return v;
}
export function guardFreeze(f,current,bytes=fs.readFileSync){
 exact(f,['schema','frozenAt','devReport','selectedOptions','baselineOptions','runtime','dataset','manifest','chunkProfile']);assert.equal(f.schema,'citebase-assisted-cost-independent-freeze-v1');assert(Number.isFinite(Date.parse(f.frozenAt)));
 assert.deepEqual(f.baselineOptions,BASELINE);options(f.selectedOptions);assert.deepEqual(f.chunkProfile,{strategy:'structure-v1',size:900,overlap:200});
 for(const k of ['devReport','dataset','manifest']){exact(f[k],['file','sha256']);assert(typeof f[k].file==='string'&&f[k].file);assert(digest(f[k].sha256));}
 exact(f.runtime,['commit','sourceSha256','containerName','containerImageId','containerId','startedAt','apiUrl','modelConfig']);assert(/^[a-f0-9]{40}$/.test(f.runtime.commit));assert(digest(f.runtime.sourceSha256));assert(/^sha256:[a-f0-9]{64}$/.test(f.runtime.containerImageId));assert(/^[a-z0-9_-]+$/i.test(f.runtime.containerName));
 assert(digest(f.runtime.containerId));assert(Number.isFinite(Date.parse(f.runtime.startedAt)));
 const url=new URL(f.runtime.apiUrl);assert(['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol==='http:'&&url.port&&!url.username&&!url.password);assert(f.runtime.modelConfig?.chatModel&&f.runtime.modelConfig?.embeddingModel&&f.runtime.modelConfig?.reranker,'Model/reranker configuration required');assert.deepEqual(f.runtime,current,'Runtime drift');
 const raw=bytes(f.devReport.file);assert.equal(sha(raw),f.devReport.sha256);const report=JSON.parse(raw);assert.equal(report.source,'ASSISTED');assert.equal(report.complete,true);assert.equal(report.qualitySelectable,true);assert(typeof report.eligibleByAssistedGates==='boolean','Eligibility must be explicit');
 if(report.eligibleByAssistedGates)assert.equal(report.decision,'QUALITY_ELIGIBLE');
 else {assert.equal(report.decision,'EXPERIMENTAL_ONLY');assert.equal(report.defaultChanged,false);assert(typeof report.reason==='string'&&report.reason.trim().length>0,'Experimental selection requires explicit reason');}
 assert.deepEqual(report.selectedOptions,f.selectedOptions,'Development selected options differ');
 return sha(JSON.stringify(f));
}
export function schedule(questions){
 assert.equal(questions.length,40);assert.equal(new Set(questions.map(q=>q.id)).size,40);assert(questions.every(q=>typeof q.id==='string'&&q.split==='test'&&typeof q.answerable==='boolean'));
 const sorted=[...questions].sort((a,b)=>sha(a.id).localeCompare(sha(b.id),'en'));const smoke=[sorted.find(q=>q.answerable)?.id,sorted.find(q=>!q.answerable)?.id];assert(smoke.every(Boolean));
 const items=sorted.flatMap((q,i)=>{const group=i<20?'cold':i<30?'warm':'mixed';const phases=group==='cold'?['cold']:group==='warm'?['cold','warm']:['mixed-new','mixed-repeat'];const arms=parseInt(sha(q.id).slice(0,2),16)%2?['candidate','control']:['control','candidate'];return arms.map(arm=>({baseCaseId:q.id,batchId:`ci-${i}`,group,arm,questions:phases.map((phase,repeat)=>({caseId:`ci-${i}-${repeat}`,phase,repeat}))}));});
 return {items,smokeCaseIds:smoke,ordering:'SHA256(baseCaseId) ascending; groups 20 cold / 10 warm / 10 mixed; hash first-byte parity sets arm order, each arm batches first/repeat in same evaluation; single concurrency'};
}
export function register(f,current,bytes=fs.readFileSync){
 const freezeSha256=guardFreeze(f,current,bytes);const dev=JSON.parse(bytes(f.devReport.file));const developmentDecision={source:dev.source,eligibleByAssistedGates:dev.eligibleByAssistedGates,decision:dev.decision,defaultChanged:dev.defaultChanged??null,reason:dev.reason??null};const raw=bytes(f.dataset.file);assert.equal(sha(raw),f.dataset.sha256);const dataset=JSON.parse(raw),order=schedule(dataset.questions);
 const m=bytes(f.manifest.file);assert.equal(sha(m),f.manifest.sha256);const manifest=JSON.parse(m);assert.equal(manifest.documents?.length,12);assert.equal(new Set(manifest.documents.map(d=>d.documentName)).size,12);assert(manifest.documents.every(d=>/^[a-zA-Z0-9_-]+\.(md|txt|pdf)$/.test(d.documentName)&&digest(d.sourceHash)));
 return {schema:'citebase-assisted-cost-independent-registration-v1',freeze:f,freezeSha256,developmentDecision,...order,documents:manifest.documents,limits:{uniqueQuestions:40,pairedItems:60,arms:2,modes:2,ragRows:240,pairedModeRows:120,evaluationTasks:80,theoreticalProviderCalls:720,providerAttemptsPerCall:1,indexing:'separate ledger',concurrency:1},cacheInterpretation:'cold/warm/mixed are scheduled request labels only. Actual HIT/MISS is read from raw metadata. Each warm/mixed arm keeps repeated questions in the same evaluation and mode; cache hits still require actual metadata.',source:'ASSISTED',humanReviewed:0};
}
export function costDeploymentGuard(runtime,inspect=execFileSync){
 deploymentGuard(runtime,inspect);
 const state=JSON.parse(inspect('docker',['inspect',runtime.containerName,'--format','{"id":{{json .Id}},"startedAt":{{json .State.StartedAt}}}'],{encoding:'utf8'}));
 assert.equal(state.id,runtime.containerId,'Cost container replaced; cache continuity lost');
 assert.equal(state.startedAt,runtime.startedAt,'Cost container restarted; cache continuity lost');
}
export async function execute(stage,root,plan,api,{guard=()=>costDeploymentGuard(plan.freeze.runtime),bytes=fs.readFileSync,wait=pause,evaluate=evaluation}={}){
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
 for(const row of run.results){if(!row.error){assert(row.citationValid);for(const c of row.citations??[])await api.request(`/api/evaluations/${run.id}/citations/${typeof c==='string'?c:c.id}`);}}assert(!run.results.some(r=>/PROVIDER|SOURCE_CHANGED|CONFIG_CHANGED/.test(r.error??'')),'Infrastructure failure retained; investigate before resuming');
 }
 if(stage==='smoke')state.smokeCompleted=true;else state.collectionCompleted=true;persist();return state;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [stage,root,freezeFile,runtimeFile]=process.argv.slice(2);assert(['seed','smoke','collect'].includes(stage)&&root&&freezeFile&&runtimeFile);const f=read(freezeFile),runtime=read(runtimeFile);guardFreeze(f,runtime);costDeploymentGuard(runtime);const plan=register(f,runtime);process.env.CITEBASE_URL=runtime.apiUrl;await execute(stage,root,plan,await client());
}
