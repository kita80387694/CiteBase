import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const base = process.env.CITEBASE_URL || 'http://localhost:8080';
async function request(path, token, body) {
  const response = await fetch(base + path, {method: body ? 'POST' : 'GET', headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
  assert.equal(response.status, 200);
  return response.json();
}
const {token} = await request('/api/auth/login', null, {username: 'alice', password: 'Alice-demo-123!'});
const me = await request('/api/me', token);
assert.equal(me.mode, 'real', 'This regression requires real models');
const kb = (await request('/api/knowledge-bases', token)).find(k => k.name === 'CiteBase 自建手册 v1');
assert(kb, 'Run seed-demo first');
const answer = await request('/api/questions', token, {kbId: kb.id, question: 'Willow 无证据时应该怎样回答？', mode: 'vector', topK: 5});
const result = {verifiedAt: new Date().toISOString(), modelMode: me.mode, description: 'A cited explanation of refusal policy must not itself be treated as refusal', answer};
writeFileSync('docs/results/real-abstention-quote-regression.json', JSON.stringify(result, null, 2) + '\n');
assert.equal(answer.error, null);
assert.equal(answer.abstained, false);
assert.equal(answer.citationValid, true);
assert(answer.citations.length > 0);
assert(answer.answer.includes('无法根据当前资料回答'));
console.log('PASSED: real cited refusal-policy explanation, original evaluation unchanged');
