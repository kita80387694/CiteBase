import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {read,sha} from './phase2-client.mjs';
import {deriveRow,verifyRun} from './phase3-experiment.mjs';
import {summarize as baselineSummary} from './report-phase2-optimization.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
export function distribution(values,total=values.length){const a=values.filter(finite).sort((x,y)=>x-y);return{availableCount:a.length,unavailableCount:total-a.length,mean:avg(a),p50:a.length?a[Math.ceil(a.length*.5)-1]:null,p95:a.length?a[Math.ceil(a.length*.95)-1]:null};}
export function agentSummary(rows){
 const output={};
 for(const mode of ['vector','hybrid']){
  const r=rows.filter(x=>x.mode===mode),answerable=r.filter(x=>x.answerable),unanswerable=r.filter(x=>!x.answerable);
  const s={count:r.length,answerableCount:answerable.length,unanswerableCount:unanswerable.length,statusCounts:{},errorCounts:{},errorRate:avg(r.map(x=>x.error?1:0)),
   recallAt5:avg(answerable.map(x=>x.recallAt5)),mrrAt5:avg(answerable.map(x=>x.mrrAt5)),accumulatedRecall:avg(answerable.map(x=>x.accumulatedRecall)),accumulatedMrr:avg(answerable.map(x=>x.accumulatedMrr)),
   citationFormatValidCount:r.filter(x=>x.citationValid).length,correctRefusalCount:unanswerable.filter(x=>x.abstentionCorrect).length,referenceSubstringMatchCount:r.filter(x=>x.referenceAnswerMatch).length,
   humanCorrectness:null,citationSupport:null};
  for(const row of r){s.statusCounts[row.status]=(s.statusCounts[row.status]||0)+1;if(row.error)s.errorCounts[row.error]=(s.errorCounts[row.error]||0)+1;}
  for(const field of ['retrievalMs','totalMs'])s[field]=distribution(r.map(x=>x[field]),r.length);
  s.budget={};for(const field of ['plannerSteps','tools','searches','externalCalls','evidenceCount','evidenceChars'])s.budget[field]=distribution(r.map(x=>x.budgetUsed?.[field]),r.length);
  s.usage={};const records=r.flatMap(x=>x.usage||[]);
  for(const kind of new Set(['embedding','rerank','planner','generation',...records.map(x=>x.kind)])){
   const calls=records.filter(x=>x.kind===kind);s.usage[kind]={callRecords:calls.length};
   for(const field of ['promptTokens','completionTokens','totalTokens']){const values=calls.map(x=>x.actual?.[field]).filter(finite);s.usage[kind][field]={availableCount:values.length,unavailableCount:calls.length-values.length,observedSum:values.length?values.reduce((a,b)=>a+b,0):null};}
  }
  s.usageAccounting={runsMissingUsageArray:r.filter(x=>!Array.isArray(x.usage)).length,
   explicitlyReportedInFlightUnavailableRuns:r.filter(x=>x.inFlightUsageUnavailable===true).length,
   inFlightFlagUnavailableRuns:r.filter(x=>x.inFlightUsageUnavailable==null).length,
   positiveCallRecordGapObserved:r.reduce((sum,x)=>sum+(finite(x.budgetUsed?.externalCalls)?Math.max(0,x.budgetUsed.externalCalls-(x.usage?.length||0)):0),0),
   note:'Explicit in-flight flags are reported separately. Call-record gaps are an accounting signal, not an exact count of unknown or billable calls: a no-evidence generation may record usage without an external call. Observed sums are not complete billing totals; missing usage remains unavailable.'};
  output[mode]=s;
 }return output;
}
export function pairRows(agent,base,questions){
 const expected=questions.flatMap(q=>['vector','hybrid'].map(mode=>`${q.id}:${mode}`)).sort();
 for(const [name,rows] of [['agent',agent],['baseline',base]])assert.deepEqual(rows.map(r=>`${r.caseId}:${r.mode}`).sort(),expected,`${name} missing/duplicate cases; do not exclude failures`);
 const lookup=new Map(base.map(r=>[`${r.caseId}:${r.mode}`,r]));
 return agent.map(a=>{const b=lookup.get(`${a.caseId}:${a.mode}`);return{caseId:a.caseId,mode:a.mode,agentStatus:a.status,agentError:a.error,baseError:b.error??null,baseRecall:b.recallAtK,agentRecallAt5:a.recallAt5,agentAccumulatedRecall:a.accumulatedRecall,baseMrr:b.mrr,agentMrrAt5:a.mrrAt5,baseTotalMs:b.totalMs,agentTotalMs:a.totalMs,answerCorrect:null,citationSupport:null};});
}
export function verifyCollectedCase(state,run,question,mode,registration){
 assert.equal(state.spec.body.question,question.question,'Wrong question in collected intent');
 assert.equal(state.spec.body.mode,mode,'Directory mode differs from intent');
 assert.equal(state.spec.body.topK,5,'Expected topK5');
 assert.deepEqual(state.spec.body.budget,registration.budget,'Frozen budget differs');
 assert.deepEqual(state.spec.body.retrievalOptions,registration.options,'Frozen retrieval options differ');
 const frozen=Date.parse(registration.frozenAt);assert(Number.isFinite(frozen),'Invalid freeze time');
 for(const [label,value]of [['state',state.createdAt],['run',run.createdAt]]){
  const created=Date.parse(value);assert(Number.isFinite(created)&&created>=frozen,`${label} predates registration or has invalid timestamp`);
 }
 verifyRun(run,{...state.spec,serverConfig:registration.serverConfig});
}
export function verifyBaselineConfiguration(config,registration){
 for(const [key,value]of Object.entries(registration.baselineConfig))assert.deepEqual(config[key],value,`Baseline public configuration differs: ${key}`);
 assert.deepEqual(config.dataVersions,registration.snapshot);
}
export function buildReport(root){
 const inputs=[];const load=file=>{inputs.push({file,sha256:sha(readFileSync(file))});return read(file);};
 const registration=load(`${root}/registration.json`);assert(registration.frozenAt&&registration.serverConfig,'Actual server configuration freeze required');
 const dataset=load('samples/phase2/test.json');assert.equal(dataset.questions.length,52);
 const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
 assert.equal(sha(canonical(dataset)),registration.testHash,'Frozen dataset changed');
 const derived=[];
 for(const q of dataset.questions)for(const mode of ['vector','hybrid']){
  const id=`${q.id}-${mode}`,state=load(`${root}/test/${id}.state.json`),run=load(`${root}/test/${id}.raw.json`);
  assert.equal(state.rawSha256,inputs.at(-1).sha256);assert.deepEqual(state.spec.runtime,registration.runtime);
  assert(['COMPLETED','FAILED','CANCELLED','INTERRUPTED'].includes(run.status),'Partial live run cannot enter final report');
  assert.deepEqual(state.spec.serverConfig,registration.serverConfig);assert.equal(state.spec.datasetHash,registration.testHash);
  verifyCollectedCase(state,run,q,mode,registration);derived.push(deriveRow(run,q));
 }
 const suite=load('docs/results/phase2/optimization/suite.json'),base=[];
 for(const [id,variant]of Object.entries(suite.variants))if(id.startsWith('test-frozen-')){const run=load(variant.rawFile);verifyBaselineConfiguration(run.config,registration);base.push(...run.results);}
 const paired=pairRows(derived,base,dataset.questions);
 return{generatedAt:new Date().toISOString(),registration,inputs,agent:agentSummary(derived),baseline:baselineSummary(base),paired,rows:derived,
  limitations:['Shared previously evaluated phase2 benchmark; no new test-tuned selection.','First five Agent evidence is acquisition order; accumulated recall permits up to published maxEvidence and is not equivalent-cost Recall@5.','Actual timings reflect separate run times, not controlled causal performance gains.','Citation format and reference substring are auxiliary metrics, never semantic correctness; human review remains null.','Agent retrievalMs covers cumulative search-tool time; base retrievalMs covers its single retrieval.','Failures remain in quality denominators; missing latency and usage have explicit coverage.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const root=process.argv[2]||'docs/results/phase3';assert(existsSync(`${root}/registration.json`));const report=buildReport(root);mkdirSync(`${root}/reports`,{recursive:true});const path=`${root}/reports/comparison-${Date.now()}.json`;writeFileSync(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(path);}
