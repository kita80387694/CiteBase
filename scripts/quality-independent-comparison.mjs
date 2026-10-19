import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {compare,templates} from './quality-assisted-comparison.mjs';
const arms=['rag-vector','rag-hybrid','agent-original','agent-selected'];
export function independentComparison(packets,mapping,scores,adjudication=null,seed=20261001){
 assert.equal(packets.packets.length,160);assert.equal(mapping.expectedRuns,160);assert.deepEqual([...new Set(mapping.items.map(i=>i.strategy))].sort(),[...arms].sort());
 const fromRag=compare(packets,mapping,scores,seed,adjudication,'rag-vector');
 const fromAgent=compare(packets,mapping,scores,seed,adjudication,'agent-original');
 assert.equal(fromRag.expectedScores,192);assert.equal(fromRag.byStrategy['rag-vector'].answers,40);
 return {source:'ASSISTED',humanReviewed:false,unit:fromRag.unit,seed,complete:fromRag.complete,qualitySelectable:fromRag.qualitySelectable,uniqueAnswers:160,expectedScores:192,receivedScores:fromRag.receivedScores,byArm:fromRag.byStrategy,rows:fromRag.rows,
 pairedAgainstRagVector:fromRag.paired,pairedAgainstAgentOriginal:fromAgent.paired,
 decision:{selected:null,defaultChanged:false,reason:'Frozen independent test reports only; no strategy selection or retuning from this set.'},
 limitations:['AI-assisted assessment, not human quality or inter-rater reliability.','Each of 160 answers remains in its arm denominator. Execution failures count 0 in paired end-to-end correctness; successful NA or unresolved disputes stay null.','Correct refusals use CORRECT correctness and remain in the same end-to-end metric.','Paired question bootstrap is small-sample, correlated AI evidence; not proof of noninferiority.']};
}
export function independentTemplates(packets,batchSize=40,seed=20261001){assert.equal(packets.packets.length,160);assert([40,80].includes(batchSize));const full=templates(packets,seed);return full.map(file=>{assert.equal(file.scores.length,96);return {reviewer:file.reviewer,batches:Array.from({length:Math.ceil(file.scores.length/batchSize)},(_,i)=>{const scores=file.scores.slice(i*batchSize,(i+1)*batchSize);return {source:'ASSISTED',reviewer:file.reviewer,batch:i+1,instructions:file.instructions,scores,packets:packets.packets.filter(p=>scores.some(s=>s.packetId===p.id))};})};});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [p,m,a,b,out,adjudication]=process.argv.slice(2);const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));const result=independentComparison(read(p),read(m),[read(a),read(b)],adjudication?read(adjudication):null);result.inputs=[p,m,a,b,...(adjudication?[adjudication]:[])].map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
