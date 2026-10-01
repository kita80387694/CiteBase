import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const dimensions=['correctness','completeness','citationSupport','unsupportedContent','refusal'];
export function blindAnswer(raw){return (raw.evidence||[]).reduce((text,e,i)=>text.replaceAll(`[${e.id}]`,`[${i+1}]`),raw.answer);}
export function consensus(scores){assert(scores.length>0);assert.equal(new Set(scores.map(s=>s.reviewer)).size,scores.length,'Duplicate reviewer');return Object.fromEntries(dimensions.map(d=>[d,new Set(scores.map(s=>s[d])).size===1?scores[0][d]:null]));}
export function coverage(labels,evidence){const groups=new Map();for(const l of labels){assert(l.group&&l.quote);groups.set(l.group,[...(groups.get(l.group)||[]),l]);}const hits=[...groups.values()].filter(ls=>ls.some(l=>evidence.some(e=>e.documentName===l.documentName&&e.page===l.page&&e.text.includes(l.quote)))).length;return {requiredGroups:groups.size,hitGroups:hits,allHit:groups.size?hits===groups.size:null};}
export function analyze(reviewDir,baselineDir){
 const provenance=[];const read=file=>{const bytes=fs.readFileSync(file);provenance.push({file:file.replaceAll('\\','/'),sha256:sha(bytes)});return JSON.parse(bytes);};
 const review=read(path.join(reviewDir,'assisted-review-export.json'));assert.equal(review.source,'ASSISTED');assert.equal(review.humanConfirmed,false);
 for(const p of review.provenance)assert.equal(sha(fs.readFileSync(path.join(reviewDir,p.file))),p.sha256,`Changed reviewed source ${p.file}`);
 const project=read(path.join(baselineDir,'review-initial.json'));const items=new Map(project.items.map(i=>[i.id,i]));const assignments=new Map(project.assignments.map(a=>[a.id,a]));
 const packets=new Map();for(const name of ['quality_reviewer1-packets.json','quality_reviewer2-packets.json'])for(const p of read(path.join(reviewDir,name)).packets){assert(!packets.has(p.id));packets.set(p.id,p);}
 const sources=new Map();for(const file of fs.readdirSync(baselineDir).filter(n=>/^q\d{3}-pair.json$/.test(n)).sort()){
  const pair=read(path.join(baselineDir,file)),prefix=file.slice(0,4);
  const ragFile=fs.readdirSync(path.join(baselineDir,'rag')).find(n=>n.endsWith(`${prefix}.raw.json`));assert(ragFile);
  const rag=read(path.join(baselineDir,'rag',ragFile));assert.equal(rag.id,pair.rag.runId);const row=rag.results.find(r=>r.caseId===pair.caseId&&r.mode==='vector');assert(row);assert.notEqual(row.split,'test');
  const agent=read(path.join(baselineDir,'agent',`${prefix}.raw.json`));assert.equal(agent.id,pair.agent.runId);
  sources.set(pair.rag.runId,{mode:'RAG',caseId:pair.caseId,raw:row,meta:row,failure:!!row.error});
  sources.set(pair.agent.runId,{mode:'Agent',caseId:pair.caseId,raw:agent.result,meta:row,failure:agent.status!=='COMPLETED',errorCode:agent.errorCode});
 }
 const grouped=new Map();for(const s of review.scores){assert.equal(s.source,'ASSISTED');assert.equal(s.humanConfirmed,false);const a=assignments.get(s.assignmentId);assert(a);assert.equal(a.itemId,s.itemId);const p=packets.get(s.assignmentId);assert(p);assert.equal(sha(p.answer),s.answerSha256);assert.equal(p.answer,s.answer);assert.equal(p.question,s.question);grouped.set(s.itemId,[...(grouped.get(s.itemId)||[]),s]);}
 assert.equal(grouped.size,80);assert.equal(review.scores.length,96);assert.equal(grouped.size,items.size);
 const answers=[];for(const [itemId,scores]of grouped){const item=items.get(itemId);assert(item);const source=sources.get(item.source.runId);assert(source);const {raw,meta}=source;assert(raw);const p=packets.get(scores[0].assignmentId);
  assert.equal(blindAnswer(raw),p.answer,'Raw answer must reproduce blinded answer');assert.equal(meta.question,p.question);assert.equal(source.failure,p.executionFailed);
  for(const s of scores)assert.equal(s.answerSha256,scores[0].answerSha256);
  const expectedEvidence=(raw.evidence||[]).map((e,i)=>({label:String(i+1),documentName:e.documentName,page:e.page,paragraph:e.paragraph,text:e.text}));assert.deepEqual(p.evidence,expectedEvidence);
  const dims=consensus(scores),evidence=coverage(p.expectedEvidence,raw.evidence||[]);
  const errorType=source.failure?'EXECUTION_FAILED':dims.refusal==='INCORRECT_REFUSAL'?(evidence.allHit?'REFUSAL_WITH_ALL_LABELLED_EVIDENCE':'REFUSAL_WITH_MISSING_LABELLED_EVIDENCE'):dims.correctness==='INCORRECT'?'OTHER_INCORRECT':dims.correctness===null?'DISPUTED':'NO_ASSISTED_ERROR';
  answers.push({itemId,caseId:source.caseId,mode:source.mode,runId:item.source.runId,category:meta.category,split:meta.split,topic:meta.topic,answerable:meta.answerable,executionFailed:source.failure,errorCode:source.errorCode??raw.error??null,answerSha256:scores[0].answerSha256,rawAnswerSha256:sha(raw.answer),scoreCount:scores.length,dimensions:dims,evidence,errorType,question:p.question,answer:p.answer,rationales:scores.map(s=>({reviewer:s.reviewer,rationale:s.rationale}))});
 }
 const counts=rows=>({answers:rows.length,executionFailed:rows.filter(r=>r.executionFailed).length,types:Object.fromEntries([...new Set(rows.map(r=>r.errorType))].map(t=>[t,rows.filter(r=>r.errorType===t).length])),dimensions:Object.fromEntries(dimensions.map(d=>[d,Object.fromEntries([...new Set(rows.map(r=>r.dimensions[d]))].map(v=>[String(v),rows.filter(r=>r.dimensions[d]===v).length]))]))});
 return {source:'ASSISTED',humanReviewed:false,qualityConclusion:'AI辅助分析，非真人评审或人类正确性结论',unit:'unique answer, repeated reviews collapsed; disagreements remain null; failed executions included',scores:review.scores.length,uniqueAnswers:answers.length,doubleReviewed:answers.filter(a=>a.scoreCount===2).length,byMode:Object.fromEntries(['RAG','Agent'].map(m=>[m,counts(answers.filter(a=>a.mode===m))])),byCategory:Object.fromEntries([...new Set(answers.map(a=>a.category))].map(c=>[c,Object.fromEntries(['RAG','Agent'].map(m=>[m,counts(answers.filter(a=>a.mode===m&&a.category===c))]))])),answers,provenance};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [review,baseline,out]=process.argv.slice(2);const result=analyze(review,baseline);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({uniqueAnswers:result.uniqueAnswers,byMode:result.byMode},null,2));}
