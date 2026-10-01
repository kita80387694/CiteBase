import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {distribution,resourceSummary,buildOperationsReport,writeOperationsReport} from './quality-operations-report.mjs';
const raw={status:'PASSED',modelMode:'mock/fault-test-only',registration:{load:{concurrency:[1]}},checks:[]};
const rows=[{level:1,phase:'measurement',kind:'RAG',startedAt:'2026-10-01T00:00:02Z',elapsedMs:1000,success:true},{level:1,phase:'measurement',kind:'AGENT',taskId:'a',startedAt:'2026-10-01T00:00:00Z',elapsedMs:6000,success:false,result:{createdAt:'2026-10-01T00:00:00Z',startedAt:'2026-10-01T00:00:01Z'}},{level:1,phase:'warmup',kind:'RAG',startedAt:'2026-10-01T00:00:00Z',elapsedMs:90000,success:true}];
test('failed samples retained; warmup excluded; completion order cannot shorten window',()=>{
 const result=buildOperationsReport(raw,rows,[]),level=result.levels[0];
 assert.equal(level.samples,2);assert.equal(level.failures,1);assert.equal(level.errorRate,.5);assert.equal(level.windowSeconds,6);assert.equal(level.completedPerSecond,2/6);assert.equal(level.latency.p95Ms,6000);assert.equal(level.queueWait.meanMs,1000);assert.equal(result.measurementRows,2);assert.equal(result.resources.databaseConnectionsMax,null);
});
test('resource max accepts actual zero and preserves unknown; multiple JVMs distinct',()=>{
 const result=resourceSummary([{databaseConnections:4,processes:[{processCpuLoad:null,heapUsedBytes:100,metrics:[{name:'citebase.tasks.active',values:{VALUE:0}}]},{processCpuLoad:.5,heapUsedBytes:200,metrics:[]}]},{databaseConnections:7,processes:[{processCpuLoad:0,heapUsedBytes:90,metrics:[{name:'citebase.tasks.active',values:{VALUE:1}}]}]}]);
 assert.equal(result.databaseConnectionsMax,7);assert.equal(result.processes[0].processCpuLoadMax,0);assert.equal(result.processes[0].activeTasksSampledMax,1);assert.equal(result.processes[1].poolActiveSampledMax,null);assert.equal(result.processes[1].heapUsedBytesMax,200);
});
test('partial runs do not pass and unobserved recovery is not fabricated',()=>{
 const result=buildOperationsReport({...raw,status:'FAILED',registration:{load:{concurrency:[1,2]}},checks:[{name:'unobserved',evidence:{}},{name:'DB restore',passed:true,evidence:{recoveryMs:123}}]},rows,[]);
 assert.equal(result.loadComplete,false);assert.equal(result.levels[1].latency.meanMs,null);assert.equal(result.recovery.length,1);assert.equal(result.recovery[0].recoveryMs,123);assert.equal(distribution([]).p95Ms,null);assert.throws(()=>distribution([-1]));
});
test('writer hashes inputs, refuses overwrite and malformed JSONL rather than dropping it',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'citebase-report-'));
 try{
 fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(raw));fs.writeFileSync(path.join(dir,'load-samples.jsonl'),rows.map(JSON.stringify).join('\n'));
 const out=path.join(dir,'derived.json');const report=writeOperationsReport(dir,out);assert.match(report.inputs['report.json'].sha256,/^[a-f0-9]{64}$/);assert.equal(report.inputs['resource-samples.jsonl'],null);assert.throws(()=>writeOperationsReport(dir,out),/EEXIST/);
 fs.writeFileSync(path.join(dir,'resource-samples.jsonl'),'{broken');assert.throws(()=>writeOperationsReport(dir,path.join(dir,'new.json')),/Malformed JSONL/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('SELF backlog maxima preserve missing null and actual zero without accepting other scopes',()=>{
 const result=resourceSummary([
  {summary:{scope:'SELF',kinds:[{kind:'INDEX',queued:0,running:1,retryWait:0,oldestQueuedAgeMs:null}]}},
  {summary:{scope:'SELF',kinds:[{kind:'INDEX',queued:3,running:0,retryWait:2,oldestQueuedAgeMs:2500}]}},
  {summary:{scope:'LOCAL_PROCESS',kinds:[{kind:'AGENT',queued:99}]}},
  {}
 ]);
 const index=result.selfKinds.find(k=>k.kind==='INDEX'),agent=result.selfKinds.find(k=>k.kind==='AGENT');
 assert.equal(index.queuedSampledMax,3);assert.equal(index.retryWaitSampledMax,2);assert.equal(index.runningSampledMax,1);assert.equal(index.oldestQueuedAgeMsSampledMax,2500);assert.equal(index.activeLeasesSampledMax,null);
 assert.equal(agent.samples,0);assert.equal(agent.queuedSampledMax,null);
 const zero=resourceSummary([{summary:{scope:'SELF',kinds:[{kind:'INDEX',queued:0}]}}]);assert.equal(zero.selfKinds[0].queuedSampledMax,0);
});
