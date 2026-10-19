import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {summarize,buildReport,markdown} from './report-phase2-optimization.mjs';
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
test('A ablations isolate strategy against legacy and size or overlap against structure900',()=>{
 mkdirSync('.tools/report-tests',{recursive:true});const root=resolve(mkdtempSync('.tools/report-tests/controls-'));
 const ids=['a-legacy900','a-structure900','a-structure600','a-structure1200','a-structure900-o0','a-structure900-o100'];
 const raw={results:[{caseId:'q',split:'dev',mode:'vector',answerable:true,recallAtK:1,mrr:1,citationValid:true}]};
 const variants={};for(const id of ids){const file=join(root,id+'.raw.json');writeFileSync(file,JSON.stringify(raw));variants[id]={rawFile:file,summary:summarize(raw.results)};}
 writeFileSync(join(root,'suite.json'),JSON.stringify({variants}));const r=buildReport(root);
 assert.equal(Object.keys(r.variants).length,6);assert.equal(r.comparisons.length,5);
 assert.equal(r.comparisons.find(x=>x.variant==='a-structure900').control,'a-legacy900');
 for(const id of ids.slice(2))assert.equal(r.comparisons.find(x=>x.variant===id).control,'a-structure900');
 assert.equal(r.comparisons.filter(x=>x.control==='a-legacy900').length,1);
});

test('composite recovery provenance and unknown cost remain explicit without changing quality metrics',()=>{
 mkdirSync('.tools/report-tests',{recursive:true});const root=resolve(mkdtempSync('.tools/report-tests/recovery-'));
 const rows=Array.from({length:32},(_,i)=>({caseId:'q'+Math.floor(i/2),mode:i%2?'hybrid':'vector',split:'dev',answerable:true,recallAtK:1,mrr:1,citationValid:true,error:i===31?'actual provider error':null}));
 const raw={kind:'composite-recovered-evaluation',status:'COMPLETED_WITH_ERRORS',results:rows,rawSources:[{kind:'interrupted-evaluation',file:'original.raw.json',sha256:'preserved'},{kind:'question-response',file:'answer.raw.json',sha256:'also-preserved'}],recovery:{completed:true,originalRows:25,recoveredRows:7,originalRunId:'original-server-run',operationalInterruption:{potentialUnpersistedCase:'q12:hybrid',executionStatus:'unknown',usage:null,qualityError:false}}};
 const file=join(root,'c-rerank.raw.json');writeFileSync(file,JSON.stringify(raw));
 writeFileSync(join(root,'suite.json'),JSON.stringify({variants:{'c-rerank':{rawFile:file,summary:summarize(rows)},'test-frozen-0':{rawFile:join(root,'must-not-read.raw.json')}}}));
 const report=buildReport(root),variant=report.variants['c-rerank'];
 assert.equal(variant.kind,raw.kind);assert.deepEqual(variant.rawSources,raw.rawSources);assert.deepEqual(variant.recovery,raw.recovery);
 assert.equal(variant.summary.vector.errorCount,0);assert.equal(variant.summary.hybrid.errorCount,1);assert.equal(variant.recovery.operationalInterruption.usage,null);
 assert.equal(report.skipped[0].reason,'holdout_locked_until_final_configuration_exists');
 const md=markdown(report);assert.match(md,/原 25 行 \+ 补 7 行/);assert.match(md,/不是单次无中断实验/);assert.match(md,/实际执行状态及用量不可用/);assert.match(md,/不含停机\/恢复等待或未知调用成本/);
 assert(md.indexOf('组合恢复结果')<md.indexOf('| Variant |'));assert.match(md,/c-rerank（组合恢复）/);
 raw.recovery.completed=false;writeFileSync(file,JSON.stringify(raw));assert.throws(()=>buildReport(root),/provenance incomplete/);
 raw.recovery.completed=true;raw.recovery.recoveredRows=6;writeFileSync(file,JSON.stringify(raw));assert.throws(()=>buildReport(root),/row counts differ/);
});
