import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {summarize} from './report-phase2-optimization.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const key=r=>`${r.caseId}:${r.mode}`;
export function validateRows(rows,dataset,split){
 assert(Array.isArray(rows));assert.equal(new Set(rows.map(key)).size,rows.length,'Duplicate case/mode');
 const expected=dataset.questions.flatMap(q=>['vector','hybrid'].map(mode=>q.id+':'+mode)).sort();
 assert.deepEqual(rows.map(key).sort(),expected,'Incomplete full set: missing/extra case or failed row');
 const cases=new Map(dataset.questions.map(c=>[c.id,c]));assert.equal(cases.size,dataset.questions.length,'Duplicate dataset IDs');
 for(const r of rows){const c=cases.get(r.caseId);assert.equal(r.split,split,'Wrong split');assert.equal(r.question,c.question,'Question changed');assert.equal(r.answerable,c.answerable,'Answerability changed');}
}
export function paired(before,after){
 const index=new Map(before.map(r=>[key(r),r]));assert.equal(index.size,before.length);assert.deepEqual([...index.keys()].sort(),after.map(key).sort(),'Unpaired results');
 return after.map(b=>{const a=index.get(key(b));return {caseId:b.caseId,mode:b.mode,question:b.question,answerable:b.answerable,
   baseline:{recallAtK:a.recallAtK??null,mrr:a.mrr??null,error:a.error??null,abstained:a.abstained,citationValid:a.citationValid,answer:a.answer,citations:a.citations??[],evidence:a.evidence??[]},
   optimized:{recallAtK:b.recallAtK??null,mrr:b.mrr??null,error:b.error??null,abstained:b.abstained,citationValid:b.citationValid,answer:b.answer,citations:b.citations??[],evidence:b.evidence??[]},
   delta:{recallAtK:b.answerable?(b.recallAtK??0)-(a.recallAtK??0):null,mrr:b.answerable?(b.mrr??0)-(a.mrr??0):null},humanCorrectness:null};});
}
export function buildFinal({root='docs/results/phase2/optimization',baselineDev='docs/results/phase2/baseline',baselineTest='docs/results/phase2/baseline-holdout',devDataset='samples/phase2/dev.json',testDataset='samples/phase2/test.json'}={}){
 root=realpathSync(root);const inputs=[];
 const read=path=>{const bytes=readFileSync(path);inputs.push({file:resolve(path),sha256:sha(bytes)});return JSON.parse(bytes);};
 const suite=read(join(root,'suite.json')),freezePath=join(root,'final-configuration.json');
 const frozen=existsSync(freezePath)?read(freezePath):null;
 if(frozen)assert(frozen.frozenAt&&frozen.profileId&&frozen.options,'Invalid frozen configuration');
 const dev=read(devDataset),confirmation=read(join(root,'dev-confirmation.json'));
 assert(confirmation.sourceIds?.length&&confirmation.candidate,'Incomplete dev confirmation');
 if(suite.confirmation)assert.deepEqual(confirmation,suite.confirmation,'Confirmation differs from suite');
 const loadCandidate=(record,split)=>{
   assert(Array.isArray(record.sourceIds)&&record.sourceIds.length);assert.equal(new Set(record.sourceIds).size,record.sourceIds.length,'Duplicate source batch');
   const runs=record.sourceIds.map(id=>{
     assert(/^[a-z0-9_-]+$/i.test(id),'Unsafe batch id');
     assert(split==='test'?id.startsWith('test-frozen-'):!id.startsWith('test-'),'Source split prefix mismatch');
     const path=join(root,id+'.raw.json');assert.equal(dirname(realpathSync(path)),root,'Raw source escaped root');
     const run=read(path);assert(['COMPLETED','COMPLETED_WITH_ERRORS','SUCCEEDED'].includes(run.status),'Incomplete raw batch');
     if(run.kind==='composite-recovered-evaluation'){assert(run.recovery?.completed&&run.rawSources?.length,'Incomplete composite provenance');assert.equal(run.recovery.originalRows+run.recovery.recoveredRows,run.results.length);}
     assert.equal(run.config?.modelMode??run.modelMode,'real','Real report refuses mock');
     const variant=suite.variants?.[id];assert(variant,'Missing suite variant');
     const chosen=suite.variants[confirmation.candidate];assert(chosen,'Missing selected candidate');
     assert.equal(variant.profileId,chosen.profileId,'Candidate profile drift');assert.deepEqual(variant.options,chosen.options,'Candidate options drift');
     assert.deepEqual(run.config.retrievalOptions,chosen.options,'Raw options drift');
     if(split==='test'){assert.equal(variant.profileId,frozen.profileId);assert.deepEqual(variant.options,frozen.options);}
     return {file:path,run};
   });
   for(const {run} of runs.slice(1))for(const field of ['chatModel','embeddingModel','provider','topK','dataVersions','retrievalOptions'])assert.deepEqual(run.config[field],runs[0].run.config[field],`Candidate ${field} drift`);
   return runs;
 };
 const loadBaseline=(dir,split)=>{
   const stateFile=join(dir,'state.json'),state=read(stateFile);
   assert(state.runtime?.commit&&state.runtime?.sourceSha256,'Baseline runtime metadata missing');
   const pattern=split==='dev'?/^baseline-dev-.*\.json$/:/^baseline-holdout-test-.*\.json$/;
   const names=readdirSync(dir).filter(n=>pattern.test(n)).sort();assert(names.length,'Missing baseline raw batches');
   return names.map(n=>{const file=join(dir,n),run=read(file);assert(['COMPLETED','COMPLETED_WITH_ERRORS','SUCCEEDED'].includes(run.status),'Incomplete baseline batch');assert.equal(run.config?.modelMode??run.modelMode,'real');return {file,run,runtime:state.runtime,runtimeSource:stateFile};});
 };
 const aggregate=(dataset,split,candidate,baseline)=>{
   const rows=candidate.flatMap(x=>x.run.results),old=baseline.flatMap(x=>x.run.results);validateRows(rows,dataset,split);validateRows(old,dataset,split);
   const corpus=config=>{
     assert(Array.isArray(config?.dataVersions)&&config.dataVersions.length,'Missing corpus metadata');
     const values=config.dataVersions.map(v=>{assert(typeof v.name==='string'&&v.name.length&&typeof v.content_hash==='string'&&v.content_hash.length,'Missing document name/content_hash');return [v.name,v.content_hash];});
     assert.equal(new Set(values.map(v=>v[0])).size,values.length,'Ambiguous duplicate document names');
     return values.sort((a,b)=>a[0].localeCompare(b[0]));
   };
   const reference=candidate[0].run.config,referenceCorpus=corpus(reference);
   for(const {run} of [...candidate,...baseline]){
     for(const field of ['chatModel','embeddingModel','temperature','topK']){
       assert(reference[field]!==undefined&&reference[field]!==null&&run.config?.[field]!==undefined&&run.config[field]!==null,`Required comparable metadata missing: ${field}`);
       assert.deepEqual(run.config[field],reference[field],`Baseline/optimized ${field} drift`);
     }
     assert.deepEqual(corpus(run.config),referenceCorpus,'Baseline/optimized source corpus drift');
   }
   const sources=runs=>runs.map(({file,run,runtime,runtimeSource})=>({file,runId:run.id,kind:run.kind??null,config:run.config,runtime:runtime??run.recovery?.runtime??suite.runtime,runtimeSource:runtimeSource??join(root,'suite.json'),rawSources:run.rawSources??null,recovery:run.recovery??null,rows:run.results.length}));
   return {split,count:rows.length,baseline:summarize(old),optimized:summarize(rows),paired:paired(old,rows),sources:{baseline:sources(baseline),optimized:sources(candidate)},humanCorrectness:null};
 };
 const sets={dev:aggregate(dev,'dev',loadCandidate(confirmation,'dev'),loadBaseline(baselineDev,'dev'))};
 // Do not even list/open the holdout directory or dataset until a valid freeze exists.
 if(frozen){
   assert.equal(frozen.candidate,confirmation.candidate,'Frozen candidate differs');
   const record=read(join(root,'test-summary.json'));assert.deepEqual(record.configuration,frozen,'Test configuration differs from freeze');
   sets.test=aggregate(read(testDataset),'test',loadCandidate(record,'test'),loadBaseline(baselineTest,'test'));
 }
 const operationalInterruptions=Object.values(sets).flatMap(s=>s.sources.optimized.filter(x=>x.recovery).map(x=>({split:s.split,file:x.file,kind:x.kind,originalRows:x.recovery.originalRows,recoveredRows:x.recovery.recoveredRows,interruption:x.recovery.operationalInterruption})));
 return {schemaVersion:1,generatedAt:new Date().toISOString(),scope:frozen?'dev_and_frozen_test':'dev_only',runtime:suite.runtime,sourceSha256:suite.runtime?.sourceSha256??null,frozenConfiguration:frozen,selectedCandidate:confirmation.candidate,selectedConfiguration:suite.variants[confirmation.candidate],inputs,sets,operationalInterruptions,humanCorrectness:null,
   limitations:['配对观察差异，不是因果或泛化结论；dev包含选参题，不是独立测试。','失败行保留在完整题集，答案正确性和引用支持未人工评分。','耗时仅统计所有有限的已保存行值（含失败）；不含停机恢复等待和未知在途调用。','usage仅供应商实际字段，缺失null；观测合计不等于完整成本，未知中断调用单独披露。','组合恢复不是单次无中断评测；原始与补充来源完整保留。']};
}
export function finalMarkdown(report){
 const fmt=x=>typeof x==='number'&&Number.isFinite(x)?x.toFixed(4):'不可用';
 const out=['# 阶段二最终完整题集对比',`范围：${report.scope}；提交：${report.runtime?.commit??'不可用'}；source SHA256：${report.sourceSha256??'不可用'}。`,`选定配置：${report.selectedCandidate}；profile=${report.selectedConfiguration?.profileId}；options=${JSON.stringify(report.selectedConfiguration?.options)}。`,'人工正确性：null（未评分）。'];
 for(const i of report.operationalInterruptions)out.push(`\n> ${i.split} 含组合恢复：原 ${i.originalRows} + 补 ${i.recoveredRows} 行；${i.interruption?.potentialUnpersistedCase??'未知'} 在途调用用量不可用，非免费重试，不计作回答错误。`);
 for(const [split,set] of Object.entries(report.sets)){
   out.push(`\n## ${split}：${set.count} 行完整配对`,'\n| 配置 | 模式 | Recall@K | MRR | error/count | 检索 mean/p50/p95 ms | 总耗时 mean/p50/p95 ms |','|---|---|---:|---:|---:|---|---|');
   for(const name of ['baseline','optimized'])for(const [mode,s] of Object.entries(set[name]))out.push(`| ${name} | ${mode} | ${fmt(s.recallAtK)} | ${fmt(s.mrr)} | ${s.errorCount}/${s.count} | ${['mean','p50','p95'].map(k=>fmt(s.retrievalMs[k])).join('/')} | ${['mean','p50','p95'].map(k=>fmt(s.totalMs[k])).join('/')} |`);
   out.push('\n实际用量覆盖（可用行/全部行；观测合计）：');
   for(const name of ['baseline','optimized'])for(const [mode,s] of Object.entries(set[name]))out.push(`- ${name}/${mode}：${Object.entries(s.usage).map(([k,v])=>`${k} ${v.availableCount}/${s.count}；${v.observedSum??'不可用'}`).join('，')}`);
   out.push('\n逐题变化或失败（全部配对含未变化行在JSON）：');
   for(const p of set.paired)if(p.baseline.error||p.optimized.error||p.delta.recallAtK||p.delta.mrr)out.push(`- ${p.caseId}/${p.mode}：ΔRecall=${fmt(p.delta.recallAtK)}，ΔMRR=${fmt(p.delta.mrr)}；错误 ${JSON.stringify(p.baseline.error)} → ${JSON.stringify(p.optimized.error)}。`);
 }
 out.push('\n## 限制',...report.limitations.map(x=>'- '+x));return out.join('\n')+'\n';
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=process.argv[2]??'docs/results/phase2/optimization',report=buildFinal({root}),dir=join(realpathSync(root),'reports');mkdirSync(dir,{recursive:true});assert.equal(realpathSync(dir),dir);
 const stem='final-report-'+new Date().toISOString().replace(/[:.]/g,'-');
 for(const [ext,body] of [['json',JSON.stringify(report,null,2)+'\n'],['md',finalMarkdown(report)]])writeFileSync(join(dir,stem+'.'+ext),body,{flag:'wx'});
 console.log(JSON.stringify({scope:report.scope,stem,dir}));
}
