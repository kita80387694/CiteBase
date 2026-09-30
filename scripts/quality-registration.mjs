import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const hash = x => createHash('sha256').update(x).digest('hex');
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;

export function selectReviewCases(dataset) {
  const selected = [];
  for (const split of ['dev', 'validation']) {
    const refusals = dataset.questions.filter(q => q.split === split && !q.answerable)
      .sort((a,b) => compare(hash(a.id),hash(b.id))).slice(0,4);
    assert.equal(refusals.length, 4, `Insufficient ${split} unanswerable cases`);
    const groups = new Map();
    for (const q of dataset.questions.filter(q => q.split === split && q.answerable)) {
      const key = `${q.topic}:${q.category}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(q);
    }
    const queues = [...groups.entries()].sort(([a], [b]) => compare(a,b))
      .map(([, rows]) => rows.sort((a, b) => compare(hash(a.id),hash(b.id))));
    const batch = [...refusals];
    while (batch.length < 20) {
      const before = batch.length;
      for (const rows of queues) if (rows.length && batch.length < 20) batch.push(rows.shift());
      assert(batch.length > before, `Insufficient ${split} cases`);
    }
    // The two-case smoke exercises one answerable and one refusal; both remain in the full cohort.
    selected.push(batch[4], batch[0], ...batch.filter((_, i) => i !== 4 && i !== 0));
  }
  assert.equal(new Set(selected.map(q => q.id)).size, 40);
  assert(selected.every(q => q.split !== 'test'));
  return selected;
}

export function registration(dataset, datasetBytes, runtime) {
  assert(runtime.commit && runtime.sourceSha256 && runtime.imageId, 'Frozen deployed runtime required');
  const selected = selectReviewCases(dataset);
  return {
    version: 'quality-phase3-baseline-v1', datasetVersion: dataset.version,
    datasetSha256: hash(datasetBytes), runtime, caseIds: selected.map(q => q.id),
    selection: '20 dev + 20 validation, each 4 unanswerable + 16 answerable; answerable round robin topic/category, SHA256(id) order; no outcomes consulted',
    testSetAccess: 'No test answers generated or used for parameter selection',
    retrieval: { topK: 5, mode: 'vector', options: { candidateK: 20, keywordWeight: 1, rerank: false, citationStyle: 'uuid' } },
    chunkProfile: { strategy: 'structure-v1', size: 900, overlap: 200 },
    comparisons: ['base-rag', 'original-agent'],
    review: { pairedQuestions: 40, primaryAnswers: 80, secondReviewerMinimum: 16, humanScores: null },
    budget: { concurrency: 1, evaluationRows: 80, agentRuns: 40, agentMaxExternalCallsPerRun: 10,
      note: 'Existing evaluation API produces vector and hybrid rows. Only preregistered vector forms primary pair; all hybrid raw outputs retained as auxiliary, not selected by outcomes. Indexing and finite server retries separately audited.' },
    smoke: { questions: 2, retainedAndReused: true },
    stopConditions: ['provider authentication/balance failure', 'runtime/model/data drift', 'unexpected transport outcome: reconcile original journal', 'smoke pipeline or citation-source invariant failure'],
    qualityMetrics: ['human correctness', 'completeness', 'citation support', 'unsupported content', 'refusal appropriateness', 'execution failure rate'],
    aggregation: 'All intended pairs retained including failed runs; unreviewed/null excluded only from human-score denominator and coverage disclosed. Latency and usage report all attempts and unknown counts.',
    defaultDecision: 'No default changes before completed human assessment; baseline is not an optimization result',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [datasetPath, runtimePath, output] = process.argv.slice(2);
  assert(datasetPath && runtimePath && output, 'Usage: quality-registration.mjs dataset.json runtime.json output.json');
  const bytes = readFileSync(datasetPath), result = registration(JSON.parse(bytes), bytes, JSON.parse(readFileSync(runtimePath)));
  assert(!existsSync(output), 'Registration is immutable; reuse existing registration');
  mkdirSync(new URL('.', pathToFileURL(output)), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(`Registered ${result.caseIds.length} paired questions; no model calls made`);
}
