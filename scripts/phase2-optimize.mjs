import {readFileSync,readdirSync,existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {client,read,save,sha,pause,evaluation} from './phase2-client.mjs';
import {assertCompactComparable} from './phase2-comparability.mjs';
const stage=process.argv[2];
assert(['seed','a','b1','b2','c','d','dev','freeze','test'].includes(stage),'Usage: phase2-optimize.mjs seed|a|b1|b2|c|d|dev|freeze|test');
const root='docs/results/phase2/optimization';mkdirSync(root,{recursive:true});
const plan=read('docs/results/phase2/registration/plan.json'),tuning=read('docs/results/phase2/registration/tuning.json');
const runtime=read('.tools/phase2-stage2-runtime.json'),statePath=root+'/suite.json';
const suite=existsSync(statePath)?read(statePath):{runtime,planSha256:sha(readFileSync('docs/results/phase2/registration/plan.json')),tuningSha256:sha(JSON.stringify(tuning)),profiles:{},variants:{},selections:{}};
assert.deepEqual(suite.runtime,runtime,'Deployment changed: preserve this experiment and register a new suite');
assert.equal(suite.planSha256,sha(readFileSync('docs/results/phase2/registration/plan.json')),'Preregistration changed');
assert.equal(suite.tuningSha256,sha(JSON.stringify(tuning)),'Tuning cases changed');
const persist=()=>save(statePath,suite);persist();
const api=await client();
const defaults={candidateK:20,keywordWeight:1,rerank:false,citationStyle:'uuid'};
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]:null;
function summarize(rows){
  const result={};for(const mode of ['vector','hybrid']){const r=rows.filter(x=>x.mode===mode),a=r.filter(x=>x.answerable),u=r.filter(x=>!x.answerable);const summary={count:r.length,answerable:a.length,recallAtK:mean(a.map(x=>x.recallAtK??0)),mrr:mean(a.map(x=>x.mrr??0)),errorCount:r.filter(x=>x.error).length,errorRate:mean(r.map(x=>x.error?1:0)),citationValidCount:r.filter(x=>x.citationValid).length,correctAbstentionCount:u.filter(x=>x.abstained&&x.citationValid&&!x.error).length,unanswerable:u.length,humanCorrectness:null};
    for(const field of ['retrievalMs','totalMs']){const values=r.map(x=>x[field]).filter(x=>typeof x==='number');summary[field]={count:values.length,mean:mean(values),p50:percentile(values,.5),p95:percentile(values,.95)};}
    summary.usage={};for(const [name,get] of Object.entries({chatPrompt:x=>x.promptTokens,chatCompletion:x=>x.completionTokens,embeddingPrompt:x=>x.usage?.embedding?.promptTokens,embeddingTotal:x=>x.usage?.embedding?.totalTokens,rerankPrompt:x=>x.usage?.rerank?.promptTokens,rerankCompletion:x=>x.usage?.rerank?.completionTokens,rerankTotal:x=>x.usage?.rerank?.totalTokens})){const values=r.map(get).filter(x=>typeof x==='number');summary.usage[name]={availableCount:values.length,unavailableCount:r.length-values.length,observedSum:values.length?values.reduce((a,b)=>a+b,0):null};}
    result[mode]=summary;
  }return result;
}
function reserveBudget(id,questionCount){
  if(existsSync(`${root}/${id}.state.json`))return;
  const reserved=readdirSync(root).filter(x=>x.endsWith('.state.json')).map(x=>read(`${root}/${x}`).expectedRows??0).reduce((a,b)=>a+b,0);
  assert(reserved+questionCount*2<=plan.limits.maxNewGenerationRows,'Preregistered generation budget would be exceeded');
}
async function run(id,profileId,options,dataset=tuning){
  assert(suite.profiles[profileId]?.ready,`Profile ${profileId} not indexed`);reserveBudget(id,dataset.questions.length);
  const output=await evaluation(api,{root,id,kbId:suite.profiles[profileId].kbId,dataset,options,runtime});
  const expected=dataset.questions.flatMap(q=>['vector','hybrid'].map(mode=>q.id+':'+mode)).sort();
  assert.deepEqual(output.results.map(r=>r.caseId+':'+r.mode).sort(),expected,'Do not omit or duplicate failed cases');
  const variant={id,profileId,options,rawFile:`${root}/${id}.raw.json`,summary:summarize(output.results)};
  suite.variants[id]=variant;persist();return variant;
}
async function parallel(jobs){let next=0;await Promise.all(Array.from({length:Math.min(2,jobs.length)},async()=>{while(next<jobs.length){const job=jobs[next++];await job();}}));}
function choose(ids,control){let best=suite.variants[control];assert(best);const score=v=>({recall:mean(Object.values(v.summary).map(x=>x.recallAtK)),mrr:mean(Object.values(v.summary).map(x=>x.mrr))});for(const id of ids){const v=suite.variants[id];assert(v,`Missing ${id}`);const a=score(best),b=score(v);if((b.recall>a.recall+.0000001||(Math.abs(b.recall-a.recall)<.0000001&&b.mrr>a.mrr))&&b.recall>=a.recall-.005)best=v;}const a=score(suite.variants[control]),b=score(best);return b.recall-a.recall>=.02||b.recall>=a.recall-.005&&b.mrr-a.mrr>=.03?best.id:control;}
if(stage==='seed'){
  const bases=await api.request('/api/knowledge-bases');
  for(const profile of plan.profiles){let p=suite.profiles[profile.id];if(!p){const name=`Phase2 opt ${profile.id}`,kb=bases.find(k=>k.name===name)||await api.request('/api/knowledge-bases',{name});p=suite.profiles[profile.id]={kbId:kb.id,profile,ready:false};persist();}
    if(p.ready)continue;
    for(const name of readdirSync('samples/phase2/documents').sort())await api.upload(p.kbId,`samples/phase2/documents/${name}`,profile);
    let complete=false;for(let i=0;i<3600;i++){const docs=await api.request(`/api/knowledge-bases/${p.kbId}/documents`);assert(!docs.some(d=>d.status==='FAILED'),`Index failure ${profile.id}, old indexes preserved`);if(docs.length===12&&docs.every(d=>d.status==='SUCCESS')){p.documents=docs;p.ready=true;persist();complete=true;break;}await pause(1000);}assert(complete,'Index deadline');console.log(`Indexed profile ${profile.id}`);
  }
}else if(stage==='a'){
  await parallel(plan.profiles.map(p=>()=>run('a-'+p.id,p.id,defaults)));suite.selections.a=choose(plan.profiles.map(p=>'a-'+p.id),'a-legacy900');persist();
}else if(stage==='b1'){
  const control=suite.variants[suite.selections.a];assert(control,'Complete A first');await parallel([10,40].map(k=>()=>run('b1-k'+k,control.profileId,{...control.options,candidateK:k})));suite.selections.b1=choose(['b1-k10','b1-k40',control.id],control.id);persist();
}else if(stage==='b2'){
  const control=suite.variants[suite.selections.b1];assert(control,'Complete B1 first');await parallel([.25,.5].map(w=>()=>run('b2-w'+String(w).replace('.','_'),control.profileId,{...control.options,keywordWeight:w})));suite.selections.b2=choose(['b2-w0_25','b2-w0_5',control.id],control.id);persist();
}else if(stage==='c'){
  const control=suite.variants[suite.selections.b2];assert(control);await run('c-rerank',control.profileId,{...control.options,rerank:true});suite.selections.c=choose(['c-rerank',control.id],control.id);persist();
}else if(stage==='d'){
  const control=suite.variants[suite.selections.c];assert(control);const variant=await run('d-compact',control.profileId,{...control.options,citationStyle:'compact'});
  // Reject attribution/selection when any paired retrieval context changed, even if errors improved.
  try {
    const comparison=assertCompactComparable(read(control.rawFile),read(variant.rawFile));
    suite.compactComparison={control:control.id,variant:variant.id,...comparison};
  } catch(error) {
    suite.compactComparison={control:control.id,variant:variant.id,comparable:false,error:String(error),controlRawFile:control.rawFile,variantRawFile:variant.rawFile,action:'No alias attribution or selection; all rows and raw results retained for diagnosis.'};persist();throw error;
  }
  const errors=v=>Object.values(v.summary).reduce((a,s)=>a+s.errorCount,0);suite.selections.d=errors(variant)<errors(control)?variant.id:control.id;persist();
}else if(stage==='dev'){
  const chosen=suite.variants[suite.selections.d];assert(chosen);const dataset=read('samples/phase2/dev.json'),reusedIds=new Set(tuning.questions.map(q=>q.id)),remaining=dataset.questions.filter(q=>!reusedIds.has(q.id));
  await parallel(Array.from({length:Math.ceil(remaining.length/8)},(_,i)=>()=>run('dev-confirm-'+i,chosen.profileId,chosen.options,{...dataset,questions:remaining.slice(i*8,i*8+8)})));
  const sourceIds=[chosen.id,...Array.from({length:Math.ceil(remaining.length/8)},(_,i)=>'dev-confirm-'+i)],rows=sourceIds.flatMap(id=>read(suite.variants[id].rawFile).results);
  assert.equal(rows.length,208);assert.equal(new Set(rows.map(r=>r.caseId+':'+r.mode)).size,208);
  suite.confirmation={candidate:chosen.id,sourceIds,summary:summarize(rows),note:'Selected 16-case run reused, remaining 88 cases run once; all failures retained.'};persist();save(root+'/dev-confirmation.json',suite.confirmation);
}else if(stage==='freeze'){
  assert(suite.confirmation,'Complete full dev confirmation first');assert(!suite.finalConfiguration,'Already frozen: do not revise after test');const proposed=suite.variants[suite.confirmation.candidate],baseline=read('docs/results/phase2/baseline/summary-dev.json').summary;
  const score=x=>({recall:mean(Object.values(x).map(v=>v.recallAtK)),mrr:mean(Object.values(x).map(v=>v.mrr)),errors:Object.values(x).reduce((a,v)=>a+v.errorCount,0)}),a=score(baseline),b=score(suite.confirmation.summary);
  const adopt=b.recall>=a.recall-.005&&(b.recall-a.recall>=.02||b.mrr-a.mrr>=.03||b.errors<a.errors);
  suite.finalConfiguration={frozenAt:new Date().toISOString(),candidate:proposed.id,profileId:proposed.profileId,options:proposed.options,eligibleForRecommendation:adopt,adoptAsDefault:false,defaultDecision:"Keep universal legacy defaults; experimental pipeline remains explicit opt-in because this is a small self-authored corpus and reranker requires optional credentials.",baselineScore:a,devScore:b,rule:'Full dev evidence only; test not yet read. Experimental candidate evaluated even if defaults retained.'};persist();save(root+'/final-configuration.json',suite.finalConfiguration);
}else if(stage==='test'){
  assert(suite.finalConfiguration,'Freeze before test');const c=suite.finalConfiguration,dataset=read('samples/phase2/test.json');await parallel(Array.from({length:Math.ceil(dataset.questions.length/8)},(_,i)=>()=>run('test-frozen-'+i,c.profileId,c.options,{...dataset,questions:dataset.questions.slice(i*8,i*8+8)})));
  const sourceIds=Array.from({length:Math.ceil(dataset.questions.length/8)},(_,i)=>'test-frozen-'+i),rows=sourceIds.flatMap(id=>read(suite.variants[id].rawFile).results);assert.equal(rows.length,104);assert.equal(new Set(rows.map(r=>r.caseId+':'+r.mode)).size,104);save(root+'/test-summary.json',{configuration:suite.finalConfiguration,sourceIds,summary:summarize(rows)});
}
console.log(`Stage ${stage} complete; selections ${JSON.stringify(suite.selections)}`);
