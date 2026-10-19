import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeLoad,assertWithdrawnState} from './quality-operations-scenarios.mjs';
test('concurrent completion order preserves earliest submission and latest finish',()=>{
 const result=summarizeLoad([
  {startedAt:'2026-10-01T00:00:02Z',elapsedMs:1000,success:true},
  {startedAt:'2026-10-01T00:00:00Z',elapsedMs:6000,success:false},
  {startedAt:'2026-10-01T00:00:04Z',elapsedMs:5000,success:true},
 ]);
 assert.equal(result.actualWindowSeconds,9);assert.equal(result.failures,1);
 assert.equal(result.errorRate,1/3);assert.equal(result.completedPerSecond,1/3);
 assert.equal(result.successfulPerSecond,2/9);assert.equal(result.latencyMs.p50,5000);
 assert.equal(result.latencyMs.p95,6000);assert.equal(result.latencyMs.mean,4000);
});
test('no samples and malformed timing cannot become successful NaN summaries',()=>{
 assert.throws(()=>summarizeLoad([]));
 assert.throws(()=>summarizeLoad([{startedAt:'bad',elapsedMs:1,success:true}]));
 assert.throws(()=>summarizeLoad([{startedAt:'2026-10-01',elapsedMs:-1,success:true}]));
});

test('withdrawal proof rejects residual tasks and saved content',()=>{
 const gone={task:[],items:[],calls:[],chunks:[],stageParts:0};
 assert.doesNotThrow(()=>assertWithdrawnState(gone));
 for(const key of ['task','items','calls','chunks'])assert.throws(()=>assertWithdrawnState({...gone,[key]:[{id:'residual'}]}));
 assert.throws(()=>assertWithdrawnState({...gone,stageParts:1}));
 assert.throws(()=>assertWithdrawnState({}));
});
