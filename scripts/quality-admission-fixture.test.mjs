import test from 'node:test';
import assert from 'node:assert/strict';
import {registration, validateRegistration, arrivalSchedule, openLoop, assertRejected, evaluationBody} from './quality-admission-fixture.mjs';
test('registered small capacity and mock-only constraints reject invalid configurations', () => {
  assert.equal(validateRegistration(registration), registration);
  for (const patch of [{globalTasks: 4}, {userTasks: 0}, {syncConcurrency: 2}, {modelMode: 'real'}, {workerProcesses: 1}, {arrivalRatePerSecond: 21}, {durationMs: -1}, {retryAfterSeconds: 0}])
    assert.throws(() => validateRegistration({...registration, ...patch}));
});
test('fixed arrival schedule covers both APIs independently of completion', async () => {
  const schedule = arrivalSchedule(); assert.equal(schedule.length, 24);
  assert.equal(schedule.at(-1).offsetMs, 2875);
  const dispatched = [], release = [];
  const run = openLoop(registration, slot => {dispatched.push(slot); return new Promise(resolve => release.push(resolve));}, {now: () => 0, sleep: async () => {}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dispatched.length, 24, 'slow first response must not serialize arrivals');
  assert.equal(dispatched.filter(x => x.process === 'A').length, 12);
  release.forEach((resolve, index) => resolve(index)); assert.equal((await run).length, 24);
});
test('rejections need admission code, Retry-After, and bounded response time', () => {
  const r = {status: 429, body: {code: 'ADMISSION_REJECTED'}, retryAfter: '3', elapsedMs: 10};
  assertRejected(r);
  for (const patch of [{status: 500}, {body: {code: 'PROVIDER_RATE_LIMITED'}}, {retryAfter: null}, {elapsedMs: 3000}]) assert.throws(() => assertRejected({...r, ...patch}));
});
test('idempotent replay fixture preserves the exact original request', () => {
  const a = evaluationBody('kb', 'P4_GATE_ADMISSION', 'key');
  assert.deepEqual(a, evaluationBody('kb', 'P4_GATE_ADMISSION', 'key'));
  assert.notDeepEqual(a, evaluationBody('kb', 'P4_GATE_ADMISSION', 'other'));
});
test('every offered arrival uses the preregistered clock offset', async () => {
  const waits=[];
  const results=await openLoop(registration,async slot=>slot,{now:()=>1000,sleep:async ms=>{waits.push(ms);}});
  assert.deepEqual(waits,arrivalSchedule().map(s=>s.offsetMs));
  assert.deepEqual(results.map(r=>r.scheduledMonotonicMs),arrivalSchedule().map(s=>1000+s.offsetMs));
});
