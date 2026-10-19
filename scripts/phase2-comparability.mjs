import assert from 'node:assert/strict';

/** Paired source/rank guard, not an answer-quality score. Never changes raw rows. */
export function assertCompactComparable(control, compact) {
  const withoutStyle = value => {
    const {citationStyle, ...rest} = value || {};
    return rest;
  };
  assert.deepEqual(withoutStyle(control.config?.retrievalOptions), withoutStyle(compact.config?.retrievalOptions), 'Compact comparison changed retrieval options');
  assert.equal(control.config?.retrievalOptions?.citationStyle, 'uuid', 'Control must use uuid citations');
  assert.equal(compact.config?.retrievalOptions?.citationStyle, 'compact', 'Variant must use compact citations');
  for (const field of ['chatModel', 'embeddingModel', 'modelMode', 'temperature', 'topK', 'provider', 'reranker', 'dataVersions', 'dataset']) {
    assert.deepEqual(control.config?.[field], compact.config?.[field], `Compact comparison changed ${field}`);
  }
  const index = rows => {
    assert(Array.isArray(rows) && rows.length, 'Compact comparison needs actual result rows');
    const map = new Map();
    for (const row of rows) {
      const key = `${row.caseId}:${row.mode}`;
      assert(!map.has(key), `Duplicate paired case ${key}`);
      map.set(key, row);
    }
    return map;
  };
  const a = index(control.results), b = index(compact.results);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), 'Compact comparison missing case/mode pairs');
  const scoreDriftCases=[];
  for (const [key, before] of a) {
    const after = b.get(key);
    for (const field of ['question', 'answerable', 'expectedEvidence']) assert.deepEqual(before[field], after[field], `Compact comparison changed ${key} ${field}`);
    assert(Array.isArray(before.evidence) && Array.isArray(after.evidence), `Missing evidence in ${key}`);
    // Provider rerank scores may fluctuate slightly. Compare IDs/order, content and coordinates,
    // not float equality; retain all observed score drift separately rather than filtering rows.
    const sources=items=>items.map(({score,...evidence})=>evidence);
    assert.deepEqual(sources(before.evidence), sources(after.evidence), `Compact comparison retrieval evidence differs for ${key}; do not attribute changes to citation aliases`);
    for(const field of ['recallAtK','mrr'])assert.deepEqual(before[field],after[field],`Compact comparison changed ${key} ${field}`);
    if(before.evidence.some((e,i)=>e.score!==after.evidence[i].score))scoreDriftCases.push(key);
    assert.deepEqual(withoutStyle(before.retrievalOptions), withoutStyle(after.retrievalOptions), `Row options differ for ${key}`);
  }
  return {comparable: true, pairedRows: a.size,scoreDriftCases, rule: 'Same evidence IDs/order/text/coordinates, Recall/MRR, question, source snapshot, model, dataset and retrieval options; citationStyle changes. Provider score drift is disclosed, not hidden. Single paired runs do not prove causality or semantic answer correctness.'};
}

/** Compare client-supplied schema fields; server may enrich stable labels with resolved metadata. */
export function assertRequestedSubset(actual, expected, path = 'config') {
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual), `${path} is not an array`);
    assert.equal(actual.length, expected.length, `${path} length differs`);
    expected.forEach((value, i) => assertRequestedSubset(actual[i], value, `${path}[${i}]`));
  } else if (expected !== null && typeof expected === 'object') {
    assert(actual !== null && typeof actual === 'object', `${path} is not an object`);
    for (const [key, value] of Object.entries(expected)) assertRequestedSubset(actual[key], value, `${path}.${key}`);
  } else assert.deepEqual(actual, expected, `${path} differs from requested experiment`);
}

export function assertRunMatchesRequest(run, {dataset, options, topK}) {
  assert(run.config, 'Recovered run has no saved configuration');
  assert.equal(run.config.topK, topK, 'Recovered run has wrong topK');
  assertRequestedSubset(run.config.retrievalOptions, options, 'retrievalOptions');
  assertRequestedSubset(run.config.dataset, dataset, 'dataset');
}
