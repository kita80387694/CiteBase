import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFaultGate } from './phase4-fault-gate.mjs';
const post = (path, body) => fetch(`http://127.0.0.1:39555${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('test-only gate holds exactly the selected call and preserves receipt history', async () => {
  const gate = await startFaultGate();
  try {
    gate.setRules([{ operation: 'generation', process: 'A', marker: 'P4_GATE_UNIT', skip: 1, remaining: 1, action: 'hold' }]);
    const receipt = { operation: 'generation', process: 'A', marker: 'P4_GATE_UNIT', inputHash: 'a'.repeat(64), taskId: null, workerId: null, generation: null, pid: 1 };
    assert.equal((await post('/gate', receipt)).status, 200);
    const pending = post('/gate', receipt);
    for (let i = 0; i < 50 && gate.state().waiting.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(gate.state().waiting.length, 1);
    assert.equal((await post('/gate', { ...receipt, process: 'B' })).status, 200);
    gate.release(gate.state().waiting);
    assert.equal((await pending).status, 200);
    assert.equal(gate.state().calls.length, 3);
    assert.equal(gate.state().calls[1].ruleId, 'rule-0');
    gate.setRules([{ operation: 'embedding', action: 'fail', status: 429 }]);
    assert.equal((await post('/gate', { ...receipt, operation: 'embedding' })).status, 429);
    assert.equal(gate.state().calls[3].status, 429);
    assert.ok(gate.state().calls.every((c) => !('text' in c) && !('question' in c)));
    assert.equal((await post('/gate', { ...receipt, operation: 'shell' })).status, 400);
  } finally { await gate.close(); }
});
