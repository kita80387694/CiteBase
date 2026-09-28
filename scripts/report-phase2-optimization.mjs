import {readFileSync,existsSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,dirname,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=b=>createHash('sha256').update(b).digest('hex');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const mean=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
const distribution=a=>({count:a.length,mean:mean(a),p50:a.length?[...a].sort((a,b)=>a-b)[Math.ceil(a.length*.5)-1]:null,p95:a.length?[...a].sort((a,b)=>a-b)[Math.ceil(a.length*.95)-1]:null});
export function summarize(rows){
 const result={};
 for(const mode of ['vector','hybrid']){
  const r=rows.filter(x=>x.mode===mode),a=r.filter(x=>x.answerable),u=r.filter(x=>!x.answerable);
  const s={count:r.length,answerable:a.length,unanswerable:u.length,recallAtK:mean(a.map(x=>finite(x.recallAtK)?x.recallAtK:0)),mrr:mean(a.map(x=>finite(x.mrr)?x.mrr:0)),errorCount:r.filter(x=>x.error).length,errorRate:mean(r.map(x=>x.error?1:0)),citationValidCount:r.filter(x=>x.citationValid).length,correctAbstentionCount:u.filter(x=>x.abstained&&x.citationValid&&!x.error).length,humanCorrectness:null};
  for(const field of ['retrievalMs','totalMs']){const values=r.map(x=>x[field]).filter(finite);s[field]={...distribution(values),unavailableCount:r.length-values.length};}
  s.usage={};for(const [field,get] of Object.entries({chatPrompt:x=>x.promptTokens,chatCompletion:x=>x.completionTokens,embeddingPrompt:x=>x.usage?.embedding?.promptTokens,embeddingTotal:x=>x.usage?.embedding?.totalTokens,rerankPrompt:x=>x.usage?.rerank?.promptTokens,rerankCompletion:x=>x.usage?.rerank?.completionTokens,rerankTotal:x=>x.usage?.rerank?.totalTokens})){const values=r.map(get).filter(finite);s.usage[field]={availableCount:values.length,unavailableCount:r.length-values.length,coverage:r.length?values.length/r.length:null,observedSum:values.length?values.reduce((a,b)=>a+b,0):null};}result[mode]=s;
 }return result;
}
function signals(r){return [r.error?'execution_error':null,r.answerable&&(!finite(r.recallAtK)||r.recallAtK<1)?'missing_required_evidence':null,r.answerable&&r.allEvidenceHit&&r.abstained?'all_evidence_hit_but_abstained':null,!r.citationValid?'citation_not_valid':null,!r.answerable&&!(r.abstained&&r.citationValid&&!r.error)?'unanswerable_not_correctly_abstained':null].filter(Boolean);}
function verifySummary(expected,actual,path='summary'){
 for(const [key,value] of Object.entries(expected??{})){
  const observed=actual?.[key];
  if(value&&typeof value==='object')verifySummary(value,observed,`${path}.${key}`);
  else if(finite(value)&&finite(observed))assert(Math.abs(value-observed)<1e-9,`${path}.${key}: saved summary differs from raw recomputation`);
  else assert.deepEqual(observed,value,`${path}.${key}: saved summary differs from raw recomputation`);
 }
}
export function buildReport(root){
 root=realpathSync(root);const inputs=[];
 const read=p=>{const b=readFileSync(p);inputs.push({file:p,sha256:sha(b)});return JSON.parse(b);};
 const suite=read(join(root,'suite.json')),freezePath=join(root,'final-configuration.json');
 const frozen=existsSync(freezePath)?read(freezePath):null;
 if(frozen)assert(frozen.frozenAt&&frozen.profileId&&frozen.options,'Invalid freeze artifact');
 const variants={},skipped=[],warnings=[];
 for(const [id,v] of Object.entries(suite.variants??{})){
  const holdout=id.startsWith('test-frozen-');
  if(holdout&&!frozen){skipped.push({id,reason:'holdout_locked_until_final_configuration_exists'});continue;}
  if(!/^(a-|b1-|b2-|c-|d-|dev-confirm-|test-frozen-)/.test(id)){skipped.push({id,reason:'unknown_variant_prefix_not_read'});continue;}
  const p=resolve(v.rawFile),rel=relative(root,p);assert(!rel.startsWith('..')&&!rel.includes('..')&&!rel.startsWith('/')&&dirname(p)===root,'Raw input must be directly within suite directory');
  assert(p.endsWith('.raw.json'),'Only raw JSON variant inputs allowed');
  if(!existsSync(p)){warnings.push(`${id}: raw file absent; not counted`);continue;}
  assert(dirname(realpathSync(p))===root,'Raw symlink outside suite rejected');
  const raw=read(p),rows=raw.results??[];assert(Array.isArray(rows),'Invalid results');
  assert(rows.every(r=>holdout?r.split==='test':r.split!=='test'),'Variant split conflicts with read gate');
  assert(new Set(rows.map(r=>`${r.caseId}:${r.mode}`)).size===rows.length,'Duplicate case/mode rows');
  const recomputed=summarize(rows);verifySummary(v.summary,recomputed);const failures=rows.flatMap(r=>{const found=signals(r);return found.length?[{caseId:r.caseId,mode:r.mode,category:r.category??null,question:r.question,signals:found,error:r.error??null,recallAtK:r.recallAtK??null,mrr:r.mrr??null,allEvidenceHit:r.allEvidenceHit??null,abstained:r.abstained??null,citationValid:r.citationValid??null,answer:r.answer??null,expectedEvidence:r.expectedEvidence??[],retrievedEvidence:r.evidence??[],citations:r.citations??[],humanCorrectness:null}]:[];});
  variants[id]={id,split:holdout?'test':'dev',profile:suite.profiles?.[v.profileId]?.profile??{id:v.profileId},options:v.options,status:raw.status??null,runId:raw.id??null,config:raw.config??null,runtime:suite.runtime,rawFile:p,summary:recomputed,savedSummaryVerified:v.summary!=null,failures,caseKeys:rows.map(r=>`${r.caseId}:${r.mode}`).sort()};
 }
 const comparisons=[];
 for(const v of Object.values(variants)){
  const control=v.id.startsWith('a-')?'a-legacy900':v.id.startsWith('b1-')?suite.selections?.a:v.id.startsWith('b2-')?suite.selections?.b1:v.id.startsWith('c-')?suite.selections?.b2:v.id.startsWith('d-')?suite.selections?.c:null;
  if(!control||control===v.id||!variants[control])continue;
  const base=variants[control],sameCases=JSON.stringify(v.caseKeys)===JSON.stringify(base.caseKeys);
  comparisons.push({variant:v.id,control,sameCases,causalAttribution:false,note:v.id.startsWith('d-')?'Use recorded compactComparison; no citation-alias attribution if retrieval contexts differ.':'Paired observed difference, not a causal or generalization claim.',compactComparison:v.id.startsWith('d-')?suite.compactComparison??null:undefined,delta:sameCases?Object.fromEntries(['vector','hybrid'].map(m=>[m,{recallAtK:v.summary[m].recallAtK-base.summary[m].recallAtK,mrr:v.summary[m].mrr-base.summary[m].mrr,errorCount:v.summary[m].errorCount-base.summary[m].errorCount}])):null});
 }
 return {schemaVersion:1,generatedAt:new Date().toISOString(),scope:frozen?'dev_and_available_frozen_test':'dev_only',frozenConfiguration:frozen,runtime:suite.runtime,planSha256:suite.planSha256,tuningSha256:suite.tuningSha256,inputs,variants,comparisons,skipped,warnings,humanCorrectness:null,definitions:{recallAtK:'Mean required-evidence-group recall over answerable rows; absent metrics count zero, failed rows retained.',mrr:'Mean reciprocal first relevant rank over answerable rows; absent metrics count zero.',latency:'Observed finite row milliseconds; mean and nearest-rank p50/p95, missing count retained. Failed row durations included when available.',usage:'Actual returned numeric usage only; missing remains unavailable, observed sum is not a complete cost estimate.',errors:'Automatic signals can overlap; citation validity, evidence hit, abstention and human answer correctness are distinct.',incomplete:'Only persisted variants are summarized; missing/in-flight variants are not assumed successful.'}};
}
export function markdown(r){
 const fmt=n=>finite(n)?n.toFixed(4):'不可用';
 const out=['# 阶段二消融与自动错误分析',`范围：${r.scope}；运行提交：${r.runtime?.commit??'不可用'}；源码 SHA256：${r.runtime?.sourceSha256??'不可用'}。`,'人工答案正确性：未评分（null）。失败行保留，自动信号不是人工判分。','| Variant | Mode | Rows | Recall@K | MRR | Errors | 检索 mean/p50/p95 ms | 总耗时 mean/p50/p95 ms |','|---|---|---:|---:|---:|---:|---|---|'];
 for(const v of Object.values(r.variants))for(const [mode,s] of Object.entries(v.summary))out.push(`| ${v.id} | ${mode} | ${s.count} | ${fmt(s.recallAtK)} | ${fmt(s.mrr)} | ${s.errorCount} | ${['mean','p50','p95'].map(k=>fmt(s.retrievalMs[k])).join('/')} | ${['mean','p50','p95'].map(k=>fmt(s.totalMs[k])).join('/')} |`);
 out.push('\n## 配置、用量覆盖和失败题');
 for(const v of Object.values(r.variants)){out.push(`\n### ${v.id}`,`配置：${JSON.stringify(v.profile)} / ${JSON.stringify(v.options)}；状态：${v.status}。`);for(const [mode,s]of Object.entries(v.summary))out.push(`${mode} usage：${Object.entries(s.usage).map(([k,x])=>`${k} ${x.availableCount}/${s.count}，观测合计 ${x.observedSum??'不可用'}`).join('；')}`);for(const f of v.failures)out.push(`- ${f.caseId} / ${f.mode}：${f.signals.join(', ')}；error=${JSON.stringify(f.error)}；Recall=${fmt(f.recallAtK)}。`);}
 out.push('\n## 对照与限制',...r.comparisons.map(c=>`- ${c.variant} vs ${c.control}：同题=${c.sameCases}；Δ=${JSON.stringify(c.delta)}。${c.note}`),'\n只读输入及 SHA256、逐题原文证据、配置快照见配套 JSON。未冻结时不读取 test-frozen 原始文件。未完成批次不作效果结论。',...r.warnings.map(x=>`- ${x}`));return out.join('\n')+'\n';
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=process.argv[2]??'docs/results/phase2/optimization',report=buildReport(root),dir=join(realpathSync(root),'reports');mkdirSync(dir,{recursive:true});assert(realpathSync(dir)===dir,'Reports symlink rejected');
 const stem=`optimization-report-${new Date().toISOString().replace(/[:.]/g,'-')}`;const json=join(dir,stem+'.json'),md=join(dir,stem+'.md');writeFileSync(json,JSON.stringify(report,null,2)+'\n',{flag:'wx'});writeFileSync(md,markdown(report),{flag:'wx'});console.log(JSON.stringify({json,markdown:md,scope:report.scope,variants:Object.keys(report.variants).length}));
}
