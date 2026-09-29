import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.CITEBASE_URL || 'http://localhost:28080';
const runId = process.argv[2], output = process.argv[3];
assert(runId && output, 'Usage: node scripts/verify-agent-access.mjs <existing-owned-run> <new-output-file>');
async function request(path, token, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : {'Content-Type':'application/json'}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
const login = async (username, password) => {
  const result = await request('/api/auth/login', null, { username, password });
  assert.equal(result.status, 200); return result.data.token;
};
const alice = await login('alice', process.env.DEMO_PASSWORD || 'Alice-demo-123!');
const bob = await login('bob', process.env.DEMO_BOB_PASSWORD || 'Bob-demo-123!');
const before = await request(`/api/agent-runs/${runId}`, alice);
assert.equal(before.status, 200); assert.equal(before.data.status, 'COMPLETED');
assert.equal(before.data.config.modelMode, 'real');
const kbId = before.data.kbId;
const cases = [
  ['foreign run read', `/api/agent-runs/${runId}`, bob, undefined, 404],
  ['foreign run export', `/api/agent-runs/${runId}/export`, bob, undefined, 404],
  ['foreign KB list', `/api/agent-runs?kbId=${kbId}`, bob, undefined, 404],
  ['foreign cancel', `/api/agent-runs/${runId}/cancel`, bob, {}, 404],
  ['foreign execute', `/api/agent-runs/${runId}/execute`, bob, {}, 404],
  ['foreign create', '/api/agent-runs', bob, {kbId,question:'Unauthorized probe',idempotencyKey:`acl-${runId}`}, 404],
  ['forged owner rejected', '/api/agent-runs', alice, {kbId,question:'Owner parameter probe',idempotencyKey:`owner-${runId}`,userId:'bob'}, 400],
  ['budget escalation rejected', '/api/agent-runs', alice, {kbId,question:'Budget parameter probe',idempotencyKey:`budget-${runId}`,budget:{maxTools:999}}, 400],
];
const checks = [];
for (const [name,path,token,body,expected] of cases) {
  const response = await request(path,token,body);
  assert.equal(response.status, expected, name);
  checks.push({name, expected, actual:response.status, passed:true});
}
const after = await request(`/api/agent-runs/${runId}`, alice);
assert.deepEqual(after.data,before.data,'Denied foreign mutation must not alter original run');
checks.push({name:'Original owned result remains unchanged',passed:true});
mkdirSync(output.slice(0, Math.max(output.lastIndexOf('/'),output.lastIndexOf('\\'))),{recursive:true});
writeFileSync(output,JSON.stringify({at:new Date().toISOString(),kind:'real-backend-authorization',runId,kbId,modelCallsTriggered:0,checks},null,2)+'\n',{flag:'wx'});
console.log(`${checks.length} real-backend Agent authorization checks passed; no model calls triggered`);
