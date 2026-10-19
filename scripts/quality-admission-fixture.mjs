import assert from 'node:assert/strict';

// Registered before the run. No adaptive load, automatic retry, or real provider.
export const registration = Object.freeze({
  version: 'admission-open-loop-v1', modelMode: 'mock/fault-test-only',
  globalTasks: 3, userTasks: 2, syncConcurrency: 1, retryAfterSeconds: 3,
  arrivalRatePerSecond: 8, durationMs: 3000, requestTimeoutMs: 30000,
  fastRejectMs: 2500, workerProcesses: 2,
});
export function validateRegistration(c) {
  for (const key of Object.keys(registration)) assert.ok(key in c, `Missing ${key}`);
  assert.equal(c.modelMode, 'mock/fault-test-only');
  assert.equal(c.workerProcesses, 2);
  // This fixture exercises per-user (2), then global (3), using two users.
  assert.equal(c.globalTasks, 3); assert.equal(c.userTasks, 2); assert.equal(c.syncConcurrency, 1);
  for (const k of ['retryAfterSeconds','arrivalRatePerSecond','durationMs','requestTimeoutMs','fastRejectMs'])
    assert.ok(Number.isInteger(c[k]) && c[k] > 0, `Invalid ${k}`);
  assert.ok(c.retryAfterSeconds <= 300 && c.arrivalRatePerSecond <= 20 && c.durationMs <= 10000);
  assert.ok(c.requestTimeoutMs > c.durationMs && c.fastRejectMs < c.requestTimeoutMs);
  return c;
}
export function assertRejected(r, c = registration) {
  assert.equal(r.status, 429); assert.equal(r.body.code, 'ADMISSION_REJECTED');
  assert.equal(r.retryAfter, String(c.retryAfterSeconds));
  assert.ok(r.elapsedMs < c.fastRejectMs, `Slow rejection: ${r.elapsedMs}ms`);
}
export function arrivalSchedule(c = registration) {
  validateRegistration(c);
  return Array.from({length: Math.ceil(c.durationMs * c.arrivalRatePerSecond / 1000)},
    (_, index) => ({index, offsetMs: index * 1000 / c.arrivalRatePerSecond, process: index % 2 ? 'B' : 'A'}));
}
// Every arrival is scheduled independently of response completion (including slow errors).
export async function openLoop(c, dispatch, {now = () => performance.now(), sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  const start = now();
  return Promise.all(arrivalSchedule(c).map(async slot => {
    await sleep(Math.max(0, start + slot.offsetMs - now()));
    return dispatch({...slot, scheduledMonotonicMs: start + slot.offsetMs, dispatchLagMs: now() - start - slot.offsetMs});
  }));
}
export function evaluationBody(kbId, marker, key) {
  return {kbId, name: marker, idempotencyKey: key, topK: 3,
    retrievalOptions: {candidateK: 5, rerank: false, citationStyle: 'uuid'},
    dataset: {version: 'admission-fixture-v1', questions: [{id: marker,
      question: `恢复规则是什么？ ${marker}`, answerable: true, expectedAnswer: '保留检查点',
      evidence: [{documentName: 'admission.md', page: 1, paragraph: 1, quote: '恢复规则是保留检查点。', groupId: 'recovery'}]}]}};
}
