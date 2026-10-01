import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {assignmentPlan,bootstrap,compare,templates,canonicalScoreHash} from './quality-assisted-comparison.mjs';
function fixture(){const sha=crypto.createHash('sha256').update('answer').digest('hex'),strategies=['original','grounded-answer-v1','combined-v1','combined-grounded-v1'];const packets=[],items=[];for(let q=0;q<8;q++)for(const strategy of strategies){const id=`A${packets.length}`;packets.push({id,answer:'answer',answerSha256:sha,answerable:q<6,executionFailed:q===0});items.push({packetId:id,answerSha256:sha,caseId:`q${q}`,strategy});}const p={source:'ASSISTED',packets},m={source:'ASSISTED',expectedRuns:32,items};const scores=templates(p);for(const f of scores)for(const s of f.scores)Object.assign(s,{correctness:'CORRECT',completeness:'CORRECT',citationSupport:'SUPPORTED',unsupportedContent:'NONE',refusal:'NOT_REFUSED',rationale:'fixture only',ruleVersion:'citebase-assisted-quality-v1',reviewedAt:'2026-10-01T08:00:00Z'});return [p,m,scores];}
test('32 answers require 39 scores with deterministic 20% rounded-up independent review',()=>{const [p,m,s]=fixture();assert.equal(assignmentPlan(p.packets).length,39);const r=compare(p,m,s);assert.equal(r.uniqueAnswers,32);assert.equal(r.receivedScores,39);assert.equal(r.byStrategy.original.failures,1);assert.equal(r.paired['combined-v1'].cases[0].original,0);assert.equal(r.selection.selected,null);});
test('missing and disagreements remain denominator and block selection and interval',()=>{let [p,m,s]=fixture();s[0].scores.pop();let r=compare(p,m,s);assert.equal(r.complete,false);assert.equal(r.uniqueAnswers,32);[p,m,s]=fixture();const double=assignmentPlan(p.packets).find(a=>a.role==='SECONDARY');s[double.reviewer==='A'?0:1].scores.find(x=>x.packetId===double.packetId).correctness='INCORRECT';r=compare(p,m,s);assert.equal(r.complete,false);assert(r.rows.some(r=>r.disputed&&r.dimensions.correctness===null));});
test('duplicate, human source, changed answer and invalid score rejected',()=>{for(const mutate of [a=>a[2][0].scores.push(a[2][0].scores[0]),a=>a[2][0].source='HUMAN',a=>a[0].packets[0].answer='changed',a=>a[2][0].scores[0].correctness='PASS']){const a=fixture();mutate(a);assert.throws(()=>compare(...a));}});
test('bootstrap is paired deterministic and refuses unresolved cases',()=>{assert.deepEqual(bootstrap([1,0,-1,1]),bootstrap([1,0,-1,1]));assert.equal(bootstrap([1,null]),null);assert.equal(bootstrap([0,0]).upper,0);});

test('NA correctness remains unresolved for successful runs but failure contributes zero',()=>{
 const [p,m,s]=fixture();
 const success=p.packets.find(p=>!p.executionFailed),failure=p.packets.find(p=>p.executionFailed);
 for(const f of s)for(const score of f.scores)if([success.id,failure.id].includes(score.packetId)){score.correctness='NA';score.naReasons={correctness:'insufficient assessment basis'};}
 const r=compare(p,m,s);assert.equal(r.complete,true);assert.equal(r.qualitySelectable,false);
 assert(Object.values(r.assistedEligibility).every(x=>x.eligibleByAssistedGates===null));
 const candidate=Object.values(r.paired)[0];
 assert.equal(candidate.cases.find(x=>x.caseId==='q0').original,0);
 assert.equal(candidate.cases.find(x=>x.caseId==='q1').original,null);
 assert.equal(candidate.interval,null);
 assert.equal(r.rows.find(x=>x.packetId===failure.id).dimensions.correctness,'NA');
});
test('NA explanations, fixed rule and actual timestamp are mandatory',()=>{
 for(const mutate of [x=>x.ruleVersion='other',x=>x.reviewedAt='bad',x=>delete x.reviewedAt,x=>{x.correctness='NA';x.naReasons={};}]){
 const a=fixture();mutate(a[2][0].scores[0]);assert.throws(()=>compare(...a));
 }
});

function adjudicationFixture(){const [p,m,s]=fixture(),a=assignmentPlan(p.packets).find(x=>x.role==='SECONDARY');const both=s.flatMap(f=>f.scores).filter(x=>x.packetId===a.packetId);both[1].correctness='INCORRECT';const decision={...both[0],source:'ASSISTED_ADJUDICATION',reviewer:'independent-C',scoreHashes:both.map(canonicalScoreHash),rationale:'Independent fixture adjudication'};return [p,m,s,20261001,{source:'ASSISTED_ADJUDICATION',decisions:[decision]}];}
test('independent assisted adjudication binds both original scores and preserves audit',()=>{const args=adjudicationFixture();const r=compare(...args),row=r.rows.find(x=>x.resolvedBy);assert(row.originalDisputed);assert.equal(row.disputed,false);assert.equal(row.originalValues.correctness,null);assert.equal(row.originalScores.length,2);assert.equal(row.resolvedBy.source,'ASSISTED_ADJUDICATION');assert.equal(r.complete,true);});
test('stale hashes, unknown answers and non-independent adjudication rejected',()=>{for(const mutate of [d=>d.scoreHashes[0]='forged',d=>d.answerSha256='forged',d=>d.packetId='unknown',d=>d.reviewer='A',d=>d.ruleVersion='old']){const a=adjudicationFixture();mutate(a[4].decisions[0]);assert.throws(()=>compare(...a));}});
test('no dispute cannot be adjudicated and canonical hashes ignore object key order',()=>{const a=adjudicationFixture();const id=a[4].decisions[0].packetId;for(const f of a[2])for(const score of f.scores)if(score.packetId===id)score.correctness='CORRECT';assert.throws(()=>compare(...a),/only applies/);assert.equal(canonicalScoreHash({a:1,b:{c:2,d:3}}),canonicalScoreHash({b:{d:3,c:2},a:1}));});
