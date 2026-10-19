import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const safe=x=>{assert(/^[a-zA-Z0-9._-]+$/.test(x)&&!x.includes('..'),'Unsafe name');return x;};
export function buildPackets(registration,cases,runs,documents,seed=20261001){
 assert(Number.isInteger(seed));assert.equal(new Set(registration.caseIds).size,registration.caseIds.length);
 assert.equal(new Set(registration.strategies).size,registration.strategies.length);
 const expected=registration.caseIds.length*registration.strategies.length;
 assert.equal(runs.length,expected,'INCOMPLETE: not all registered runs present');
 const entries=[],seen=new Set();
 for(const run of runs){const {caseId,strategy,raw,derived}=run;assert(registration.caseIds.includes(caseId)&&registration.strategies.includes(strategy));
  assert(!seen.has(caseId+'|'+strategy));seen.add(caseId+'|'+strategy);
  const c=cases.find(c=>c.id===caseId);assert(c&&['dev','validation'].includes(c.split),'Only dev/validation permitted');
  assert.equal(derived.caseId,caseId);assert.equal(derived.split,c.split);assert.equal(raw.request.question,c.question);
  assert.equal(raw.request.strategy??'original',strategy);assert(['COMPLETED','FAILED','CANCELLED','INTERRUPTED'].includes(raw.status),'INCOMPLETE: nonterminal run');
  assert.equal(derived.status,raw.status);const result=raw.result;assert(result&&typeof result.answer==='string','INCOMPLETE: missing final result');
  assert.equal(derived.answer,result.answer);assert.deepEqual(derived.evidence,result.evidence);
  const gold=c.evidence.map(l=>{const text=documents[l.documentName];assert.equal(typeof text,'string');assert.equal(hash(text),l.sourceHash,'Document hash mismatch');assert.equal(text.slice(l.startOffset,l.endOffset),l.quote,'Evidence offsets mismatch');assert.equal(l.page,1);assert.equal(text.slice(0,l.startOffset).split(/\n\s*\n/).length,l.paragraph);return {...l};});
  const ids=new Map((result.evidence||[]).map((e,i)=>[e.id,String(i+1)]));assert.equal(ids.size,result.evidence.length,'Duplicate evidence ID');
  let answer=result.answer;for(const [id,label]of ids)answer=answer.replaceAll(`[${id}]`,`[${label}]`);
  const citations=(result.citations||[]).map(c=>{const id=typeof c==='string'?c:c.id;assert(ids.has(id),'Citation outside actual evidence');return ids.get(id);});
  const packet={source:'ASSISTED',question:c.question,answer,answerSha256:hash(answer),answerable:c.answerable,referenceAnswer:c.expectedAnswer,
   executionFailed:raw.status!=='COMPLETED',evidence:result.evidence.map((e,i)=>({label:String(i+1),documentName:e.documentName,page:e.page,paragraph:e.paragraph,startOffset:e.startOffset,endOffset:e.endOffset,text:e.text})),citations,
   expectedEvidence:gold,score:null};
  entries.push({packet,mapping:{caseId,strategy,runId:raw.id,status:raw.status,rawAnswerSha256:hash(result.answer),citationMapping:Object.fromEntries(ids)},order:hash(`${seed}|${caseId}|${strategy}`)});
 }
 entries.sort((a,b)=>a.order.localeCompare(b.order));
 entries.forEach((e,i)=>{e.packet.id=`A${String(i+1).padStart(3,'0')}`;e.mapping.packetId=e.packet.id;e.mapping.answerSha256=e.packet.answerSha256;});
 return {packets:{source:'ASSISTED',humanReviewed:false,packets:entries.map(e=>e.packet)},mapping:{source:'ASSISTED',seed,expectedRuns:expected,items:entries.map(e=>e.mapping)}};
}
export function prepare(experimentRoot,datasetRoot,seed=20261001){
 const inputs=[];const read=p=>{const bytes=fs.readFileSync(p);inputs.push({file:p.replaceAll('\\','/'),sha256:hash(bytes)});return JSON.parse(bytes);};
 const registration=read(path.join(experimentRoot,'registration.json'));
 const cases=['dev','validation'].flatMap(split=>read(path.join(datasetRoot,`${split}.json`)).questions);
 const documents={},runs=[];
 for(const caseId of registration.caseIds){safe(caseId);const c=cases.find(c=>c.id===caseId);assert(c,'Only dev/validation selected IDs permitted');
  for(const l of c.evidence)if(!(l.documentName in documents)){safe(l.documentName);const p=path.join(datasetRoot,'documents',l.documentName),bytes=fs.readFileSync(p);inputs.push({file:p.replaceAll('\\','/'),sha256:hash(bytes)});documents[l.documentName]=bytes.toString('utf8');}
  for(const strategy of registration.strategies){safe(strategy);const stem=path.join(experimentRoot,'runs',`${caseId}-${strategy}`);assert(fs.existsSync(`${stem}.raw.json`)&&fs.existsSync(`${stem}.derived.json`),'INCOMPLETE: raw/derived run missing');runs.push({caseId,strategy,raw:read(`${stem}.raw.json`),derived:read(`${stem}.derived.json`)});}
 }
 const result=buildPackets(registration,cases,runs,documents,seed);result.mapping.inputs=inputs;return result;
}
export function writePackets(result,output){assert(!fs.existsSync(output),'Output already exists; refuse overwrite');fs.mkdirSync(output,{recursive:false});fs.writeFileSync(path.join(output,'packets.json'),JSON.stringify(result.packets,null,2)+'\n',{flag:'wx'});fs.writeFileSync(path.join(output,'private-mapping.json'),JSON.stringify(result.mapping,null,2)+'\n',{flag:'wx'});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [root,dataset,out,seed]=process.argv.slice(2);writePackets(prepare(root,dataset,seed===undefined?20261001:Number(seed)),out);console.log('Complete anonymous ASSISTED packets written; private-mapping.json must not be shared with reviewers.');}
