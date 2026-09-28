import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {summarize,buildReport} from './report-phase2-optimization.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
test('all 208 dev baseline rows match recorded retrieval/error summary, including failures',()=>{
 const dir='docs/results/phase2/baseline';
 const rows=readdirSync(dir).filter(n=>/^baseline-dev-.*\.json$/.test(n)).flatMap(n=>read(join(dir,n)).results);
 assert.equal(rows.length,208);const computed=summarize(rows),saved=read(join(dir,'summary-dev.json')).summary;
 for(const mode of ['vector','hybrid'])for(const key of ['count','recallAtK','mrr','errorCount','errorRate','citationValidCount'])assert.equal(computed[mode][key],saved[mode][key],mode+':'+key);
 for(const mode of ['vector','hybrid']){assert.equal(computed[mode].answerable,saved[mode].answerableCount);assert.equal(computed[mode].unanswerable,saved[mode].unanswerableCount);for(const field of ['retrievalMs','totalMs'])for(const key of ['count','mean','p50','p95'])assert.equal(computed[mode][field][key],saved[mode][field][key]);for(const [field,key] of [['chatPrompt','promptTokens'],['chatCompletion','completionTokens']])for(const k of ['availableCount','unavailableCount','observedSum'])assert.equal(computed[mode].usage[field][k],saved[mode][key][k]);}assert.equal(computed.vector.humanCorrectness,null);
});
test('unfrozen holdout raw is not opened; failed dev rows and zero usage retained',()=>{
 mkdirSync('.tools/report-tests',{recursive:true});const root=resolve(mkdtempSync('.tools/report-tests/run-'));
 const dev={results:[{caseId:'x',split:'dev',mode:'vector',answerable:true,error:'failure',usage:{rerank:{completionTokens:0}},citationValid:false}]};
 writeFileSync(join(root,'dev.raw.json'),JSON.stringify(dev));writeFileSync(join(root,'secret.raw.json'),'INVALID JSON: must never be read before freeze');
 const suite={variants:{'a-control':{rawFile:join(root,'dev.raw.json'),summary:summarize(dev.results)},'test-frozen-0':{rawFile:join(root,'secret.raw.json')}}};
 writeFileSync(join(root,'suite.json'),JSON.stringify(suite));const r=buildReport(root);
 assert.equal(r.scope,'dev_only');assert.equal(r.skipped.length,1);assert(!r.inputs.some(x=>x.file.endsWith('secret.raw.json')));assert.equal(r.variants['a-control'].summary.vector.recallAtK,0);
 assert.equal(r.variants['a-control'].summary.vector.usage.rerankCompletion.observedSum,0);assert.equal(r.variants['a-control'].summary.vector.usage.rerankTotal.observedSum,null);
 suite.variants['a-control'].summary.vector.errorCount=0;writeFileSync(join(root,'suite.json'),JSON.stringify(suite));assert.throws(()=>buildReport(root),/saved summary differs/);
});
