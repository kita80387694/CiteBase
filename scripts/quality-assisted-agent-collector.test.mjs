import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRun} from './quality-assisted-agent-collector.mjs';

function fixture(strategy='grounded-answer-v1') {
  const body={kbId:'kb',question:'q',strategy,mode:'vector',topK:5,retrievalOptions:{},budget:{maxExternalCalls:10},idempotencyKey:'fixed'};
  const snapshot=[{id:'d',version_id:'v'}];
  const spec={body,snapshot,modelConfig:{chatModel:'chat',embeddingModel:'embed'}};
  const config={modelMode:'real',chatModel:'chat',embeddingModel:'embed',agentStrategy:strategy};
  if(strategy.includes('grounded'))config.generationPolicy='grounded-answer-v1';
  return {spec,run:{kbId:'kb',request:body,snapshot,config,result:{strategy}}};
}
test('new strategy cannot silently run old generation policy',()=>{
  const {run,spec}=fixture();verifyRun(run,spec);delete run.config.generationPolicy;
  assert.throws(()=>verifyRun(run,spec),/Generation policy drift/);
});
test('original control rejects an accidentally enabled new generation prompt',()=>{
  const {run,spec}=fixture('original');verifyRun(run,spec);run.config.generationPolicy='grounded-answer-v1';
  assert.throws(()=>verifyRun(run,spec),/Generation policy drift/);
});
test('model and immutable evidence version drift are rejected',()=>{
  const a=fixture();a.run.config.chatModel='changed';assert.throws(()=>verifyRun(a.run,a.spec),/Model drift/);
  const b=fixture();b.run.snapshot=[{id:'d',version_id:'other'}];assert.throws(()=>verifyRun(b.run,b.spec),/snapshot/);
});
