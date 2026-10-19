import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha, read, save, immutable, client, evaluation} from './phase2-client.mjs';
import {execute, register, costDeploymentGuard} from './quality-assisted-cost-independent.mjs';
import {assertRunMatchesRequest, assertRequestedSubset} from './phase2-comparability.mjs';
import {verifySnapshot} from './quality-assisted-agent-collector.mjs';

export function guardRecovery(plan, current, bytes = fs.readFileSync) {
  assert.deepEqual(register(plan.freeze, plan.freeze.runtime, bytes), plan, 'Frozen registration changed');
  for (const options of [plan.freeze.baselineOptions, plan.freeze.selectedOptions])
    assert.equal(options.cache ?? false, false, 'Cache-enabled experiments cannot resume across restarts');
  const {startedAt: previousStart, ...previous} = plan.freeze.runtime;
  const {startedAt: currentStart, ...actual} = current;
  assert.deepEqual(actual, previous, 'Recovery runtime identity/model/source/image/port drift');
  assert(Number.isFinite(Date.parse(currentStart)) && Date.parse(currentStart) > Date.parse(previousStart), 'Recovery requires a later container start');
}

const ref = file => ({file: path.resolve(file), sha256: sha(fs.readFileSync(file))});
export function comparableCalls(calls) {
  assert(Array.isArray(calls), 'External call evidence required');
  return calls.map(call => Object.fromEntries(Object.entries(call).map(([key,value]) => {
    const field=key.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase());
    if(['startedAt','finishedAt'].includes(field) && typeof value==='string')
      value=value.replace(/\+00:00$/, 'Z').replace(/(\.\d*?)0+Z$/, '$1Z').replace(/\.Z$/, 'Z');
    return [field,value];
  })));
}
function filesIn(root) {
  return fs.readdirSync(root, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  }).sort();
}
export function verifyManifest(manifest) {
  assert.equal(manifest.schema, 'citebase-assisted-cost-recovery-v1');
  for (const source of [...manifest.originalFiles, manifest.interrupted.evaluation, manifest.interrupted.task])
    assert.equal(sha(fs.readFileSync(source.file)), source.sha256, `Recovery source changed: ${source.file}`);
}
function specFor(spec, runtime) {
  return {kbId: spec.kbId, datasetSha256: sha(JSON.stringify(spec.dataset)), options: spec.options, topK: spec.topK, runtime};
}
export function validateRun(run, state, spec, documents) {
  assert.equal(state.id, spec.id, 'Journal identity differs');
  assert.equal(state.expectedRows, spec.dataset.questions.length * 2);
  assert.equal(run.id, state.runId, 'Run identity differs');
  assert.equal(run.name, `p2opt-${spec.id}`, 'Run name differs');
  assertRunMatchesRequest(run, spec);
  verifySnapshot(run.config.dataVersions, documents);
  assert.deepEqual(run.results.map(row => [row.caseId, row.mode]).sort(),
    spec.dataset.questions.flatMap(q => ['vector', 'hybrid'].map(mode => [q.id, mode])).sort(), 'Incomplete/duplicate result keys');
  for (const [key, value] of Object.entries(state.spec.runtime.modelConfig))
    assert.deepEqual(run.config[key], value, `Model configuration drift: ${key}`);
  assert.equal(run.config.retrievalOptions.cache ?? false, false, 'Run enabled cache');
  for (const row of run.results) assert.notEqual(row.diagnostics?.cost?.cache?.status, 'HIT', 'Cache continuity cannot be recovered');
}

export function prepareRecovery(root, recoveryRoot, plan, current, {bytes = fs.readFileSync} = {}) {
  root = path.resolve(root); recoveryRoot = path.resolve(recoveryRoot);
  assert(!recoveryRoot.startsWith(root + path.sep) && recoveryRoot !== root, 'Recovery evidence must be outside the original root');
  guardRecovery(plan, current, bytes);
  const file = path.join(recoveryRoot, 'manifest.json');
  if (fs.existsSync(file)) {
    const manifest = read(file); verifyManifest(manifest);
    assert.deepEqual(manifest.currentRuntime, current); assert.deepEqual(manifest.originalRuntime, plan.freeze.runtime);
    assert.equal(manifest.registrationSha256, sha(JSON.stringify(plan)));
    return manifest;
  }
  assert.deepEqual(read(path.join(root, 'registration.json')), plan);
  const state = read(path.join(root, 'state.json'));
  assert(state.indexed && state.smokeCompleted && !state.collectionCompleted, 'Expected interrupted collection');
  const interruptedJournals = filesIn(path.join(root, 'runs')).filter(f => f.endsWith('.state.json') && !fs.existsSync(f.replace('.state.json', '.raw.json')));
  assert.equal(interruptedJournals.length, 1, 'Exactly one interrupted journal required');
  const journal = read(interruptedJournals[0]);
  assert(journal.runId, 'Unknown submission cannot be adopted');
  assert.deepEqual(journal.spec.runtime, plan.freeze.runtime);
  const evaluationFile = path.join(recoveryRoot, 'interrupted-evaluation.json'), taskFile = path.join(recoveryRoot, 'interrupted-task.json');
  const run = read(evaluationFile), task = read(taskFile);
  assert.equal(run.id, journal.runId); assert.equal(task.id, journal.runId); assert.equal(run.taskId, task.id);
  assert.equal(run.status, 'FAILED'); assert.equal(task.status, 'FAILED'); assert.equal(task.kind, 'EVALUATION');
  assert.equal(task.kbId, state.kbId); assert.equal(task.payload.kbId, state.kbId); assert.equal(task.payload.name, `p2opt-${journal.id}`);
  assert.deepEqual(comparableCalls(run.externalCalls), comparableCalls(task.externalCalls), 'External call evidence differs');
  assert(Array.isArray(task.externalCalls), 'External call evidence required');
  const dataset = JSON.parse(bytes(plan.freeze.dataset.file));
  const prefix = `CostIndependent-${sha(JSON.stringify(plan)).slice(0,20)}`;
  const item = plan.items.find(item => `${prefix}-${item.batchId}-${item.arm}` === journal.id);
  assert(item, 'Interrupted journal is not registered');
  const q = dataset.questions.find(q => q.id === item.baseCaseId);
  const spec = {id: journal.id, kbId: state.kbId, dataset: {version: dataset.version, questions: item.questions.map(x => ({...q, id:x.caseId}))}, options:item.arm === 'control' ? plan.freeze.baselineOptions : plan.freeze.selectedOptions, topK:5};
  assert.deepEqual(journal.spec, specFor(spec, plan.freeze.runtime));
  validateRun(run, journal, spec, state.documents);
  assertRequestedSubset(task.payload.dataset, spec.dataset); assertRequestedSubset(task.payload.retrievalOptions, spec.options);
  assert.equal(task.payload.topK, spec.topK);
  assert(run.results.some(r => !r.error), 'Successful checkpoint must be retained');
  assert(run.results.some(r => r.error === 'ATTEMPTS_EXHAUSTED'), 'Interrupted failure must be retained');
  const config = {...run.config}; delete config.dataset;
  assert.deepEqual(config, read(path.join(root, `${item.arm}-config.json`)), 'Interrupted config changed');
  assert.deepEqual(run.config.dataVersions, read(path.join(root, 'snapshot.json')));
  const manifest = {schema:'citebase-assisted-cost-recovery-v1', createdAt:new Date().toISOString(), registrationSha256:sha(JSON.stringify(plan)),
    originalRuntime:plan.freeze.runtime, currentRuntime:current,
    segments:[{id:'original', runtime:plan.freeze.runtime}, {id:'recovery', runtime:current}], continuousLatencyComparable:false,
    interpretation:'Explicit restart segments; request latency and end-to-end duration are not a continuous experiment. UNKNOWN external calls may have incurred unobserved usage and are retained without retry.',
    originalFiles:filesIn(root).map(ref), interrupted:{evaluation:ref(evaluationFile), task:ref(taskFile), runId:run.id, journalId:journal.id, externalCalls:task.externalCalls}};
  immutable(file, manifest);
  return manifest;
}

export async function recover(root, recoveryRoot, plan, current, api, {bytes=fs.readFileSync, guard=()=>costDeploymentGuard(current), evaluate=evaluation, collector=execute}={}) {
  guard();
  const manifest = prepareRecovery(root, recoveryRoot, plan, current, {bytes});
  const originalStateFile = path.join(root,'state.json'), originalState = fs.readFileSync(originalStateFile), state = JSON.parse(originalState);
  const output = path.join(root,'runs',`${manifest.interrupted.journalId}.raw.json`);
  if (fs.existsSync(output)) assert.equal(sha(fs.readFileSync(output)),manifest.interrupted.evaluation.sha256);
  else fs.copyFileSync(manifest.interrupted.evaluation.file,output);
  const key = manifest.interrupted.journalId.replace(`CostIndependent-${manifest.registrationSha256.slice(0,20)}-`, '');
  immutable(path.join(root,'tasks',`${key}.json`),read(manifest.interrupted.task.file));
  immutable(path.join(recoveryRoot,'recovery-provenance.json'),ref(fileURLToPath(import.meta.url)));
  const wrapped = async (api, spec) => {
    guard(); verifyManifest(manifest);
    verifySnapshot(read(path.join(root,'snapshot.json')),await api.request(`/api/knowledge-bases/${state.kbId}/documents`));
    const journalFile = path.join(spec.root,`${spec.id}.state.json`), rawFile = path.join(spec.root,`${spec.id}.raw.json`);
    if (fs.existsSync(rawFile)) {
      assert(fs.existsSync(journalFile)); const journal=read(journalFile);
      const recorded = manifest.originalFiles.some(source=>source.file===path.resolve(journalFile));
      assert.deepEqual(journal.spec,specFor(spec,recorded?manifest.originalRuntime:current),'Saved journal runtime/spec changed');
      const run=read(rawFile); validateRun(run,journal,spec,state.documents);
      if(journal.rawSha256)assert.equal(sha(fs.readFileSync(rawFile)),journal.rawSha256,'Raw hash changed');
      if(run.status==='FAILED') {assert.equal(run.id,manifest.interrupted.runId);assert.equal(sha(fs.readFileSync(rawFile)),manifest.interrupted.evaluation.sha256);}
      else assert(['COMPLETED','COMPLETED_WITH_ERRORS','SUCCEEDED'].includes(run.status));
      return run;
    }
    if(fs.existsSync(journalFile))assert.deepEqual(read(journalFile).spec,specFor(spec,current),'Unresolved original journal cannot be resubmitted');
    return evaluate(api,{...spec,runtime:current});
  };
  try {
    const result=await collector('collect',root,plan,api,{guard,bytes,evaluate:wrapped});
    save(path.join(recoveryRoot,'collection-state.json'),result); return result;
  } finally {fs.writeFileSync(originalStateFile,originalState);}
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [root,recoveryRoot,runtimeFile]=process.argv.slice(2); assert(root&&recoveryRoot&&runtimeFile);
  const plan=read(path.join(root,'registration.json')),current=read(runtimeFile);
  guardRecovery(plan,current); costDeploymentGuard(current); process.env.CITEBASE_URL=current.apiUrl;
  await recover(root,recoveryRoot,plan,current,await client());
}
