/** Real two-JVM + PostgreSQL proof; all model calls use an explicitly mock loopback gate.
 * Run from the repository root after Java 21 Maven test-compile and
 * dependency:build-classpath -Dmdep.outputFile=<absolute>/.tools/phase4-process-classpath.txt:
 *   node --test scripts/quality-admission-fixture.test.mjs
 *   node scripts/quality-admission-harness.mjs --record-build
 *   node scripts/quality-admission-harness.mjs --run
 * Requires Docker and unused loopback ports 25435, 28083, 28084, 39555.
 * Creates a dedicated PG container/volume, retains both for review, stops owned JVMs/gate.
 * Source changes require fresh compilation and --record-build. No real model throughput
 * or quality claim: this is a preregistered 24-arrival, 8 requests/second admission probe.
 * report.json + requests.jsonl + SQL snapshots + gate/worker logs persist on failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import {registration, validateRegistration, assertRejected, openLoop, evaluationBody} from './quality-admission-fixture.mjs';
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
const buildFile = file('.tools', 'quality-admission-build.json');
const cpFile = file('.tools', 'phase4-process-classpath.txt');
function sources() {
  const map = {};
  function walk(dir) { for (const name of fs.readdirSync(dir).sort()) { const p = path.join(dir, name); if (fs.statSync(p).isDirectory()) walk(p); else map[path.relative(root, p).replaceAll('\\', '/')] = hash(fs.readFileSync(p)); } }
  walk(file('backend', 'src')); for (const name of ['quality-admission-harness.mjs', 'quality-admission-fixture.mjs', 'phase4-fault-gate.mjs']) map[`scripts/${name}`] = hash(fs.readFileSync(file('scripts', name)));
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
if (!process.argv.includes('--run')) { process.stdout.write('Use --record-build after Maven test-compile/dependency:build-classpath, then --run. Creates and retains a new dedicated database; stops owned JVMs and gate. See file header for prerequisites.\n'); process.exit(0); }
const manifest = JSON.parse(fs.readFileSync(buildFile, 'utf8'));
assert.equal(sources().sha256, manifest.sha256, 'Sources changed after compiled build was recorded');
assert.equal(hash(fs.readFileSync(cpFile)), manifest.classpathHash, 'Classpath changed after build');
const stamp = Date.now().toString(), database = `phase4_process_${stamp}`, container = `citebase-phase4-process-${stamp}`;
const directory = file('docs', 'results', 'quality-phase3', 'admission', `two-process-${stamp}`); fs.mkdirSync(directory, { recursive: true });
const report = { kind: 'actual-two-java-processes-real-postgresql', modelMode: 'mock/fault-test-only', qualityConclusion: null, startedAt: new Date().toISOString(), status: 'RUNNING', source: manifest, database, container, databasePort: 25435, processes: [], checks: [], scenarios: {} };
const save = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
const raw = (name, value) => fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value, null, 2), { flag: 'wx' });
const check = (name, evidence) => { report.checks.push({ name, passed: true, evidence }); save(); process.stdout.write(`PASS ${name}\n`); };
const selectedJava = resolveJava(); const java = selectedJava.executable; report.java = selectedJava;
const cp = [file('backend', 'target', 'test-classes'), file('backend', 'target', 'classes'), fs.readFileSync(cpFile, 'utf8').replace(/^\uFEFF/, '').trim()].join(path.delimiter);
const operationsToken=crypto.randomBytes(24).toString('hex');
report.registration=validateRegistration({...registration});
report.machine={platform:os.platform(),arch:os.arch(),logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem()};
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
  const args = ['-Xmx384m', '-XX:ActiveProcessorCount=2', '-cp', cp, 'citebase.processharness.ProcessWorkerApplication', '--MODEL_MODE=mock', '--server.address=127.0.0.1', `--server.port=${port}`, `--HARNESS_PROCESS_LABEL=${label}`, `--spring.datasource.url=jdbc:postgresql://127.0.0.1:25435/${database}`, '--spring.datasource.username=citebase_harness', '--spring.datasource.password=local-test-only', '--citebase.worker-enabled=true', '--TASK_WORKER_CONCURRENCY=1', '--TASK_LEASE_SECONDS=6', '--TASK_HEARTBEAT_SECONDS=1', '--TASK_POLL_MILLIS=100', '--TASK_MAX_ATTEMPTS=1', '--TASK_RETRY_DELAY_SECONDS=1', '--spring.datasource.hikari.connection-timeout=2000', '--spring.datasource.hikari.maximum-pool-size=6', '--ADMISSION_GLOBAL_TASKS=3', '--ADMISSION_USER_TASKS=2', '--ADMISSION_SYNC_CONCURRENCY=1', '--ADMISSION_RETRY_AFTER_SECONDS=3'];
  const argFile = file('.tools', `phase4-process-${stamp}-${label}-${sequence}.args`);
  fs.writeFileSync(argFile, args.map((v) => JSON.stringify(v.replaceAll('\\', '/'))).join('\n'));
  const logFile = path.join(directory, `worker-${label}-${sequence}.txt`), output = fs.createWriteStream(logFile);
  const env = Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','JAVA_HOME'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, {MODEL_MODE:'mock',WORKER_ENABLED:'true',OPERATIONS_TOKEN:operationsToken});
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

// One durable receipt per offered request, including transport failures. No retry.
async function observed(label, route, body, bearer = auth, slot = {}) {
  const started = performance.now();
  const multipart = body instanceof FormData;
  const receipt = {label, route, requestBody: multipart ? Object.fromEntries([...body].map(([k,v])=>[k,typeof v==='string'?v:{name:v.name,size:v.size,type:v.type}])) : body, ...slot, startedAt: new Date().toISOString()};
  try {
    const response = await fetch(`http://127.0.0.1:${label === 'A' ? 28083 : 28084}/api${route}`, {
      method: 'POST', headers: {Authorization: `Bearer ${bearer}`, ...(!multipart ? {'Content-Type': 'application/json'} : {})},
      body: multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(registration.requestTimeoutMs)});
    receipt.status = response.status; receipt.headers = Object.fromEntries(response.headers);
    receipt.retryAfter = response.headers.get('retry-after'); receipt.responseText = await response.text();
    try { receipt.body = JSON.parse(receipt.responseText); } catch { receipt.body = null; }
  } catch (error) { receipt.transportError = String(error); }
  receipt.elapsedMs = performance.now() - started; receipt.finishedAt = new Date().toISOString();
  fs.appendFileSync(path.join(directory, 'requests.jsonl'), JSON.stringify(receipt) + '\n');
  return receipt;
}
function snapshot() {
  const tables = ['work_task','evaluation_run','evaluation_snapshot','evaluation_item','document','document_version','index_task'];
  const sql = `select json_build_object('counts',json_build_object(${tables.map(t => `'${t}',(select count(*) from ${t})`).join(',')}),'active',(select coalesce(json_agg(t),'[]'::json) from (select id,user_id,status from work_task where status in ('QUEUED','RUNNING','RETRY_WAIT','CANCEL_REQUESTED') order by id) t),'terminal',(select coalesce(json_agg(t),'[]'::json) from (select id,status,retry_generation from work_task where status in ('FAILED','CANCELLED') order by id) t));`;
  return JSON.parse(execFileSync('docker', ['exec',container,'psql','-U','citebase_harness','-d',database,'-At','-c',sql], {encoding:'utf8',windowsHide:true}).trim());
}
function capacity(value) {
  assert.ok(value.active.length <= registration.globalTasks);
  for (const user of new Set(value.active.map(t => t.user_id))) assert.ok(value.active.filter(t => t.user_id === user).length <= registration.userTasks);
}
function activeDataVersions(kbId) {
  assert.match(kbId,/^[0-9a-f-]{36}$/);
  // Same active source fields/order as RetrievalService.dataVersions; no sync slot needed.
  const sql=`select coalesce(json_agg(t),'[]'::json) from (select d.id,d.name,v.id version_id,v.content_hash,v.chunk_strategy,v.chunk_size,v.chunk_overlap from document d join document_version v on v.id=d.active_version_id where d.kb_id='${kbId}' order by d.id) t;`;
  return JSON.parse(execFileSync('docker',['exec',container,'psql','-U','citebase_harness','-d',database,'-At','-c',sql],{encoding:'utf8',windowsHide:true}).trim());
}
try {
  save();
  const git = process.env.CITEBASE_GIT || (fs.existsSync('E:/Git/mingw64/bin/git.exe') ? 'E:/Git/mingw64/bin/git.exe' : 'git');
  report.git = {head:execFileSync(git,['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim()};
  for (const port of [25435,28083,28084,39555]) await new Promise((resolve,reject) => {
    const probe=net.createServer(); probe.once('error',reject); probe.listen(port,'127.0.0.1',()=>probe.close(resolve));
  });
  gate = await startFaultGate({logPath:path.join(directory,'gate-events.jsonl')});
  execFileSync('docker',['run','-d','--name',container,'-p','127.0.0.1:25435:5432','-e',`POSTGRES_DB=${database}`,'-e','POSTGRES_USER=citebase_harness','-e','POSTGRES_PASSWORD=local-test-only','--mount',`type=volume,source=${container}-data,target=/var/lib/postgresql/data`,'pgvector/pgvector:0.8.2-pg17'],{encoding:'utf8',windowsHide:true});
  await until(()=>{try {execFileSync('docker',['exec',container,'pg_isready','-U','citebase_harness','-d',database],{stdio:'ignore',windowsHide:true});return true;}catch{return false;}},'PostgreSQL unavailable');
  const a=await start('A'), b=await start('B'); assert.notEqual(a.pid,b.pid); assert.notEqual(a.workerId,b.workerId);
  auth=(await api('/auth/login',{bearer:null,body:{username:'alice',password:'Alice-demo-123!'}})).token;
  const bob=(await api('/auth/login',{bearer:null,body:{username:'bob',password:'Bob-demo-123!'}})).token;
  const kb=await api('/knowledge-bases',{body:{name:`Admission-A-${stamp}`}});
  const kbB=await api('/knowledge-bases',{bearer:bob,body:{name:`Admission-B-${stamp}`}});
  const seeded=await upload(kb.id,'admission.md','恢复规则是保留检查点。'); await taskFinished(seeded.task.id);
  const alice=auth; auth=bob;
  const seedB=await upload(kbB.id,'admission.md','恢复规则是保留检查点。'); await taskFinished(seedB.task.id); auth=alice;
  // Produce a real terminal task that can be retried after overload is established.
  gate.setRules([{operation:'embedding',marker:'P4_GATE_RETRY',action:'fail',status:500,remaining:10}]);
  const failed=await upload(kb.id,'retry.md','恢复规则 P4_GATE_RETRY'); await taskFinished(failed.task.id,'FAILED');
  gate.setRules([{operation:'generation',marker:'P4_GATE_ADMISSION_A',action:'hold',remaining:1},{operation:'generation',marker:'P4_GATE_ADMISSION_B',action:'hold',remaining:1}]);
  const bodyA=evaluationBody(kb.id,'P4_GATE_ADMISSION_A',crypto.randomUUID());
  const first=await observed('A','/evaluations',bodyA); assert.equal(first.status,202);
  await until(()=>held('P4_GATE_ADMISSION_A'),'First task not held');
  const second=await observed('B','/evaluations',evaluationBody(kb.id,'P4_GATE_ADMISSION_B',crypto.randomUUID())); assert.equal(second.status,202);
  await until(()=>held('P4_GATE_ADMISSION_B'),'Second task not held');
  const userBefore=snapshot(); capacity(userBefore); assert.equal(userBefore.active.length,2);
  assertRejected(await observed('B','/evaluations',evaluationBody(kb.id,'P4_GATE_USER_REJECT',crypto.randomUUID())));
  assert.deepEqual(snapshot(),userBefore); check('per-user capacity is shared across JVMs and rejection rolls back',userBefore);
  const third=await observed('A','/evaluations',evaluationBody(kbB.id,'P4_GATE_QUEUED',crypto.randomUUID()),bob); assert.equal(third.status,202);
  const full=snapshot(); capacity(full); assert.equal(full.active.length,3); raw('capacity-full',full);
  const replay=await observed('B','/evaluations',bodyA); assert.equal(replay.status,202); assert.equal(replay.body.id,first.body.id);
  assertRejected(await observed('B',`/tasks/${failed.task.id}/retry`,{}));
  const rejectedUpload=new FormData(); rejectedUpload.append('file',new Blob(['must roll back'],{type:'text/markdown'}),'rejected.md');
  assertRejected(await observed('A',`/knowledge-bases/${kbB.id}/documents`,rejectedUpload,bob));
  const offered=await openLoop(registration,slot=>observed(slot.process,'/evaluations',evaluationBody(kbB.id,'P4_GATE_OVERLOAD',crypto.randomUUID()),bob,slot));
  raw('open-loop-arrivals',offered); assert.equal(offered.length,24); offered.forEach(r=>assertRejected(r));
  const after=snapshot(); capacity(after); assert.deepEqual(after,full); raw('capacity-after-rejections',after);
  check('fixed-rate overload rejects with 429 Retry-After; replay and failed retry preserve capacity and all domain rows',{offered:offered.length,before:full,after});
  const cancelling=await api(`/tasks/${first.body.id}/cancel`,{body:{}}); assert.equal(cancelling.status,'CANCEL_REQUESTED');
  const duringCancel=snapshot(); capacity(duringCancel); assert.equal(duringCancel.active.length,3);
  assertRejected(await observed('B','/evaluations',evaluationBody(kbB.id,'P4_GATE_CANCEL_REJECT',crypto.randomUUID()),bob));
  check('running cancellation retains admission capacity until terminal',duringCancel);
  gate.setRules([]); gate.release(gate.state().waiting);
  await taskFinished(first.body.id,'CANCELLED'); await taskFinished(second.body.id); auth=bob; await taskFinished(third.body.id); auth=alice;
  assert.equal(snapshot().active.length,0);
  const retry=await observed('B',`/tasks/${failed.task.id}/retry`,{}); assert.equal(retry.status,200); await taskFinished(failed.task.id);
  const recovered=await observed('A','/evaluations',evaluationBody(kb.id,'P4_GATE_RECOVERED',crypto.randomUUID())); assert.equal(recovered.status,202); await taskFinished(recovered.body.id);
  check('releasing work restores new admission and manual retry',snapshot());
  // Each actual JVM owns one synchronous slot. Hold both independently.
  gate.setRules(['A','B'].map(process=>({operation:'embedding',process,marker:`P4_GATE_SYNC_${process}`,action:'hold',remaining:1})));
  const syncBody=marker=>({kbId:kb.id,question:`恢复规则是什么？ ${marker}`,mode:'vector',topK:3});
  const pendingA=observed('A','/questions',syncBody('P4_GATE_SYNC_A'));
  await until(()=>held('P4_GATE_SYNC_A','A'),'A synchronous slot not held');
  const pendingB=observed('B','/questions',syncBody('P4_GATE_SYNC_B'));
  await until(()=>held('P4_GATE_SYNC_B','B'),'B synchronous slot not held');
  for (const label of ['A','B']) for (const route of ['/questions','/retrieval-diagnostics']) assertRejected(await observed(label,route,syncBody('P4_GATE_SYNC_REJECT')));
  gate.release(gate.state().waiting); assert.equal((await pendingA).status,200); assert.equal((await pendingB).status,200);
  for (const label of ['A','B']) {
    gate.setRules([{operation:'embedding',process:label,marker:'P4_GATE_SYNC_FAILURE',action:'fail',status:500,remaining:1}]);
    const failure=await observed(label,'/retrieval-diagnostics',syncBody('P4_GATE_SYNC_FAILURE'));
    assert.equal(failure.status,200); assert.ok(failure.body.error,JSON.stringify(failure));
    gate.setRules([]); assert.equal((await observed(label,'/questions',syncBody('P4_GATE_SYNC_RECOVERY'))).status,200);
    // A source mutation after admission makes diagnostics throw SOURCE_CHANGED.
    const versionsBefore=activeDataVersions(kb.id);
    gate.setRules([{operation:'embedding',process:label,marker:`P4_GATE_EXCEPTION_${label}`,action:'hold',remaining:1}]);
    const exception=observed(label,'/retrieval-diagnostics',syncBody(`P4_GATE_EXCEPTION_${label}`));
    await until(()=>held(`P4_GATE_EXCEPTION_${label}`,label),'Exception probe not held');
    const changed=await upload(kb.id,`changed-${label}.md`,`恢复规则是保留检查点。 新资料 ${label} ${stamp}`); await taskFinished(changed.task.id);
    const versionsAfter=activeDataVersions(kb.id);
    raw(`exception-source-mutation-${label}`,{before:versionsBefore,after:versionsAfter,uploaded:changed});
    assert.notDeepEqual(versionsAfter,versionsBefore,'Exception fixture must change active dataVersions before gate release');
    assert.equal(versionsAfter.length,versionsBefore.length+1,'Unique fixture content must create a new active document');
    assert.ok(versionsAfter.some(v=>v.id===changed.doc.id && v.name===`changed-${label}.md`));
    assert.ok(held(`P4_GATE_EXCEPTION_${label}`,label),'Source mutation must finish while exception request remains held');
    gate.release(gate.state().waiting); assert.equal((await exception).status,409);
    gate.setRules([]); assert.equal((await observed(label,'/retrieval-diagnostics',syncBody(`P4_GATE_AFTER_EXCEPTION_${label}`))).status,200);
  }
  check('each JVM rejects both synchronous routes when full and releases slots after success and exception',{processes:[a.pid,b.pid]});
  report.status='PASSED'; report.finishedAt=new Date().toISOString(); raw('gate-receipts-final',gate.state()); save();
  process.stdout.write(`Evidence: ${directory}\nDedicated database retained: ${container}\n`);
} catch(error) {
  report.status='FAILED'; report.error=error.stack; report.finishedAt=new Date().toISOString();
  if(gate) raw('gate-receipts-failure',gate.state()); save(); process.stderr.write(`${error.stack}\n`); process.exitCode=1;
} finally {
  if(gate) gate.release(gate.state().waiting,504);
  for(const label of [...alive.keys()]) await kill(label);
  if(gate) await gate.close(); report.processesStoppedAt=new Date().toISOString(); save();
}
