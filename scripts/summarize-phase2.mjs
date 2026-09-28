import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const label = process.argv[2], split = process.argv[3] || 'dev';
assert(label && /^[a-z0-9_-]+$/i.test(label));
assert(['dev', 'test'].includes(split), 'Explicit dev/test scope is required');
const root = `docs/results/phase2/${label}`;
const files = readdirSync(root).filter(f => f.startsWith(`${label}-${split}-`) && f.endsWith('.json')).sort();
assert(files.length, 'No raw results in requested split');
const rows = files.flatMap(f => JSON.parse(readFileSync(`${root}/${f}`)).results || []);
const keys = rows.map(r => `${r.caseId}:${r.mode}`);
assert.equal(new Set(keys).size, keys.length, 'Duplicate case/config rows: do not silently overweight repeated runs');
const state = JSON.parse(readFileSync(`${root}/state.json`));
const expected = state.expectedBySplit?.[split];
assert(expected?.length, 'Missing frozen expected case/config inventory');
const missing = expected.filter(key => !keys.includes(key)), unexpected = keys.filter(key => !expected.includes(key));
if (missing.length || unexpected.length) {
  writeFileSync(`${root}/summary-${split}.json`, JSON.stringify({status:'INCOMPLETE',label,split,expectedCount:expected.length,returnedCount:keys.length,missing,unexpected,conclusionAllowed:false},null,2)+'\n');
  throw Error('Incomplete or unexpected results; summary cannot be used for an effectiveness conclusion');
}
function average(values) { return values.length ? values.reduce((a,b) => a + b, 0) / values.length : null; }
function percentile(values, p) { const sorted = [...values].sort((a,b) => a-b); return sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null; }
function metrics(selected) {
  const answerable = selected.filter(r => r.answerable), unanswerable = selected.filter(r => !r.answerable);
  const result = { count: selected.length, answerableCount: answerable.length, unanswerableCount: unanswerable.length,
    recallAtK: average(answerable.map(r => r.recallAtK ?? 0)), mrr: average(answerable.map(r => r.mrr ?? 0)),
    errorCount: selected.filter(r => r.error).length, errorRate: selected.length ? selected.filter(r => r.error).length/selected.length : null,
    citationValidCount: selected.filter(r => r.citationValid).length,
    allEvidenceHitCount: answerable.filter(r => r.allEvidenceHit).length,
    referenceAnswerMatchCount: answerable.filter(r => r.referenceAnswerMatch).length,
    abstentionCorrectCount: unanswerable.filter(r => r.abstained === true && r.citationValid === true && r.error == null).length,
    defensiveAbstentionErrorCount: unanswerable.filter(r => r.abstained && r.error).length,
    humanCorrectness: null, note: 'No human review inferred from citations or reference containment.' };
  for (const field of ['retrievalMs', 'totalMs']) {
    const values = selected.map(r => r[field]).filter(v => typeof v === 'number');
    result[field] = { count: values.length, mean: average(values), p50: percentile(values, .5), p95: percentile(values, .95) };
  }
  for (const field of ['promptTokens', 'completionTokens']) {
    const values = selected.map(r => r[field]).filter(v => typeof v === 'number');
    result[field] = { availableCount: values.length, unavailableCount: selected.length-values.length, observedSum: values.length ? values.reduce((a,b) => a+b,0) : null };
  }
  return result;
}
const modes = [...new Set(rows.map(r => r.mode))];
const report = { status:'COMPLETE', metricDefinitionVersion:'phase2-derived-v2', generatedAt: new Date().toISOString(), label, split, rawFiles: files,
  definition: 'Per-question macro Recall/MRR on answerable rows (failure/missing=0); latency on all returned numeric rows; nearest-rank percentiles; missing provider usage=null, observed sum is not total when coverage incomplete. Error-induced abstention remains in the denominator but is not a correct refusal (raw legacy abstentionCorrect retained untouched).',
  summary: Object.fromEntries(modes.map(mode => [mode, metrics(rows.filter(r => r.mode === mode))])),
  byCategory: Object.fromEntries([...new Set(rows.map(r => r.category || 'unspecified'))].map(category => [category, Object.fromEntries(modes.map(mode => [mode, metrics(rows.filter(r => r.mode === mode && (r.category || 'unspecified') === category))]))])),
  casesNeedingReview: rows.filter(r => r.error || (r.answerable && (!r.allEvidenceHit || !r.referenceAnswerMatch)) || (!r.answerable && !r.abstentionCorrect)).map(r => ({caseId:r.caseId,mode:r.mode,error:r.error,recallAtK:r.recallAtK,mrr:r.mrr,referenceAnswerMatch:r.referenceAnswerMatch,abstentionCorrect:r.abstentionCorrect})) };
writeFileSync(`${root}/summary-${split}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary, null, 2));
