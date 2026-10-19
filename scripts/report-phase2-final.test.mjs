import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {buildFinal,finalMarkdown} from './report-phase2-final.mjs';
const save=(p,v)=>writeFileSync(p,JSON.stringify(v));
function fixture(){
 mkdirSync('.tools/final-report-tests',{recursive:true});const root=resolve(mkdtempSync('.tools/final-report-tests/run-'));
 const baselineDev=join(root,'baseline'),baselineTest=join(root,'holdout');mkdirSync(baselineDev);mkdirSync(baselineTest);
 const options={candidateK:20,keywordWeight:1,rerank:false,citationStyle:'uuid'};
 const dataset=split=>({questions:[{id:split+'-a',question:'Question '+split,answerable:true}]});
 const rows=split=>['vector','hybrid'].map((mode,i)=>({caseId:split+'-a',question:'Question '+split,answerable:true,split,mode,recallAtK:i?0:1,mrr:i?0:1,error:i?'actual failure':null,citationValid:!i,totalMs:i?30:10,retrievalMs:i?8:2,promptTokens:0,usage:{rerank:{completionTokens:0}}}));
 const raw=split=>({id:'run-'+split,status:'COMPLETED_WITH_ERRORS',config:{modelMode:'real',chatModel:'chat',embeddingModel:'embed',temperature:0,topK:5,retrievalOptions:options,dataVersions:[{name:'fixture.md',content_hash:'hash'}]},results:rows(split)});
 const suite={runtime:{commit:'frozen-code',sourceSha256:'frozen-hash'},variants:{'c-rerank':{profileId:'structure',options},'test-frozen-0':{profileId:'structure',options}},confirmation:{candidate:'c-rerank',sourceIds:['c-rerank']}};
 save(join(root,'suite.json'),suite);save(join(root,'dev-confirmation.json'),suite.confirmation);
 const dev=raw('dev');dev.kind='composite-recovered-evaluation';dev.rawSources=[{file:'original',sha256:'preserved'}];dev.recovery={completed:true,originalRows:1,recoveredRows:1,operationalInterruption:{potentialUnpersistedCase:'dev-a:hybrid',usage:null,qualityError:false}};
 save(join(root,'c-rerank.raw.json'),dev);save(join(baselineDev,'baseline-dev-0.json'),raw('dev'));
 save(join(baselineDev,'state.json'),{runtime:{commit:'baseline-code',sourceSha256:'baseline-source-hash'}});
 const devDataset=join(root,'dev.json'),testDataset=join(root,'test.json');save(devDataset,dataset('dev'));
 // Poison proves neither test dataset nor raw baseline is opened before freeze.
 writeFileSync(testDataset,'MUST NOT OPEN BEFORE FREEZE');writeFileSync(join(baselineTest,'baseline-holdout-test-0.json'),'MUST NOT OPEN BEFORE FREEZE');
 return {root,baselineDev,baselineTest,devDataset,testDataset,suite,dev,raw,dataset,freeze(){const configuration={frozenAt:'now',candidate:'c-rerank',profileId:'structure',options};save(join(root,'final-configuration.json'),configuration);save(join(root,'test-summary.json'),{configuration,sourceIds:['test-frozen-0']});save(testDataset,dataset('test'));save(join(root,'test-frozen-0.raw.json'),raw('test'));save(join(baselineTest,'baseline-holdout-test-0.json'),raw('test'));save(join(baselineTest,'state.json'),{runtime:{commit:'baseline-test-code',sourceSha256:'baseline-test-hash'}});}};
}
test('dev-only never reads poisoned holdout; preserves failures, zero usage and recovery provenance',()=>{
 const f=fixture(),r=buildFinal(f);assert.equal(r.scope,'dev_only');assert.equal(r.sets.dev.count,2);assert(!r.inputs.some(i=>i.file.includes('holdout')||i.file===f.testDataset));
 assert.equal(r.sets.dev.optimized.hybrid.errorCount,1);assert.equal(r.sets.dev.optimized.hybrid.totalMs.mean,30);
 assert.equal(r.sets.dev.optimized.vector.usage.chatPrompt.observedSum,0);assert.equal(r.sets.dev.optimized.vector.usage.embeddingPrompt.observedSum,null);
 assert.deepEqual(r.sets.dev.sources.optimized[0].recovery,f.dev.recovery);assert.equal(r.humanCorrectness,null);
 assert.match(finalMarkdown(r),/在途调用用量不可用/);assert.equal(r.sets.dev.paired.length,2);
});
test('valid freeze admits complete fixture test and rejects duplicate or missing failed rows',()=>{
 const f=fixture();f.freeze();let r=buildFinal(f);assert.equal(r.sets.test.count,2);assert.equal(r.scope,'dev_and_frozen_test');
 const raw=f.raw('test');raw.results.pop();save(join(f.root,'test-frozen-0.raw.json'),raw);assert.throws(()=>buildFinal(f),/Incomplete full set/);
 raw.results.push(raw.results[0]);save(join(f.root,'test-frozen-0.raw.json'),raw);assert.throws(()=>buildFinal(f),/Duplicate case/);
});
test('source config drift, partial status and mismatched freeze fail closed',()=>{
 const f=fixture();f.dev.config.retrievalOptions={rerank:true};save(join(f.root,'c-rerank.raw.json'),f.dev);assert.throws(()=>buildFinal(f),/Raw options drift/);
 f.dev.config.retrievalOptions=f.suite.variants['c-rerank'].options;f.dev.status='RUNNING';save(join(f.root,'c-rerank.raw.json'),f.dev);assert.throws(()=>buildFinal(f),/Incomplete raw batch/);
 f.dev.status='COMPLETED_WITH_ERRORS';save(join(f.root,'c-rerank.raw.json'),f.dev);f.freeze();save(join(f.root,'test-summary.json'),{configuration:{wrong:true},sourceIds:['test-frozen-0']});assert.throws(()=>buildFinal(f),/differs from freeze/);
});
test('paired differences retain both failed answers and finite-only latency coverage',()=>{
 const f=fixture();f.dev.results[0].recallAtK=.5;f.dev.results[0].totalMs=null;f.dev.results[1].totalMs=40;save(join(f.root,'c-rerank.raw.json'),f.dev);
 const r=buildFinal(f),p=r.sets.dev.paired;assert.equal(p[0].delta.recallAtK,-.5);assert.equal(p[1].baseline.error,'actual failure');assert.equal(p[1].optimized.error,'actual failure');assert.equal(r.sets.dev.optimized.vector.totalMs.unavailableCount,1);assert.equal(r.sets.dev.optimized.hybrid.totalMs.p95,40);
});
test('baseline runtime is hashed and source corpus ignores KB IDs/profile but rejects model/corpus drift',()=>{
 const f=fixture(),path=join(f.baselineDev,'baseline-dev-0.json'),baseline=f.raw('dev');
 baseline.config.dataVersions[0]={...baseline.config.dataVersions[0],id:'different-kb-doc',version_id:'different-version',chunk_size:600};save(path,baseline);
 const report=buildFinal(f);assert.equal(report.sets.dev.sources.baseline[0].runtime.commit,'baseline-code');assert(report.inputs.some(i=>i.file===join(f.baselineDev,'state.json')&&i.sha256));
 for(const field of ['chatModel','embeddingModel','temperature','topK']){const original=baseline.config[field];baseline.config[field]='changed';save(path,baseline);assert.throws(()=>buildFinal(f),/drift/);baseline.config[field]=original;}
 baseline.config.dataVersions[0].content_hash='changed';save(path,baseline);assert.throws(()=>buildFinal(f),/source corpus drift/);
 baseline.config.dataVersions[0].content_hash='hash';delete baseline.config.temperature;save(path,baseline);assert.throws(()=>buildFinal(f),/metadata missing/);
 save(path,f.raw('dev'));save(join(f.baselineDev,'state.json'),{runtime:{commit:'missing-source-hash'}});assert.throws(()=>buildFinal(f),/runtime metadata missing/);
});
