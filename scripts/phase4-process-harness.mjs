/** Real two-JVM + PostgreSQL proof; all model calls use an explicitly mock loopback gate. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFaultGate } from './phase4-fault-gate.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = (...parts) => path.join(root, ...parts);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const buildFile = file('.tools', 'phase4-process-build.json');
const cpFile = file('.tools', 'phase4-process-classpath.txt');
function sources() {
  const map = {};
  function walk(dir) { for (const name of fs.readdirSync(dir).sort()) { const p = path.join(dir, name); if (fs.statSync(p).isDirectory()) walk(p); else map[path.relative(root, p).replaceAll('\\', '/')] = hash(fs.readFileSync(p)); } }
  walk(file('backend', 'src')); for (const name of ['phase4-process-harness.mjs', 'phase4-fault-gate.mjs']) map[`scripts/${name}`] = hash(fs.readFileSync(file('scripts', name)));
  return { files: map, sha256: hash(JSON.stringify(map)) };
}
function recordBuild() {
  if (!fs.existsSync(cpFile)) throw Error('Generate .tools/phase4-process-classpath.txt using Maven dependency:build-classpath first');
  const manifest = sources();
  for (const rel of Object.keys(manifest.files).filter((p) => p.endsWith('.java'))) {
    const test = rel.startsWith('backend/src/test/java/');
    const compiled = rel.replace(test ? 'backend/src/test/java/' : 'backend/src/main/java/', test ? 'backend/target/test-classes/' : 'backend/target/classes/').replace(/\.java$/, '.class');
    if (!fs.existsSync(file(compiled)) || fs.statSync(file(compiled)).mtimeMs < fs.statSync(file(rel)).mtimeMs) throw Error(`Compile fresh sources first: ${rel}`);
  }
  fs.writeFileSync(buildFile, JSON.stringify({ createdAt: new Date().toISOString(), ...manifest, classpathHash: hash(fs.readFileSync(cpFile)) }, null, 2));
  process.stdout.write(`Build manifest recorded ${manifest.sha256}\n`);
}
function resolveJava() {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', executable), file('.tools', 'jdk-21.0.12.1+1', 'bin', executable), executable].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
      if (!/^(?:openjdk|java) 21[.\s]/.test(version)) continue;
      return { executable: candidate, version };
    } catch { /* Try the next explicit local Java installation. */ }
  }
  throw Error('Java 21 required: configure JAVA_HOME or put Java 21 on PATH');
}
if (process.argv.includes('--check-java')) { process.stdout.write(JSON.stringify(resolveJava(), null, 2) + '\n'); process.exit(0); }
if (process.argv.includes('--record-build')) { recordBuild(); process.exit(0); }
if (!process.argv.includes('--run')) { process.stdout.write('Use --record-build after Maven test-compile/dependency:build-classpath, then --run [--keep-workers]. Creates a new dedicated database; never removes existing data.\n'); process.exit(0); }
const manifest = JSON.parse(fs.readFileSync(buildFile, 'utf8'));
assert.equal(sources().sha256, manifest.sha256, 'Sources changed after compiled build was recorded');
assert.equal(hash(fs.readFileSync(cpFile)), manifest.classpathHash, 'Classpath changed after build');
const stamp = Date.now().toString(), database = `phase4_process_${stamp}`, container = `citebase-phase4-process-${stamp}`;
const directory = file('docs', 'results', 'phase4', `two-process-${stamp}`); fs.mkdirSync(directory, { recursive: true });
const report = { kind: 'actual-two-java-processes-real-postgresql', modelMode: 'mock/fault-test-only', qualityConclusion: null, startedAt: new Date().toISOString(), status: 'RUNNING', source: manifest, database, container, databasePort: 25435, processes: [], checks: [], scenarios: {} };
const save = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
const raw = (name, value) => fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value, null, 2), { flag: 'wx' });
const check = (name, evidence) => { report.checks.push({ name, passed: true, evidence }); save(); process.stdout.write(`PASS ${name}\n`); };
const selectedJava = resolveJava(); const java = selectedJava.executable; report.java = selectedJava;
const cp = [file('backend', 'target', 'test-classes'), file('backend', 'target', 'classes'), fs.readFileSync(cpFile, 'utf8').replace(/^\uFEFF/, '').trim()].join(path.delimiter);
const alive = new Map(), launched = []; let gate, auth, apiBase = 'http://127.0.0.1:28083';
async function until(fn, message, timeout = 90000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch (e) { last = e; } await delay(150); }
  throw Error(`${message}${last ? `: ${last.message}` : ''}`);
}
async function request(base, route, { body, method = body == null ? 'GET' : 'POST', bearer = auth, expected = 200 } = {}) {
  const multipart = body instanceof FormData;
  const r = await fetch(base + route, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body != null && !multipart ? { 'Content-Type': 'application/json' } : {}) }, body: body == null ? undefined : multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const text = await r.text(); let value; try { value = text ? JSON.parse(text) : null; } catch { throw Error(`${route}: non-JSON status ${r.status}`); }
  if (r.status !== expected) throw Error(`${route}: expected ${expected}, got ${r.status}: ${value?.message || value?.error || ''}`);
  return value;
}
const api = (route, options) => request(apiBase, `/api${route}`, options);
const state = (id) => request(apiBase, `/__process-test/tasks/${id}`);
async function start(label) {
  assert.ok(!alive.has(label));
  const port = label === 'A' ? 28083 : 28084;
  const sequence = report.processes.filter((p) => p.label === label).length + 1;
  const args = ['-cp', cp, 'citebase.processharness.ProcessWorkerApplication', '--MODEL_MODE=mock', '--server.address=127.0.0.1', `--server.port=${port}`, `--HARNESS_PROCESS_LABEL=${label}`, `--spring.datasource.url=jdbc:postgresql://127.0.0.1:25435/${database}`, '--spring.datasource.username=citebase_harness', '--spring.datasource.password=local-test-only', '--citebase.worker-enabled=true', '--TASK_WORKER_CONCURRENCY=1', '--TASK_LEASE_SECONDS=6', '--TASK_HEARTBEAT_SECONDS=1', '--TASK_POLL_MILLIS=100', '--TASK_MAX_ATTEMPTS=3', '--TASK_RETRY_DELAY_SECONDS=1'];
  const argFile = file('.tools', `phase4-process-${stamp}-${label}-${sequence}.args`);
  fs.writeFileSync(argFile, args.map((v) => JSON.stringify(v.replaceAll('\\', '/'))).join('\n'));
  const logFile = path.join(directory, `worker-${label}-${sequence}.log`), output = fs.createWriteStream(logFile);
  const env = { ...process.env, MODEL_MODE: 'mock', WORKER_ENABLED: 'true' };
  for (const key of Object.keys(env)) if (/API_KEY|API_TOKEN|ACCESS_TOKEN|AUTH_TOKEN/.test(key)) delete env[key];
  const child = spawn(java, [`@${argFile}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false }); child.once('close', () => output.end());
  child.on('error', (error) => { report.lastProcessError = error.message; save(); });
  alive.set(label, child); launched.push(child);
  const identity = await until(() => request(`http://127.0.0.1:${port}`, '/__process-test/identity'), `worker ${label} did not start`, 120000);
  assert.equal(identity.database, database); assert.equal(identity.pid, child.pid); assert.equal(identity.modelMode, 'mock/fault-test-only');
  report.processes.push({ label, sequence, ...identity, logFile: path.basename(logFile), startedAt: new Date().toISOString() }); save();
  return identity;
}
async function kill(label) {
  const child = alive.get(label); if (!child) return;
  alive.delete(label);
  if (child.exitCode === null && child.signalCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill('SIGKILL'); await exited; }
  const record = report.processes.findLast((p) => p.label === label); if (record) record.stoppedAt = new Date().toISOString(); save();
}
async function upload(kbId, name, text) {
  const form = new FormData(); form.append('file', new Blob([text], { type: 'text/markdown' }), name);
  const doc = await api(`/knowledge-bases/${kbId}/documents`, { body: form });
  const task = await until(async () => (await api(`/tasks?kbId=${kbId}`)).find((t) => t.kind === 'INDEX' && t.documentId === doc.id), 'index task missing');
  return { doc, task };
}
async function taskFinished(id, expected = 'SUCCEEDED') {
  const result = await until(async () => { const value = await api(`/tasks/${id}`); return ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(value.status) ? value : false; }, `task ${id} did not terminate`);
  assert.equal(result.status, expected, `task ${id}: ${JSON.stringify(result)}`); return result;
}
async function evaluate(kbId, documentName, marker) {
  return api('/evaluations', { expected: 202, body: { kbId, name: marker, idempotencyKey: crypto.randomUUID(), topK: 3,
    retrievalOptions: { candidateK: 10, keywordWeight: 1, rerank: false, citationStyle: 'uuid' },
    dataset: { version: 'process-harness-v1', questions: [{ id: marker, question: `CiteBase 恢复规则是什么？ ${marker}`, answerable: true, expectedAnswer: '保留已完成检查点', evidence: [{ documentName, page: 1, paragraph: 1, quote: 'CiteBase 恢复规则是保留已完成检查点，仅继续未完成工作。', groupId: 'recovery' }] }] } } });
}
const held = (marker, process) => gate.state().calls.find((c) => c.marker === marker && (!process || c.process === process) && c.state === 'HELD');
try {
  save();
  report.git = { branch: execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), status: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim() };
  gate = await startFaultGate({ logPath: path.join(directory, 'gate-events.jsonl') });
  execFileSync('docker', ['run', '-d', '--name', container, '-p', '127.0.0.1:25435:5432', '-e', `POSTGRES_DB=${database}`, '-e', 'POSTGRES_USER=citebase_harness', '-e', 'POSTGRES_PASSWORD=local-test-only', '--mount', `type=volume,source=${container}-data,target=/var/lib/postgresql/data`, 'pgvector/pgvector:0.8.2-pg17'], { encoding: 'utf8', windowsHide: true });
  await until(() => { try { execFileSync('docker', ['exec', container, 'pg_isready', '-U', 'citebase_harness', '-d', database], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; } }, 'dedicated PostgreSQL did not start');
  const a = await start('A');
  auth = (await api('/auth/login', { bearer: null, body: { username: 'alice', password: 'Alice-demo-123!' } })).token;
  const kb = await api('/knowledge-bases', { body: { name: `ProcessHarness-${stamp}` } }); report.kbId = kb.id;
  const documentName = 'process-harness.md';
  const seeded = await upload(kb.id, documentName, 'CiteBase 恢复规则是保留已完成检查点，仅继续未完成工作。');
  await taskFinished(seeded.task.id);
  gate.setRules([{ operation: 'generation', process: 'A', marker: 'P4_GATE_RECOVERY', skip: 1, remaining: 1, action: 'hold' }]);
  const recovery = await evaluate(kb.id, documentName, 'P4_GATE_RECOVERY');
  await until(() => held('P4_GATE_RECOVERY', 'A'), 'A did not reach checkpoint-following gate');
  const before = await state(recovery.id); raw('recovery-before-crash', before);
  const done = before.items.filter((i) => i.resultHash); assert.equal(done.length, 1);
  const b = await start('B'); assert.notEqual(a.workerId, b.workerId); assert.notEqual(a.pid, b.pid);
  await delay(1800);
  const live = await state(recovery.id); assert.equal(live.task[0].lease_owner, a.workerId); assert.equal(live.task[0].fencing_token, before.task[0].fencing_token);
  check('B startup does not steal A valid lease', { before: before.task[0], after: live.task[0] });
  const competing = await upload(kb.id, 'competition.md', 'CiteBase 并行索引验证 P4_GATE_COMPETE。'); await taskFinished(competing.task.id);
  assert.ok(gate.state().calls.some((c) => c.taskId === seeded.task.id && c.process === 'A'));
  assert.ok(gate.state().calls.some((c) => c.taskId === competing.task.id && c.process === 'B'));
  check('two actual JVM workers independently claim tasks', { A: a, B: b });
  await kill('A'); apiBase = 'http://127.0.0.1:28084';
  await taskFinished(recovery.id);
  const recovered = await state(recovery.id); raw('recovery-after-crash', recovered);
  assert.equal(recovered.items.find((i) => i.case_id === done[0].case_id && i.mode === done[0].mode).resultHash, done[0].resultHash);
  assert.ok(recovered.task[0].fencing_token > before.task[0].fencing_token);
  assert.ok(recovered.calls.some((c) => c.status === 'UNKNOWN'));
  assert.equal(gate.state().calls.filter((c) => c.marker === 'P4_GATE_RECOVERY' && c.operation === 'generation' && c.process === 'B').length, 1);
  raw('recovered-evaluation-export', await api(`/evaluations/${recovery.id}/export`));
  check('kill owner resumes only unfinished evaluation item with immutable first checkpoint', { runId: recovery.id, oldResultHash: done[0].resultHash, newGeneration: recovered.task[0].fencing_token, unknownCalls: recovered.calls.filter((c) => c.status === 'UNKNOWN').length });
  gate.release(gate.state().waiting); await kill('B');

  const a2 = await start('A'); apiBase = 'http://127.0.0.1:28083';
  gate.setRules([{ operation: 'embedding', process: 'A', marker: 'P4_GATE_STALE', remaining: 1, action: 'hold' }]);
  const stale = await upload(kb.id, 'stale-index.md', 'CiteBase 过期租约晚到写入验证 P4_GATE_STALE。');
  const lateCall = await until(() => held('P4_GATE_STALE', 'A'), 'A did not hold index embedding');
  const staleBefore = await state(stale.task.id); raw('stale-before-expire', staleBefore);
  const b2 = await start('B');
  assert.equal((await request(apiBase, `/__process-test/tasks/${stale.task.id}/expire`, { body: {} })).expired, 1);
  apiBase = 'http://127.0.0.1:28084'; await taskFinished(stale.task.id);
  const winner = await state(stale.task.id); raw('stale-new-owner-published', winner);
  assert.ok(winner.task[0].fencing_token > staleBefore.task[0].fencing_token);
  assert.ok(gate.state().calls.some((c) => c.taskId === stale.task.id && c.process === 'B'));
  gate.release([lateCall.id]); await delay(1800);
  const afterLate = await state(stale.task.id); raw('stale-after-late-return', afterLate);
  assert.deepEqual(afterLate.chunks, winner.chunks); assert.equal(afterLate.stageParts, winner.stageParts);
  assert.deepEqual(afterLate.task, winner.task);
  check('expired live worker late response cannot replace new generation chunks or terminal state', { taskId: stale.task.id, oldWorker: a2.workerId, newWorker: b2.workerId, oldGeneration: staleBefore.task[0].fencing_token, newGeneration: winner.task[0].fencing_token, chunkIds: winner.chunks.map((c) => c.id) });

  gate.setRules([{ operation: 'generation', marker: 'P4_GATE_CANCEL', remaining: 1, action: 'hold' }]);
  const cancelRun = await evaluate(kb.id, documentName, 'P4_GATE_CANCEL');
  const cancelCall = await until(() => held('P4_GATE_CANCEL'), 'cancel gate not reached');
  const cancelled = await api(`/tasks/${cancelRun.id}/cancel`, { body: {} }); assert.ok(['CANCEL_REQUESTED', 'CANCELLED'].includes(cancelled.status));
  gate.release([cancelCall.id]); await taskFinished(cancelRun.id, 'CANCELLED');
  const cancelledState = await state(cancelRun.id); raw('cancelled-state', cancelledState); raw('cancelled-partial-export', await api(`/evaluations/${cancelRun.id}/export`));
  assert.equal(gate.state().calls.filter((c) => c.marker === 'P4_GATE_CANCEL' && c.operation === 'generation').length, 1);
  assert.ok(cancelledState.items.every((i) => i.status !== 'SUCCEEDED'));
  check('running cancellation prevents next item and late success publication', { runId: cancelRun.id, actualGenerationCalls: 1, terminal: 'CANCELLED' });
  report.status = 'PASSED'; report.finishedAt = new Date().toISOString(); raw('gate-receipts-final', gate.state()); save();
  process.stdout.write(`Evidence: ${directory}\nDedicated database retained: ${container} port25435\n`);
  if (process.argv.includes('--keep-workers')) {
    report.keptWorkers = true; save(); process.stdout.write('Workers/gate retained for read-only or controlled UI tests; Ctrl+C stops only these JVMs.\n');
    await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} catch (e) {
  report.status = 'FAILED'; report.error = e.stack; report.finishedAt = new Date().toISOString(); if (gate) raw('gate-receipts-failure', gate.state()); save(); process.stderr.write(`${e.stack}\nEvidence retained ${directory}\n`); process.exitCode = 1;
} finally {
  for (const label of [...alive.keys()]) await kill(label);
  if (gate) await gate.close();
  report.processesStoppedAt = new Date().toISOString(); save();
}
