import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {dirname} from 'node:path';
import {client,read,save,immutable,sha,pause,evaluation} from './phase2-client.mjs';
import {selectCases,verifyDeployment} from './quality-agent-explore.mjs';
import {verifySnapshot} from './phase3-experiment.mjs';

export function costCases(dataset,baseline){
  const eight=selectCases(dataset,baseline);
  return [eight[0],eight[1],eight[4],eight[5]];
}
export function costArms(cases){
  const base={candidateK:20,keywordWeight:1,rerank:true,citationStyle:'uuid'};
  const ordinary=cases.map(q=>({baseCaseId:q.id,phase:'single',question:q}));
  // Same sequence in both cache arms: two cold/hot pairs, then a 50% repeat/new mix.
  const sequence=[[0,'cold'],[0,'hot'],[1,'cold'],[1,'hot'],[0,'mixed-repeat'],[2,'mixed-new'],[1,'mixed-repeat'],[3,'mixed-new']]
    .map(([i,phase],n)=>({baseCaseId:cases[i].id,phase,question:{...cases[i],id:`${cases[i].id}-repeat-${n}`}}));
  return [
    {id:'fixed20',options:base,items:ordinary},
    {id:'candidate5',options:{...base,candidateK:5},items:ordinary},
    {id:'conditional5',options:{...base,candidateK:5,rerankPolicy:'candidate-pressure-v1'},items:ordinary},
    {id:'deduplicate20',options:{...base,deduplicate:true},items:ordinary},
    {id:'repeated-no-cache',options:base,items:sequence},
    {id:'repeated-cache',options:{...base,cache:true},items:sequence},
  ];
}
async function main(){
  const [stage,root,baselineFile,runtimeFile]=process.argv.slice(2);
  assert(['seed','smoke','collect'].includes(stage)&&root&&baselineFile&&runtimeFile,
    'Usage: quality-cost-experiment.mjs seed|smoke|collect root baseline-registration runtime');
  const bytes=readFileSync('samples/phase3-quality/evaluation.json'),dataset=JSON.parse(bytes),baseline=read(baselineFile),runtime=read(runtimeFile);
  const baselineConfig=read(`${dirname(baselineFile)}/rag-config.json`);
  assert(runtime.containerId&&runtime.startedAt&&runtime.executionSettings,'Capture process identity and finite retry settings');
  assert.equal(sha(bytes),baseline.datasetSha256);
  const cases=costCases(dataset,baseline),arms=costArms(cases);
  assert(cases.every(q=>['dev','validation'].includes(q.split)));
  const files=['scripts/quality-cost-experiment.mjs','scripts/quality-agent-explore.mjs','scripts/phase2-client.mjs','scripts/phase2-comparability.mjs'];
  const plan={version:'quality-cost-exploration-v1',purpose:'Exploratory cost ablation, no human quality acceptance',
    datasetSha256:sha(bytes),runtime,modelConfig:Object.fromEntries(['chatModel','embeddingModel','provider','reranker','temperature','minimumSimilarity','abstentionPolicy','keywordAnalyzer','fusion','rrfConstant'].filter(k=>baselineConfig[k]!==undefined).map(k=>[k,baselineConfig[k]])),scriptHashes:Object.fromEntries(files.map(f=>[f,sha(readFileSync(f))])),
    selection:'First answerable and unanswerable from each split of deterministic Agent exploration cohort; no output-based selection',
    caseIds:cases.map(q=>q.id),arms,chunkProfile:baseline.chunkProfile,topK:5,
    limits:{concurrency:1,evaluationRows:64,noRetryTheoreticalRetrievalCalls:128,noRetryTheoreticalGenerationCalls:64,indexingAndFiniteRetries:'separately audited; theoretical totals are not enforced hard provider-call budgets',executionSettings:runtime.executionSettings,maxRowsInCurrentBatch:16},
    comparisons:['fixed20 vs candidate5: candidate count','candidate5 vs conditional5: rerank policy','fixed20 vs deduplicate20: exact provider-input grouping','repeated-no-cache vs repeated-cache: identical cold/hot/mixed order'],
    cacheMeasurement:'Labels describe requested traffic; report actual hit/miss/expiry, never assume hot label implies hit. Same evaluation snapshot per arm; vector/hybrid distinct cache keys.',
    qualityGate:{humanScores:null,nonInferiorityMarginPercentagePoints:5,rule:'No new severe unsupported/citation errors and paired human correctness difference lower confidence bound above -5 percentage points; unreviewed/small samples cannot pass.',status:'UNASSESSED'},
    costTarget:'At least 20% fewer retrieval provider calls on repeated traffic; no end-to-end speedup claim unless measured. No default change without human quality gate.',
    stopConditions:['provider authentication/balance/source failure: stop after current evaluation terminates; its remaining at most16 rows can still execute','runtime/model/data drift','uncertain request: reconcile persisted idempotency journal'],defaultChange:false};
  mkdirSync(root,{recursive:true});immutable(`${root}/registration.json`,plan);
  const guard=()=>{
    const identity=JSON.parse(execFileSync('docker',['inspect',runtime.containerName,'--format','{{json .}}'],{encoding:'utf8'}));
    assert.equal(identity.Id,runtime.containerId,'Container replacement invalidates registered cache traffic');
    assert.equal(identity.State.StartedAt,runtime.startedAt,'Restart invalidates continuous cache experiment; preserve partial data and register a new run');
    verifyDeployment(plan,identity.Image,identity.NetworkSettings.Ports,process.env.CITEBASE_URL);
  };
  guard();const file=`${root}/state.json`,state=existsSync(file)?read(file):{registrationSha256:sha(JSON.stringify(plan))};
  assert.equal(state.registrationSha256,sha(JSON.stringify(plan)));const persist=()=>save(file,state);persist();
  const api=await client(),prefix=`CostExplore-${state.registrationSha256.slice(0,12)}`;
  if(!state.kbId){assert.equal(stage,'seed');const found=(await api.request('/api/knowledge-bases')).filter(k=>k.name===prefix);assert(found.length<=1);state.kbId=(found[0]||await api.request('/api/knowledge-bases',{name:prefix})).id;persist();}
  if(stage==='seed'){
    const docs=read('samples/phase3-quality/manifest.json').documents.filter(d=>['dev','validation'].includes(d.split));
    assert((await api.request(`/api/knowledge-bases/${state.kbId}/documents`)).every(d=>docs.some(x=>x.documentName===d.name)));
    for(const d of docs){guard();const path=`samples/phase3-quality/documents/${d.documentName}`;assert.equal(sha(readFileSync(path)),d.sourceHash);await api.upload(state.kbId,path,plan.chunkProfile);}
    for(let i=0;i<600;i++){
      const active=await api.request(`/api/knowledge-bases/${state.kbId}/documents`);assert(!active.some(d=>d.status==='FAILED'),'Index failure: inspect existing task');
      if(active.length===docs.length&&active.every(d=>d.status==='SUCCESS')){
        const snapshot=active.map(d=>({id:d.id,version_id:d.activeVersionId})).sort((a,b)=>a.id.localeCompare(b.id));
        immutable(`${root}/snapshot.json`,snapshot);state.documents=active;state.indexed=true;persist();break;
      }
      await pause(1000);
    }
    assert(state.indexed,'Index pending: resume same journal');
    const configOnly=await api.request('/api/agent-runs',{kbId:state.kbId,question:cases[0].question,retrievalOptions:{...arms[0].options,cache:true},idempotencyKey:`${prefix}-configuration-only`});
    assert.equal(configOnly.config.modelMode,'real');
    for(const[k,v]of Object.entries(plan.modelConfig))assert.deepEqual(configOnly.config[k],v,`Model/provider drift: ${k}`);
    immutable(`${root}/configuration-only-run.json`,configOnly);
    assert(configOnly.config.retrievalCost,'Cache/algorithm configuration must be public and frozen');
    immutable(`${root}/cost-config.json`,configOnly.config.retrievalCost);
    state.configurationValidated=true;persist();
    return;
  }
  assert(state.indexed&&state.configurationValidated,'Seed and model configuration validation required');if(stage==='collect')assert(state.smokeCompleted);
  const chosen=stage==='smoke'?arms.slice(0,1):arms;
  for(const arm of chosen){
    guard();const active=await api.request(`/api/knowledge-bases/${state.kbId}/documents`);
    verifySnapshot(read(`${root}/snapshot.json`),active);
    const data={version:`${dataset.version}-${arm.id}`,questions:arm.items.map(i=>i.question)};
    const run=await evaluation(api,{root:`${root}/runs`,id:`${prefix}-${arm.id}`,kbId:state.kbId,dataset:data,options:arm.options,runtime,topK:5});
    assert.equal(run.config.modelMode,'real');
    for(const[k,v]of Object.entries(plan.modelConfig))assert.deepEqual(run.config[k],v,`Model/provider drift: ${k}`);
    const identity=Object.fromEntries(['chatModel','embeddingModel','provider','reranker','temperature','dataVersions'].map(k=>[k,run.config[k]]));
    immutable(`${root}/model-data-config.json`,identity);
    const task=await api.request(`/api/tasks/${run.id}`);assert(['SUCCEEDED','FAILED','CANCELLED'].includes(task.status));immutable(`${root}/runs/${arm.id}.task.json`,task);
    for(const row of run.results){
      assert(!/PROVIDER|UNAUTHORIZED|BALANCE|SOURCE_CHANGED|CONFIG_CHANGED/.test(row.error||''),'Infrastructure failure retained; stop without repeating');
      assert(row.diagnostics?.cost,'Actual cost diagnostics required, never inferred from arm labels');
      for(const c of row.citations||[])await api.request(`/api/evaluations/${run.id}/citations/${typeof c==='string'?c:c.id}`);
    }
  }
  if(stage==='smoke')state.smokeCompleted=true;else state.collectionCompleted=true;persist();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
