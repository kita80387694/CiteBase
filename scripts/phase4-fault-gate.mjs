import http from 'node:http';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const allowedOperations = new Set(['embedding', 'generation', 'planner']);
export async function startFaultGate({ logPath } = {}) {
  const calls = [], waiting = new Map(); let rules = [], serial = 0;
  const append = (event) => { if (logPath) fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); };
  function setRules(input) {
    if (!Array.isArray(input) || input.length > 30) throw Error('At most 30 test rules');
    rules = input.map((r, index) => {
      if (!allowedOperations.has(r.operation) || !['hold', 'fail', 'delay'].includes(r.action)) throw Error('Invalid test operation/action');
      if (r.process && !['A', 'B'].includes(r.process)) throw Error('Unknown process');
      if (r.marker && !/^P4_GATE_[A-Z0-9_]{1,60}$/.test(r.marker)) throw Error('Invalid test marker');
      const skip = r.skip ?? 0, remaining = r.remaining ?? 1, delayMs = r.delayMs ?? 0;
      if (![skip, remaining, delayMs].every(Number.isInteger) || skip < 0 || remaining < 1 || remaining > 1000 || delayMs < 0 || delayMs > 30000) throw Error('Invalid test bounds');
      return { id: r.id || `rule-${index}`, operation: r.operation, action: r.action, process: r.process ?? null, marker: r.marker ?? null, skip, remaining, delayMs, status: [429, 500, 504].includes(r.status) ? r.status : 429 };
    });
    append({ type: 'rules', rules });
  }
  function release(ids, status = 200) {
    if (![200, 429, 500, 504].includes(status)) throw Error('Invalid status');
    const released = [];
    for (const id of ids) { const item = waiting.get(id); if (item) { item.finish(status); released.push(id); } }
    return released;
  }
  const state = () => ({ testOnly: true, modelMode: 'mock/fault', calls: structuredClone(calls), rules: structuredClone(rules), waiting: [...waiting.keys()] });
  const server = http.createServer(async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method === 'GET' && req.url === '/state') return reply(200, state());
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 100_000) throw Error('Too large'); }
      const input = body ? JSON.parse(body) : {};
      if (req.method === 'POST' && req.url === '/rules') { setRules(input.rules); return reply(200, { accepted: true }); }
      if (req.method === 'POST' && req.url === '/release') return reply(200, { released: release(input.ids || [], input.status ?? 200) });
      if (req.method !== 'POST' || req.url !== '/gate') return reply(404, { error: 'Test route not found' });
      if (!allowedOperations.has(input.operation) || !['A', 'B'].includes(input.process) || !/^[0-9a-f]{64}$/.test(input.inputHash)) throw Error('Invalid receipt');
      const call = { id: `gate-${++serial}`, operation: input.operation, process: input.process, pid: input.pid, marker: input.marker,
        inputHash: input.inputHash, taskId: input.taskId, workerId: input.workerId, generation: input.generation,
        receivedAt: new Date().toISOString(), state: 'RECEIVED', status: null, finishedAt: null };
      calls.push(call); append({ type: 'received', call: { ...call } });
      let rule;
      for (const candidate of rules) {
        if (candidate.remaining < 1 || candidate.operation !== input.operation || (candidate.process && candidate.process !== input.process) || (candidate.marker && candidate.marker !== input.marker)) continue;
        if (candidate.skip > 0) { candidate.skip--; continue; }
        candidate.remaining--; rule = candidate; break;
      }
      const finish = (status) => {
        const item = waiting.get(call.id); if (item) clearTimeout(item.timeout);
        waiting.delete(call.id); call.state = 'RETURNED'; call.status = status; call.finishedAt = new Date().toISOString();
        append({ type: 'returned', call: { ...call } });
        if (!res.destroyed) reply(status, { testOnly: true, mock: true, id: call.id, outcome: status === 200 ? 'released' : 'controlled-failure', usage: null });
      };
      if (rule?.action === 'hold' || rule?.action === 'delay') {
        call.state = 'HELD'; call.ruleId = rule.id;
        const timeout = setTimeout(() => finish(rule.action === 'delay' ? 200 : 504), rule.action === 'delay' ? rule.delayMs : 180_000);
        waiting.set(call.id, { finish, timeout }); append({ type: 'held', call: { ...call } });
        return;
      }
      finish(rule?.action === 'fail' ? rule.status : 200);
    } catch (e) { if (!res.headersSent) reply(400, { error: e.message, testOnly: true }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(39555, '127.0.0.1', resolve); });
  return { state, setRules, release, async close() { release([...waiting.keys()], 504); await new Promise((resolve) => server.close(resolve)); }, server };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gate = await startFaultGate({ logPath: process.argv[2] });
  process.stdout.write('Test-only mock fault gate http://127.0.0.1:39555; POST /rules, GET /state, POST /release\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await gate.close(); process.exit(0); });
}
