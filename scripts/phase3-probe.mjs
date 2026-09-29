// Development-only capability probe; never included in the fixed test comparison.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { client, read, sha, immutable } from './phase2-client.mjs';
import { collectAgent, deriveRow } from './phase3-experiment.mjs';

const root = process.argv[2];
assert(root, 'Usage: node scripts/phase3-probe.mjs <completed-smoke-root>');
const smoke = read(`${root}/smoke.derived.json`);
assert.equal(smoke.rows.length, 4);
const registration = smoke.registration;
for (const [file, hash] of Object.entries(registration.runtime.fileHashes))
  assert.equal(sha(readFileSync(file)), hash, `Runtime source drift: ${file}`);
const question = read('samples/phase2/dev.json').questions.find(q => q.id === 'harbor-016');
assert.equal(question.split, 'dev');
assert.equal(question.category, '跨文档');
const options = registration.options;
const serverConfig = { ...read(`${root}/server-config.json`), topK: 1 };
const body = {
  kbId: registration.kbId, question: question.question, mode: 'vector', topK: 1,
  retrievalOptions: options, budget: registration.budget,
  idempotencyKey: `probe-${sha(JSON.stringify({root, question, runtime: registration.runtime})).slice(0, 60)}`,
};
const run = await collectAgent(await client(), {
  root: `${root}/development-probe`, id: 'harbor-016-top1',
  spec: { body, snapshot: registration.snapshot, modelConfig: registration.modelConfig,
    baselineConfig: { ...registration.baselineConfig, topK: 1 }, serverConfig,
    runtime: registration.runtime, datasetHash: registration.devHash },
});
immutable(`${root}/development-probe/summary.json`, {
  purpose: 'Development-only topK1 cross-document probe of supplemental evidence tools; not a quality estimate, not included in test metrics.',
  question, registration, row: deriveRow(run, question),
  actions: run.steps.map(s => ({kind: s.kind, action: s.action, status: s.status, output: s.output})),
  rawFile: `${root}/development-probe/harbor-016-top1.raw.json`,
});
console.log(`Development probe ${run.id}: ${run.status}, ${run.errorCode ?? 'no execution error'}`);
