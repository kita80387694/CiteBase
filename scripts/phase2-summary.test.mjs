import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
const script=resolve('scripts/summarize-phase2.mjs');
function withFixture(action){const directory=mkdtempSync(join(tmpdir(),'citebase-summary-'));try{const root=join(directory,'docs/results/phase2/check');mkdirSync(root,{recursive:true});action(directory,root);}finally{assert(resolve(directory).startsWith(resolve(tmpdir())+sep));assert(directory.split(sep).at(-1).startsWith('citebase-summary-'));rmSync(directory,{recursive:true});}}
const row=(caseId,recall,error,tokens)=>({caseId,mode:'vector',answerable:true,recallAtK:recall,mrr:recall,error,promptTokens:tokens,completionTokens:null,retrievalMs:recall?100:300,totalMs:recall?200:800,category:'fact'});
test('failures stay in metric denominators; missing usage remains unavailable',()=>withFixture((cwd,root)=>{
  writeFileSync(join(root,'state.json'),JSON.stringify({expectedBySplit:{dev:['a:vector','b:vector']}}));
  writeFileSync(join(root,'check-dev-0-hash.json'),JSON.stringify({results:[row('a',1,null,10),row('b',0,'timeout',null)]}));
  const result=spawnSync(process.execPath,[script,'check','dev'],{cwd,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const summary=JSON.parse(readFileSync(join(root,'summary-dev.json'))).summary.vector;
  assert.equal(summary.recallAtK,.5);assert.equal(summary.errorRate,.5);assert.deepEqual(summary.promptTokens,{availableCount:1,unavailableCount:1,observedSum:10});
  assert.equal(summary.completionTokens.observedSum,null);assert.equal(summary.retrievalMs.p50,100);assert.equal(summary.retrievalMs.p95,300);
}));
test('a lost batch cannot produce a complete effectiveness summary',()=>withFixture((cwd,root)=>{
  writeFileSync(join(root,'state.json'),JSON.stringify({expectedBySplit:{dev:['a:vector','b:vector']}}));
  writeFileSync(join(root,'check-dev-0-hash.json'),JSON.stringify({results:[row('a',1,null,10)]}));
  const result=spawnSync(process.execPath,[script,'check','dev'],{cwd,encoding:'utf8'});assert.notEqual(result.status,0);
  const summary=JSON.parse(readFileSync(join(root,'summary-dev.json')));assert.equal(summary.status,'INCOMPLETE');assert.deepEqual(summary.missing,['b:vector']);assert.equal(summary.conclusionAllowed,false);
}));
