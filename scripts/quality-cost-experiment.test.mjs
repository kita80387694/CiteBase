import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {costCases,costArms} from './quality-cost-experiment.mjs';
import {selectReviewCases} from './quality-registration.mjs';
const dataset=JSON.parse(readFileSync('samples/phase3-quality/evaluation.json'));
const baseline={caseIds:selectReviewCases(dataset).map(q=>q.id)};
test('cost exploration selection is deterministic, balanced and never accesses test',()=>{
 const q=costCases(dataset,baseline);assert.equal(q.length,4);assert.deepEqual(q,costCases(dataset,baseline));
 for(const split of ['dev','validation']){const rows=q.filter(q=>q.split===split);assert.equal(rows.length,2);assert.equal(rows.filter(q=>q.answerable).length,1);}
 assert(q.every(q=>q.split!=='test'));
});
test('cost controls differ only by registered intervention; cold hot mixed use identical question order',()=>{
 const arms=costArms(costCases(dataset,baseline));assert.equal(arms.length,6);
 assert.equal(arms.reduce((n,a)=>n+a.items.length*2,0),64);
 assert.deepEqual(arms[1].options,{...arms[0].options,candidateK:5});
 assert.deepEqual(arms[2].options,{...arms[1].options,rerankPolicy:'candidate-pressure-v1'});
 assert.deepEqual(arms[3].options,{...arms[0].options,deduplicate:true});
 assert.deepEqual(arms[4].items,arms[5].items);assert.deepEqual(arms[5].options,{...arms[4].options,cache:true});
 for(const a of arms)assert.equal(new Set(a.items.map(i=>i.question.id)).size,a.items.length);
 const traffic=arms[5].items;assert.equal(traffic[0].question.question,traffic[1].question.question);
 const warm=new Set(traffic.slice(0,4).map(i=>i.baseCaseId));assert.equal(traffic.slice(4).filter(i=>warm.has(i.baseCaseId)).length,2);
});
