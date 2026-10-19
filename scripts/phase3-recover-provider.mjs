import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { client, read, sha, immutable } from './phase2-client.mjs';
import { collectAgent, deriveRow } from './phase3-experiment.mjs';

// This is a separately registered recovery experiment, never a rewrite of the original run.
const parent = process.argv[2] || 'docs/results/phase3-v2';
const root = `${parent}/provider-recovery`;
const original = read(`${parent}/registration.json`);
const blocker = read(`${parent}/external-blocker.json`);
const restored = read(`${parent}/provider-restored.json`);
assert.equal(restored.httpStatus, 200, 'User-restored provider verification required');
const actualImage = execFileSync('docker', ['inspect', 'citebase-phase2-backend-1', '--format', '{{.Image}}'], { encoding: 'utf8' }).trim();
assert.equal(actualImage, original.runtime.imageId, 'Recovery must use the retained frozen image, not phase4 code');
for (const [path, digest] of Object.entries(original.runtime.fileHashes)) {
  const bytes = execFileSync('git', ['show', `${original.runtime.commit}:${path}`]);
  assert.equal(sha(bytes), digest, `Frozen committed source differs: ${path}`);
}
const dataset = read('samples/phase2/test.json');
const tasks = blocker.providerErrorRows.map(entry => {
  const run = read(entry.file);
  assert.equal(run.errorCode, 'PROVIDER_ERROR');
  const question = dataset.questions.find(q => q.question === run.request.question);
  assert(question, 'Original question missing from fixed test set');
  return { originalRunId: run.id, originalFile: entry.file, originalSha256: sha(readFileSync(entry.file)),
    question, mode: run.request.mode, originalBody: run.request };
});
assert.equal(tasks.length, 46, 'Expected only the registered supplier failures');
assert.equal(new Set(tasks.map(t => `${t.question.id}:${t.mode}`)).size, tasks.length);
mkdirSync(root, { recursive: true });
const registrationFile = `${root}/registration.json`;
const registration = {
  kind: 'separate-provider-restoration-recovery', frozenOriginal: original, runtime: original.runtime,
  actualImage, tasks, providerRestoredDiagnostic: `${parent}/provider-restored.json`,
  frozenAt: existsSync(registrationFile) ? read(registrationFile).frozenAt : new Date().toISOString(),
  collectorSha256: sha(readFileSync(new URL(import.meta.url))),
  policy: 'Recover supplier-error rows only; original104 remain intact. Never replace budget/no-progress failures. Same model, source, policy and retrieval settings; new run IDs and keys. Partial original calls may have billed usage and are not refunded or omitted.',
};
immutable(registrationFile, registration);
const api = await client();
const rows = new Array(tasks.length); let next = 0;
await Promise.all(Array.from({ length: 2 }, async () => {
  while (next < tasks.length) {
    const index = next++, task = tasks[index], id = `${task.question.id}-${task.mode}`;
    const body = { ...task.originalBody, idempotencyKey: `p3restore-${sha(JSON.stringify({ root, run: task.originalRunId, registration: registration.frozenAt })).slice(0, 60)}` };
    const run = await collectAgent(api, { root: `${root}/runs`, id, spec: {
      body, snapshot: original.snapshot, modelConfig: original.modelConfig,
      baselineConfig: original.baselineConfig, serverConfig: original.serverConfig,
      runtime: original.runtime, datasetHash: original.testHash,
      recoveryOriginal: { runId: task.originalRunId, file: task.originalFile, sha256: task.originalSha256 },
    } });
    rows[index] = { ...deriveRow(run, task.question), recoveryOriginalRunId: task.originalRunId };
    console.log(`${id}: ${run.status} ${run.errorCode || ''}`);
  }
}));
immutable(`${root}/derived.json`, { registration, rows, humanReviewed: false });
