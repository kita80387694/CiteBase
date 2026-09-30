import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { client, read, save, immutable, pause, sha, evaluation } from './phase2-client.mjs';
import { collectAgent } from './phase3-experiment.mjs';

const [stage, root, registrationPath] = process.argv.slice(2);
assert(['seed','smoke','collect'].includes(stage) && root && registrationPath,
  'Usage: quality-baseline.mjs seed|smoke|collect result-directory registration.json');
const plan = read(registrationPath), datasetPath = 'samples/phase3-quality/evaluation.json';
assert(plan.runtime.containerName && plan.runtime.containerImageId, 'Capture deployed container identity before registration');
function deploymentGuard() {
  const image = execFileSync('docker', ['inspect', plan.runtime.containerName, '--format', '{{.Image}}'], { encoding: 'utf8' }).trim();
  assert.equal(image, plan.runtime.containerImageId, 'Running backend changed; stop without submitting new work');
  const ports = JSON.parse(execFileSync('docker', ['inspect', plan.runtime.containerName, '--format', '{{json .NetworkSettings.Ports}}'], { encoding: 'utf8' }));
  const base = new URL(process.env.CITEBASE_URL || 'http://localhost:28080');
  assert(['localhost','127.0.0.1'].includes(base.hostname) && base.protocol === 'http:', 'Collector only verifies local published backend');
  assert((ports['8080/tcp'] || []).some(p => p.HostPort === base.port), 'API URL does not match frozen backend published port');
}
deploymentGuard();
const bytes = readFileSync(datasetPath), dataset = JSON.parse(bytes);
assert.equal(sha(bytes), plan.datasetSha256, 'Frozen dataset changed');
assert.equal(plan.caseIds.length, 40);
const selected = plan.caseIds.map(id => {
  const q = dataset.questions.find(q => q.id === id);
  assert(q && ['dev','validation'].includes(q.split), 'Independent test must remain unused'); return q;
});
mkdirSync(root, { recursive: true });
immutable(`${root}/registration.json`, plan);
const journal = `${root}/state.json`;
const state = existsSync(journal) ? read(journal) : { registrationSha256: sha(JSON.stringify(plan)), createdAt: new Date().toISOString() };
assert.equal(state.registrationSha256, sha(JSON.stringify(plan)));
const persist = () => save(journal, state);
const api = await client();
const prefix = `Quality3-${sha(JSON.stringify(plan)).slice(0,12)}`;
function checkProvider(errors) {
  assert(!errors.filter(Boolean).some(e => /PROVIDER|UNAUTHORIZED|BALANCE|SOURCE_CHANGED/.test(e)),
    'Provider/source failure preserved; investigate before continuing');
}
if (!state.kbId) {
  const existing = (await api.request('/api/knowledge-bases')).filter(k => k.name === prefix);
  assert(existing.length <= 1, 'Ambiguous KB creation must be reconciled');
  state.kbId = (existing[0] || await api.request('/api/knowledge-bases', { name: prefix })).id; persist();
}
if (stage === 'seed') {
  const manifest = read('samples/phase3-quality/manifest.json');
  const allowed = manifest.documents.filter(d => ['dev','validation'].includes(d.split));
  const initial = await api.request(`/api/knowledge-bases/${state.kbId}/documents`);
  assert(initial.every(d => allowed.some(a => a.documentName === d.name)), 'Unregistered document in isolated KB');
  for (const doc of allowed) {
    const path = `samples/phase3-quality/documents/${doc.documentName}`;
    assert.equal(sha(readFileSync(path)), doc.sourceHash);
    await api.upload(state.kbId, path, plan.chunkProfile);
  }
  let complete = false;
  for (let i=0;i<600;i++) {
    const docs = await api.request(`/api/knowledge-bases/${state.kbId}/documents`);
    assert(!docs.some(d => d.status === 'FAILED'), 'Index failure: inspect task, no blind retry');
    if (docs.length === allowed.length && docs.every(d => d.status === 'SUCCESS')) {
      state.documents = docs; state.indexed = true; persist(); complete = true; break;
    }
    await pause(1000);
  }
  assert(complete, 'Index still pending; resume same journal');
  console.log('Development/validation corpus indexed; independent test documents not uploaded');
} else {
  assert(state.indexed, 'Run seed first');
  if (stage === 'collect') assert(state.smokeCompleted, 'Review smoke before full collection');
  const count = stage === 'smoke' ? 2 : selected.length;
  for (let index=0; index<count; index++) {
    deploymentGuard();
    const q = selected[index], id = `q${String(index).padStart(3,'0')}`;
    const rag = await evaluation(api, { root: `${root}/rag`, id: `${prefix}-${id}`,
      kbId: state.kbId, dataset: { version: dataset.version, questions: [q] },
      options: plan.retrieval.options, runtime: plan.runtime, topK: plan.retrieval.topK });
    const snapshot = rag.config.dataVersions;
    const frozenConfig = { ...rag.config }; delete frozenConfig.dataset;
    immutable(`${root}/rag-config.json`, frozenConfig);
    checkProvider(rag.results.map(r => r.error));
    for (const row of rag.results.filter(r => !r.error)) {
      assert(row.citationValid, 'Successful row failed citation validation');
      for (const citation of row.citations || []) {
        const evidenceId = typeof citation === 'string' ? citation : citation.id;
        await api.request(`/api/evaluations/${rag.id}/citations/${evidenceId}`);
      }
    }
    const spec = { body: { kbId: state.kbId, question: q.question, mode: 'vector', topK: plan.retrieval.topK,
      retrievalOptions: plan.retrieval.options,
      budget: { maxPlannerSteps:4,maxTools:4,maxSearch:2,maxEvidence:12,maxEvidenceChars:20000,deadlineSeconds:120,maxPlannerOutputTokens:256,maxFinalOutputTokens:1024,maxExternalCalls:10 },
      idempotencyKey: `${prefix}-${id}-original-agent` }, snapshot,
      modelConfig: { chatModel: rag.config.chatModel, embeddingModel: rag.config.embeddingModel } };
    const agent = await collectAgent(api, { root: `${root}/agent`, id, spec, configFile: `${root}/agent-config.json` });
    if (agent.status === 'COMPLETED') {
      assert(agent.result?.citationValid, 'Completed Agent has invalid citations');
      for (const c of agent.result.citations || []) await api.request(`/api/citations/${typeof c === 'string' ? c : c.id}`);
    }
    immutable(`${root}/${id}-pair.json`, { caseId: q.id,
      rag: { kind:'EVALUATION',runId:rag.id,caseId:q.id,mode:'vector' },
      agent: { kind:'AGENT',runId:agent.id }, humanReview: null });
    // Preserve policy failures as observations; stop on infrastructure/provider failures, never discard them.
    checkProvider([agent.errorCode]);
    console.log(`${index+1}/${count} paired source captured (Agent ${agent.status}); no human scores submitted`);
  }
  if (stage === 'smoke') state.smokeCompleted = true;
  if (stage === 'collect') state.collectionCompleted = true;
  persist();
}
