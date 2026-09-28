import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const base = process.env.CITEBASE_URL || 'http://localhost:28080';
const label = option('--label', 'baseline');
assert(/^[a-z0-9_-]+$/i.test(label), 'Use a filesystem-safe experiment label');
const root = `docs/results/phase2/${label}`;
mkdirSync(root, { recursive: true });
const statePath = `${root}/state.json`;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath)) : { label, createdAt: new Date().toISOString(), batches: [] };
function save() { writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n'); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function provenance() {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split(/\r?\n/)
    .filter(p => /^(backend\/|frontend\/|scripts\/|samples\/phase2\/|compose)/.test(p) && !p.endsWith('.tsbuildinfo')).sort();
  const hashes = Object.fromEntries(files.map(p => [p, sha(readFileSync(p))]));
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), branch: execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim(), workingTree: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(), sourceSha256: sha(JSON.stringify(hashes)), fileHashes: hashes };
}
let token;
async function request(path, body, method = body ? 'POST' : 'GET') {
  const url = new URL(base + path);
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method, timeout: 3600000, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk);
      res.on('end', () => { try { if (res.statusCode < 200 || res.statusCode >= 300) throw Error(`${method} ${path}: HTTP ${res.statusCode} ${text.slice(0, 300)}`); resolve(text ? JSON.parse(text) : null); } catch (error) { reject(error); } });
    });
    req.on('timeout', () => req.destroy(new Error('Deadline reached; inspect persisted run, do not automatically resubmit')));
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
try {
  ({ token } = await request('/api/auth/login', { username: process.env.DEMO_USER || 'alice', password: process.env.DEMO_PASSWORD || 'Alice-demo-123!' }));
  const me = await request('/api/me');
  assert.equal(me.mode, 'real', 'Real experiment runner refuses mock mode');
  state.modelMode = me.mode;
  const kbName = `Phase2 ${label}`;
  const bases = await request('/api/knowledge-bases');
  const kb = bases.find(x => x.id === state.kbId) || bases.find(x => x.name === kbName) || await request('/api/knowledge-bases', { name: kbName });
  state.kbId = kb.id; save();
  if (args.includes('--seed')) {
    const directory = option('--documents', 'samples/phase2/documents');
    for (const file of readdirSync(directory).filter(p => /\.(md|txt|pdf)$/i.test(p)).sort()) {
      const form = new FormData(); form.append('file', new Blob([readFileSync(`${directory}/${file}`)]), file);
      const response = await fetch(`${base}/api/knowledge-bases/${kb.id}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      assert.equal(response.status, 200, `Upload ${file}: ${response.status}`);
    }
    for (let i = 0; i < 3600; i++) {
      const docs = await request(`/api/knowledge-bases/${kb.id}/documents`);
      const failed = docs.filter(d => d.status === 'FAILED');
      if (failed.length) throw Error(`Index failed: ${JSON.stringify(failed)}`);
      if (docs.length && docs.every(d => d.status === 'SUCCESS')) { state.documents = docs; save(); console.log(`Indexed ${docs.length} documents in isolated KB ${kb.id}`); break; }
      if (i === 3599) throw Error('Index deadline');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  if (args.includes('--run')) {
    const runtimeManifest = option('--runtime-manifest', '.tools/phase2-runtime.json');
    assert(existsSync(runtimeManifest), 'Capture the deployed commit/source hash and Docker image ID before running experiments');
    const runtime = JSON.parse(readFileSync(runtimeManifest));
    assert(runtime.commit && runtime.sourceSha256 && runtime.imageId, 'Incomplete deployed runtime provenance');
    if (state.runtime) assert.deepEqual(state.runtime, runtime, 'Runtime changed: use a new experiment label');
    state.runtime = runtime;
    const datasetPath = option('--dataset', 'samples/phase2/evaluation.json');
    const bytes = readFileSync(datasetPath), dataset = JSON.parse(bytes);
    const split = option('--split', 'dev');
    const selected = dataset.questions.filter(q => split === 'all' || q.split === split);
    assert(selected.length, `No questions for split ${split}`);
    const batchSize = Number(option('--batch-size', '8'));
    assert(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 50);
    const inputHash = sha(bytes);
    if (state.datasetSha256) assert.equal(state.datasetSha256, inputHash, 'Dataset changed: choose a new experiment label');
    state.datasetSha256 = inputHash;
    state.expectedBySplit ||= {};
    const expectedKeys = selected.flatMap(q => ['vector', 'hybrid'].map(mode => `${q.id}:${mode}`)).sort();
    if (state.expectedBySplit[split]) assert.deepEqual(state.expectedBySplit[split], expectedKeys);
    state.expectedBySplit[split] = expectedKeys;
    if (!state.provenance) state.provenance = provenance();
    save();
    for (let offset = 0; offset < selected.length; offset += batchSize) {
      const name = `${label}-${split}-${offset}-${inputHash.slice(0, 8)}`;
      let batch = state.batches.find(x => x.name === name);
      if (batch) assert.deepEqual(batch.caseIds, selected.slice(offset, offset + batchSize).map(q => q.id), 'Batch boundaries changed: use original batch size');
      if (batch?.status === 'COMPLETED' || batch?.status === 'COMPLETED_WITH_ERRORS') continue;
      if (!batch) { batch = { name, status: 'INTENT_SAVED', caseIds: selected.slice(offset, offset + batchSize).map(q => q.id) }; state.batches.push(batch); save(); }
      // Reconcile on the server before any POST. A lost response must never cause a duplicate paid run.
      const runs = await request('/api/evaluations');
      const existing = runs.find(r => r.name === name);
      let run;
      if (existing) run = await request(`/api/evaluations/${existing.id}/export`);
      else {
        if (batch.status === 'SUBMITTING') throw Error(`Uncertain submission ${name}; inspect server before explicitly resolving state`);
        batch.status = 'SUBMITTING'; save();
        const subset = { ...dataset, questions: selected.slice(offset, offset + batchSize) };
        run = await request('/api/evaluations', { kbId: kb.id, name, dataset: subset, topK: 5 });
      }
      batch.id = run.id; batch.status = run.status; save();
      while (['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(run.status)) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        run = await request(`/api/evaluations/${run.id}/export`);
        batch.status = run.status; save();
      }
      const output = `${root}/${name}.json`;
      if (existsSync(output)) assert.deepEqual(JSON.parse(readFileSync(output)), run, 'Refusing to overwrite differing raw result');
      else writeFileSync(output, JSON.stringify(run, null, 2) + '\n');
      batch.file = output; batch.status = run.status; batch.completedAt = new Date().toISOString(); save();
      console.log(`${name}: ${run.status}, ${run.results?.length ?? 0} rows saved`);
      if (!['COMPLETED', 'COMPLETED_WITH_ERRORS', 'SUCCEEDED'].includes(run.status)) throw Error(`Run terminated ${run.status}; raw results retained`);
    }
  }
} catch (error) { console.error(String(error)); process.exitCode = 1; }
