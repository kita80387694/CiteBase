import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sha,read,immutable,save,client,pause,evaluation} from './phase2-client.mjs';
import {BUDGET,collectAgent,verifySnapshot} from './quality-assisted-agent-collector.mjs';
export const STRATEGIES=['original','inspection-free-v1','stop-aware-v1','combined-v1','grounded-answer-v1','combined-grounded-v1'];
export const COLLECTOR_SOURCES=['quality-assisted-independent.mjs','quality-assisted-agent-collector.mjs','phase2-client.mjs','phase2-comparability.mjs','phase2-metrics.mjs'];
export function collectorProvenance(readBytes=fs.readFileSync){
 const directory=path.dirname(fileURLToPath(import.meta.url));
 return {scope:'collector-and-imported-dependencies-not-backend-runtime',files:Object.fromEntries(COLLECTOR_SOURCES.map(name=>[`scripts/${name}`,sha(readBytes(path.join(directory,name)))]))};
}
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function exact(value,keys,label){assert(value&&typeof value==='object'&&!Array.isArray(value),label);assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),`${label}: missing/unknown fields`);}
// No dataset bytes may be read before every freeze/runtime/development evidence check passes.
export function validateFreeze(freeze,currentRuntime,readBytes=fs.readFileSync){
 exact(freeze,['schema','frozenAt','selectedStrategy','devReport','dataset','manifest','runtime','retrieval','chunkProfile','budget'],'freeze');
 assert.equal(freeze.schema,'citebase-assisted-independent-freeze-v1');assert(Number.isFinite(Date.parse(freeze.frozenAt)));
 assert(STRATEGIES.includes(freeze.selectedStrategy),'Unrecognized selected strategy');
 for(const key of ['devReport','dataset','manifest']){exact(freeze[key],['file','sha256'],key);assert(typeof freeze[key].file==='string'&&freeze[key].file.length>0);assert(digest(freeze[key].sha256));}
 exact(freeze.runtime,['commit','sourceSha256','containerName','containerImageId','apiUrl','modelConfig'], 'runtime');
 assert(/^[a-f0-9]{40}$/.test(freeze.runtime.commit));assert(digest(freeze.runtime.sourceSha256));assert(/^sha256:[a-f0-9]{64}$/.test(freeze.runtime.containerImageId));assert(/^[a-z0-9_-]+$/i.test(freeze.runtime.containerName));
 const url=new URL(freeze.runtime.apiUrl);assert(['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol==='http:'&&url.port&&!url.username&&!url.password,'Only verified local runtime');
 assert(freeze.runtime.modelConfig?.chatModel&&freeze.runtime.modelConfig?.embeddingModel,'Missing model identities');
 assert.deepEqual(currentRuntime,freeze.runtime,'Runtime differs from freeze');
 assert.deepEqual(freeze.budget,BUDGET,'Budget must match preregistered ten-call bound');
 assert.deepEqual(freeze.retrieval,{mode:'vector',topK:5,options:{candidateK:20,keywordWeight:1,rerank:false,citationStyle:'uuid'}},'Retrieval baseline drift');
 assert.deepEqual(freeze.chunkProfile,{strategy:'structure-v1',size:900,overlap:200},'Chunk profile drift');
 const bytes=readBytes(freeze.devReport.file);assert.equal(sha(bytes),freeze.devReport.sha256,'Development report SHA drift');
 const report=JSON.parse(bytes);assert(report&&typeof report==='object','Invalid development report');
 assert.equal(report.source,'ASSISTED','Development review must identify ASSISTED source');
 assert.equal(report.complete,true,'Development review incomplete');
 assert.equal(report.qualitySelectable,true,'Development review cannot select quality policy');
 const eligibility=report.assistedEligibility;
 const selected=Array.isArray(eligibility)?eligibility.find(row=>row.strategy===freeze.selectedStrategy):eligibility?.[freeze.selectedStrategy];
 assert(selected&&selected.eligibleByAssistedGates===true,'Selected strategy is not eligible under completed assisted gates');
 return {freezeSha256:sha(JSON.stringify(freeze)),developmentReportVerified:true};
}
export function prepareIndependent(freeze,currentRuntime,readBytes=fs.readFileSync){
 const guard=validateFreeze(freeze,currentRuntime,readBytes);
 const bytes=readBytes(freeze.dataset.file);assert.equal(sha(bytes),freeze.dataset.sha256,'Independent dataset SHA drift');
 const dataset=JSON.parse(bytes);assert(Array.isArray(dataset.questions)&&dataset.questions.length===40,'Exactly forty independent questions required');
 assert(dataset.questions.every(q=>typeof q.id==='string'&&q.id.length>0&&q.split==='test'&&typeof q.answerable==='boolean'),'Every independent row must be explicitly test');
 assert.equal(new Set(dataset.questions.map(q=>q.id)).size,40,'Duplicate question IDs');
 const manifestBytes=readBytes(freeze.manifest.file);assert.equal(sha(manifestBytes),freeze.manifest.sha256,'Corpus manifest drift');
 const manifest=JSON.parse(manifestBytes);assert(Array.isArray(manifest.documents)&&manifest.documents.length===12,'Exactly twelve fixed corpus documents required');
 assert.equal(new Set(manifest.documents.map(d=>d.documentName)).size,12,'Duplicate document names');
 assert(manifest.documents.every(d=>typeof d.documentName==='string'&&/^[a-zA-Z0-9_-]+\.(md|txt|pdf)$/.test(d.documentName)&&digest(d.sourceHash)),'Invalid fixed document identity');
 const answerable=dataset.questions.find(q=>q.answerable),unanswerable=dataset.questions.find(q=>!q.answerable);assert(answerable&&unanswerable,'Smoke requires answerable and unanswerable cases');
 const caseIds=[answerable.id,unanswerable.id,...dataset.questions.filter(q=>q.id!==answerable.id&&q.id!==unanswerable.id).map(q=>q.id)];
 return {...guard,schema:'citebase-assisted-independent-registration-v1',freeze,caseIds,smokeCaseIds:caseIds.slice(0,2),documents:manifest.documents,limits:{questionCount:40,ragRows:80,ragTheoreticalCallCap:160,ragCallsPerRow:{embedding:1,chat:1,rerank:0},providerAttemptsPerCall:1,ragPrimaryMode:'vector',ragAuxiliaryMode:'hybrid',agentRuns:80,maxExternalCallsPerAgent:10,agentTheoreticalCallCap:800,indexing:'separate ledger; depends on fixed chunk profile, never counted as Agent budget',concurrency:1},gradingSource:'ASSISTED',humanReviewed:0,qualityConclusion:null,collectorStatus:'READY'};
}

export function deploymentGuard(runtime,inspect=execFileSync){
 const image=inspect('docker',['inspect',runtime.containerName,'--format','{{.Image}}'],{encoding:'utf8'}).trim();
 assert.equal(image,runtime.containerImageId,'Backend image changed');
 const ports=JSON.parse(inspect('docker',['inspect',runtime.containerName,'--format','{{json .NetworkSettings.Ports}}'],{encoding:'utf8'}));
 assert((ports['8080/tcp']??[]).some(p=>p.HostPort===new URL(runtime.apiUrl).port),'Backend port changed');
}
export async function executeIndependent(stage,root,plan,api,{guard=()=>deploymentGuard(plan.freeze.runtime),readBytes=fs.readFileSync,evaluate=evaluation,agent=collectAgent,wait=pause}={}){
 assert(['seed','smoke','collect'].includes(stage));guard();
 // Recheck freeze and hashes on every entry, before dataset parsing or any network write.
 const checked=prepareIndependent(plan.freeze,plan.freeze.runtime,readBytes);assert.deepEqual(plan,checked,'Registration drift');
 const dataset=JSON.parse(readBytes(plan.freeze.dataset.file));
 fs.mkdirSync(root,{recursive:true});immutable(`${root}/collector-provenance.json`,collectorProvenance());immutable(`${root}/registration.json`,plan);
 const journal=`${root}/state.json`,key=sha(JSON.stringify(plan));
 const state=fs.existsSync(journal)?read(journal):{registrationSha256:key};assert.equal(state.registrationSha256,key,'Journal drift');
 const persist=()=>save(journal,state),prefix=`Independent-${key.slice(0,20)}`;persist();
 if(!state.kbId){assert.equal(stage,'seed','Seed first');
  const found=(await api.request('/api/knowledge-bases')).filter(k=>k.name===prefix);assert(found.length<=1,'Ambiguous isolated KB');
  if(!state.kbCreationIntent){assert.equal(found.length,0,'Preexisting KB cannot be adopted without saved creation intent');state.kbCreationIntent={name:prefix};persist();}
  guard();state.kbId=(found[0]??await api.request('/api/knowledge-bases',{name:prefix})).id;persist();
 }
 const selected=plan.caseIds.map(id=>dataset.questions.find(q=>q.id===id));
 const audit=async(id,label)=>{const file=`${root}/tasks/${label}.json`;if(fs.existsSync(file))return;let task;for(let poll=0;poll<120;poll++){task=await api.request(`/api/tasks/${id}`);if(['SUCCEEDED','FAILED','CANCELLED'].includes(task.status))break;await wait(1000);}assert(['SUCCEEDED','FAILED','CANCELLED'].includes(task.status),'Task audit still active; resume same journal');immutable(file,task);};
 fs.mkdirSync(`${root}/tasks`,{recursive:true});
 if(stage==='seed'){
  const docs=await api.request(`/api/knowledge-bases/${state.kbId}/documents`);assert(docs.every(d=>plan.documents.some(p=>p.documentName===d.name)),'Unexpected corpus document');
  for(const doc of plan.documents){guard();const file=path.join(path.dirname(plan.freeze.manifest.file),'documents',doc.documentName);assert.equal(sha(readBytes(file)),doc.sourceHash,'Document bytes drift');await api.upload(state.kbId,file,plan.freeze.chunkProfile);}
  let complete=false;for(let i=0;i<600;i++){const docs=await api.request(`/api/knowledge-bases/${state.kbId}/documents`);assert(!docs.some(d=>d.status==='FAILED'),'Index failed; keep task and investigate');if(docs.length===12&&docs.every(d=>d.status==='SUCCESS')){state.documents=docs;complete=true;break;}await wait(1000);}assert(complete,'Index pending; resume journal');
  const tasks=await api.request(`/api/tasks?kbId=${state.kbId}&kind=INDEX`);for(const task of tasks)await audit(task.id,`index-${task.id}`);
  immutable(`${root}/indexed-documents.json`,state.documents);state.indexed=true;persist();return state;
 }
 assert(state.indexed,'Seed first');if(stage==='collect')assert(state.smokeCompleted,'Smoke must complete first');
 const groups=stage==='smoke'?[['smoke',selected.slice(0,2)]]:[['smoke',selected.slice(0,2)],['remaining',selected.slice(2)]];
 for(const [name,questions]of groups){guard();
  const rag=await evaluate(api,{root:`${root}/rag`,id:`${prefix}-${name}`,kbId:state.kbId,dataset:{version:dataset.version,questions},options:plan.freeze.retrieval.options,runtime:plan.freeze.runtime,topK:5});
  assert.equal(rag.results.length,questions.length*2,'Incomplete RAG rows');
  assert.deepEqual(rag.results.map(r=>r.caseId+':'+r.mode).sort(),questions.flatMap(q=>['vector','hybrid'].map(mode=>q.id+':'+mode)).sort());
  const snapshot=rag.config.dataVersions;verifySnapshot(snapshot,state.documents);immutable(`${root}/snapshot.json`,snapshot);
  const config={...rag.config};delete config.dataset;immutable(`${root}/rag-config.json`,config);
  for(const[k,v]of Object.entries(plan.freeze.runtime.modelConfig))assert.equal(rag.config[k],v,'RAG model drift');
  await audit(rag.taskId??rag.id,`rag-${name}`);
  for(const row of rag.results){if(!row.error){assert(row.citationValid);for(const c of row.citations??[])await api.request(`/api/evaluations/${rag.id}/citations/${typeof c==='string'?c:c.id}`);}}
  assert(!rag.results.some(r=>/PROVIDER|SOURCE_CHANGED|CONFIG_CHANGED/.test(r.error??'')),'RAG infrastructure failure retained');
  for(const q of questions){
   const pair={caseId:q.id,rag:{runId:rag.id,caseId:q.id,mode:'vector'},agents:{},gradingSource:'ASSISTED',humanReview:null};
   for(const arm of ['original','selected']){guard();const strategy=arm==='original'?'original':plan.freeze.selectedStrategy,id=`q${String(plan.caseIds.indexOf(q.id)).padStart(3,'0')}-${arm}`;
    const spec={body:{kbId:state.kbId,question:q.question,mode:'vector',topK:5,retrievalOptions:plan.freeze.retrieval.options,budget:plan.freeze.budget,strategy,idempotencyKey:`${prefix}-${id}`},snapshot,modelConfig:plan.freeze.runtime.modelConfig,runtime:plan.freeze.runtime};
    const run=await agent(api,{root:`${root}/agents`,id,spec,configFile:`${root}/${arm}-config.json`});
    await audit(run.taskId??run.id,id);pair.agents[arm]={runId:run.id,strategy,status:run.status};
    if(run.status==='COMPLETED'){assert(run.result?.citationValid);for(const c of run.result.citations??[])await api.request(`/api/citations/${typeof c==='string'?c:c.id}`);}
    assert(!/PROVIDER|SOURCE_CHANGED|CONFIG_CHANGED/.test(run.errorCode??''),'Agent infrastructure failure retained');
   }
   immutable(`${root}/q${String(plan.caseIds.indexOf(q.id)).padStart(3,'0')}-pair.json`,pair);
  }
 }
 if(stage==='smoke')state.smokeCompleted=true;else state.collectionCompleted=true;persist();return state;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [stage,...args]=process.argv.slice(2);
 if(stage==='register'){assert.equal(args.length,3);const plan=prepareIndependent(read(args[0]),read(args[1]));assert(!fs.existsSync(args[2]));immutable(args[2],plan);}
 else {assert(['seed','smoke','collect'].includes(stage)&&args.length===3,'Usage: seed|smoke|collect ROOT freeze.json current-runtime.json');const freeze=read(args[1]),runtime=read(args[2]);validateFreeze(freeze,runtime);deploymentGuard(runtime);const plan=prepareIndependent(freeze,runtime);process.env.CITEBASE_URL=runtime.apiUrl;await executeIndependent(stage,args[0],plan,await client());}
}
