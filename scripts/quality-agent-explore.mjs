import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { client, read, save, immutable, pause, sha } from './phase2-client.mjs';
import { BUDGET, collectAgent, verifySnapshot, deriveRow } from './phase3-experiment.mjs';
export const STRATEGIES=['original','inspection-free-v1','stop-aware-v1','combined-v1'];
const SCRIPT_FILES=['scripts/quality-agent-explore.mjs','scripts/phase3-experiment.mjs','scripts/phase2-client.mjs','scripts/phase2-metrics.mjs'];
export function selectCases(dataset,baseline){
 assert.equal(baseline.caseIds.length,40);assert.equal(new Set(baseline.caseIds).size,40);
 const cohort=baseline.caseIds.map(id=>{const q=dataset.questions.find(q=>q.id===id);assert(q&&['dev','validation'].includes(q.split),'Test/unknown case in cohort');return q;});
 const selected=[];
 for(const split of ['dev','validation']){
  const order=(a,b)=>sha(a.id).localeCompare(sha(b.id),'en');
  const yes=cohort.filter(q=>q.split===split&&q.answerable).sort(order).slice(0,3);
  const no=cohort.filter(q=>q.split===split&&!q.answerable).sort(order).slice(0,1);
  assert.equal(yes.length,3);assert.equal(no.length,1);selected.push(yes[0],no[0],...yes.slice(1));
 }
 return selected;
}
export function exploreRegistration(dataset,bytes,baseline,baselineBytes,runtime,baselineConfig,scriptHashes){
 assert.equal(sha(bytes),baseline.datasetSha256,'Baseline dataset changed');
 assert(runtime.commit&&runtime.sourceSha256&&runtime.imageId&&runtime.containerName&&runtime.containerImageId,'Deployed runtime identity required');
 assert.equal(runtime.imageId,runtime.containerImageId,'Image capture differs from running backend');
 assert.equal(baselineConfig.modelMode,'real');
 const selected=selectCases(dataset,baseline);
 return {version:'quality-agent-exploration-v1',purpose:'Exploratory engineering ablation; no human quality selection or independent-test conclusion',datasetVersion:dataset.version,datasetSha256:sha(bytes),baselineRegistrationSha256:sha(baselineBytes),caseIds:selected.map(q=>q.id),selection:'From preregistered40 only: per dev/validation SHA256(id) ascending first3 answerable + first1 unanswerable; order answerable,unanswerable,answerable,answerable; no outcomes read',runtime,scriptHashes,retrieval:baseline.retrieval,chunkProfile:baseline.chunkProfile,modelConfig:{chatModel:baselineConfig.chatModel,embeddingModel:baselineConfig.embeddingModel},baselineConfig:Object.fromEntries(['modelMode','chatModel','embeddingModel','topK','fusion','rrfConstant','candidateK','retrievalOptions','reranker','keywordAnalyzer','temperature','provider'].filter(k=>baselineConfig[k]!==undefined).map(k=>[k,baselineConfig[k]])),strategies:STRATEGIES,budget:BUDGET,runOrder:'case-major; rotate strategy order by case index modulo4 to avoid always-late strategy',limits:{concurrency:1,agentRuns:32,maxExternalCallsPerRun:10,smokeRuns:8,indexingExcludedFromRunCap:true},smoke:{caseIds:selected.slice(0,2).map(q=>q.id),retainedAndReused:true},stopConditions:['provider/source/runtime/configuration drift','unknown transport outcome: reconcile journal','successful answer invalid citation'],humanScores:null,defaultChange:false};
}
export function executionOrder(plan){return plan.caseIds.flatMap((caseId,i)=>plan.strategies.map((_,j)=>({caseId,strategy:plan.strategies[(i+j)%plan.strategies.length]})));}
export function verifyDeployment(plan,image,ports,baseUrl){
 assert.equal(image,plan.runtime.containerImageId,'Running image changed');const base=new URL(baseUrl);assert(['localhost','127.0.0.1'].includes(base.hostname)&&base.protocol==='http:','Only local published backend allowed');assert((ports['8080/tcp']||[]).some(p=>p.HostPort===base.port),'API URL does not match captured container');
}
async function main(){
 const [stage,root,baselinePath,runtimePath]=process.argv.slice(2);
 assert(['seed','smoke','collect'].includes(stage)&&root&&baselinePath&&runtimePath,'Usage: quality-agent-explore.mjs seed|smoke|collect root baseline-registration.json lab-runtime.json');
 const datasetBytes=readFileSync('samples/phase3-quality/evaluation.json'),dataset=JSON.parse(datasetBytes),baselineBytes=readFileSync(baselinePath),baseline=JSON.parse(baselineBytes),runtime=read(runtimePath),baseConfig=read(`${dirname(baselinePath)}/rag-config.json`);
 const hashes=Object.fromEntries(SCRIPT_FILES.map(f=>[f,sha(readFileSync(f))]));
 const plan=exploreRegistration(dataset,datasetBytes,baseline,baselineBytes,runtime,baseConfig,hashes);
 mkdirSync(root,{recursive:true});immutable(`${root}/registration.json`,plan);
 const guard=()=>verifyDeployment(plan,execFileSync('docker',['inspect',runtime.containerName,'--format','{{.Image}}'],{encoding:'utf8'}).trim(),JSON.parse(execFileSync('docker',['inspect',runtime.containerName,'--format','{{json .NetworkSettings.Ports}}'],{encoding:'utf8'})),process.env.CITEBASE_URL||'http://localhost:28080');guard();
 const file=`${root}/state.json`,state=existsSync(file)?read(file):{registrationSha256:sha(JSON.stringify(plan)),createdAt:new Date().toISOString()};assert.equal(state.registrationSha256,sha(JSON.stringify(plan)),'Journal registration changed');const persist=()=>save(file,state);persist();
 const api=await client(),prefix=`AgentExplore-${state.registrationSha256.slice(0,12)}`;
 if(!state.kbId){assert.equal(stage,'seed','Seed first');const found=(await api.request('/api/knowledge-bases')).filter(k=>k.name===prefix);assert(found.length<=1);state.kbId=(found[0]||await api.request('/api/knowledge-bases',{name:prefix})).id;persist();}
 const selected=selectCases(dataset,baseline);
 const body=(q,strategy)=>({kbId:state.kbId,question:q.question,mode:plan.retrieval.mode,topK:plan.retrieval.topK,retrievalOptions:plan.retrieval.options,budget:plan.budget,strategy,idempotencyKey:`${prefix}-${q.id}-${strategy}`});
 if(stage==='seed'){
  const manifest=read('samples/phase3-quality/manifest.json');const docs=manifest.documents.filter(d=>['dev','validation'].includes(d.split));
  assert((await api.request(`/api/knowledge-bases/${state.kbId}/documents`)).every(d=>docs.some(x=>x.documentName===d.name)),'Unexpected isolated KB document');
  for(const d of docs){guard();const path=`samples/phase3-quality/documents/${d.documentName}`;assert.equal(sha(readFileSync(path)),d.sourceHash);await api.upload(state.kbId,path,plan.chunkProfile);}
  let done=false;for(let i=0;i<600;i++){const active=await api.request(`/api/knowledge-bases/${state.kbId}/documents`);assert(!active.some(d=>d.status==='FAILED'),'Index failure retained; inspect existing task');if(active.length===docs.length&&active.every(d=>d.status==='SUCCESS')){state.documents=active;done=true;break;}await pause(1000);}assert(done,'Index pending; resume same journal');
  // Persist intent before idempotent creation; creation has no planner/generation call.
  const bootstrapBody=body(selected[0],'original');immutable(`${root}/bootstrap-intent.json`,bootstrapBody);guard();
  const bootstrap=await api.request('/api/agent-runs',bootstrapBody);assert.equal(bootstrap.config.modelMode,'real');for(const[k,v]of Object.entries(plan.baselineConfig))assert.deepEqual(bootstrap.config[k],v,`Baseline configuration drift: ${k}`);
  verifySnapshot(bootstrap.snapshot,state.documents);immutable(`${root}/snapshot.json`,bootstrap.snapshot);immutable(`${root}/bootstrap-config.json`,bootstrap.config);state.bootstrapRunId=bootstrap.id;state.indexed=true;persist();console.log('Exploration corpus seeded; only dev/validation documents; no new answers collected');return;
 }
 assert(state.indexed,'Seed first');if(stage==='collect')assert(state.smokeCompleted,'Smoke must complete first');
 const snapshot=read(`${root}/snapshot.json`),rows=[];const order=executionOrder(plan).filter(x=>stage==='collect'||plan.smoke.caseIds.includes(x.caseId));
 for(const entry of order){guard();const q=selected.find(q=>q.id===entry.caseId);assert(['dev','validation'].includes(q.split));const id=`${q.id}-${entry.strategy}`;
  const spec={body:body(q,entry.strategy),snapshot,modelConfig:plan.modelConfig,baselineConfig:plan.baselineConfig,runtime:plan.runtime};
  const run=await collectAgent(api,{root:`${root}/runs`,id,spec,configFile:`${root}/${entry.strategy}-config.json`});
  const row={...deriveRow(run,q),strategy:entry.strategy};rows.push(row);immutable(`${root}/runs/${id}.derived.json`,row);
  if(run.status==='COMPLETED'){assert(run.result?.citationValid,'Completed run invalid citation');for(const c of run.result.citations||[])await api.request(`/api/citations/${typeof c==='string'?c:c.id}`);}
  assert(!/PROVIDER|UNAUTHORIZED|BALANCE|SOURCE_CHANGED|CONFIG_CHANGED/.test(run.errorCode||''),'Infrastructure failure raw retained; investigate, never blind replay');
  console.log(`${q.id}/${entry.strategy}: ${run.status}; human quality remains null`);
 }
 immutable(`${root}/${stage}-rows.json`,{registrationSha256:state.registrationSha256,rows,humanScores:null,qualityConclusion:null,defaultChange:false});
 if(stage==='smoke')state.smokeCompleted=true;if(stage==='collect')state.collectionCompleted=true;persist();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
