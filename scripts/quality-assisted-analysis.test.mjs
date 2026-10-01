import test from 'node:test';
import assert from 'node:assert/strict';
import {blindAnswer,consensus,coverage,analyze} from './quality-assisted-analysis.mjs';
test('blind citation transform preserves original answer except assigned handles',()=>{
 assert.equal(blindAnswer({answer:'Text [abc] [abc] [other]',evidence:[{id:'abc'}]}),'Text [1] [1] [other]');
});
test('double reviews count once and conflict remains unresolved',()=>{
 const one={reviewer:'a',correctness:'CORRECT'};assert.equal(consensus([one,{...one,reviewer:'b'}]).correctness,'CORRECT');
 assert.equal(consensus([one,{reviewer:'b',correctness:'INCORRECT'}]).correctness,null);
 assert.throws(()=>consensus([one,one]));
});
test('alternative quotes share a requirement but missing required group fails',()=>{
 const labels=[{group:'g1',documentName:'a',page:1,quote:'x'},{group:'g1',documentName:'a',page:1,quote:'y'},{group:'g2',documentName:'b',page:1,quote:'z'}];
 assert.deepEqual(coverage(labels,[{documentName:'a',page:1,text:'x'}]),{requiredGroups:2,hitGroups:1,allHit:false});
 assert.equal(coverage(labels,[{documentName:'a',page:1,text:'y'},{documentName:'b',page:1,text:'z'}]).allHit,true);
});
test('frozen assisted baseline reconciles all source hashes and failures without test-set reads',()=>{
 const r=analyze('docs/results/quality-phase3/assisted-review-20261001','docs/results/quality-phase3/paired-baseline');
 assert.equal(r.uniqueAnswers,80);assert.equal(r.scores,96);assert.equal(r.doubleReviewed,16);
 assert.equal(r.byMode.Agent.executionFailed,5);assert.equal(r.byMode.RAG.answers,40);
 assert(r.answers.every(a=>['dev','validation'].includes(a.split)));
});
