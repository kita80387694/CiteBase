import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function distribution(values){
 assert(values.every(v=>Number.isFinite(v)&&v>=0),'Invalid duration');
 if(!values.length)return {sampleCount:0,meanMs:null,p50Ms:null,p95Ms:null};
 const sorted=[...values].sort((a,b)=>a-b);
 return {sampleCount:sorted.length,meanMs:sorted.reduce((a,b)=>a+b,0)/sorted.length,p50Ms:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1]};
}
function max(values){const finite=values.filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0);return finite.length?Math.max(...finite):null;}
function taskWait(row){
 const r=row.result;if(!row.taskId||!r?.createdAt||!r?.startedAt)return null;
 const ms=Date.parse(r.startedAt)-Date.parse(r.createdAt);assert(Number.isFinite(ms)&&ms>=0,'Invalid task queue timestamp');return ms;
}
function summarize(rows){
 if(!rows.length)return {samples:0,failures:0,errorRate:null,windowSeconds:null,completedPerSecond:null,successfulPerSecond:null,latency:distribution([]),queueWait:distribution([]),queueWaitUnavailable:0};
 const starts=rows.map(r=>Date.parse(r.startedAt));
 assert(starts.every(Number.isFinite));assert(rows.every(r=>typeof r.success==='boolean'&&Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0));
 const seconds=(Math.max(...rows.map((r,i)=>starts[i]+r.elapsedMs))-Math.min(...starts))/1000;assert(seconds>0);
 const failures=rows.filter(r=>!r.success).length,waits=rows.filter(r=>r.taskId).map(taskWait);
 return {samples:rows.length,failures,errorRate:failures/rows.length,windowSeconds:seconds,completedPerSecond:rows.length/seconds,successfulPerSecond:(rows.length-failures)/seconds,latency:distribution(rows.map(r=>r.elapsedMs)),queueWait:distribution(waits.filter(v=>v!==null)),queueWaitUnavailable:waits.filter(v=>v===null).length};
}
export function resourceSummary(points){
 const processCount=Math.max(0,...points.map(p=>p.processes?.length??0));
 const self=points.filter(p=>p.summary?.scope==='SELF');
 const selfKinds=['INDEX','AGENT','EVALUATION'].map(kind=>{
  const rows=self.flatMap(p=>(p.summary.kinds??[]).filter(k=>k.kind===kind));
  return {kind,samples:rows.length,...Object.fromEntries(['queued','retryWait','running','cancelRequested','activeLeases','oldestQueuedAgeMs'].map(field=>[field+'SampledMax',max(rows.map(r=>r[field]))]))};
 });
 return {samples:points.length,selfScope:'SELF (harness authenticated user; database-wide across its tasks, not per JVM)',selfKinds,databaseConnectionsMax:max(points.map(p=>p.databaseConnections)),processes:Array.from({length:processCount},(_,index)=>{
  const process=points.map(p=>p.processes?.[index]).filter(Boolean);
  const gauge=name=>process.flatMap(p=>(p.metrics??[]).filter(m=>m.name===name).map(m=>m.values?.VALUE));
  return {position:index,endpoint:index===0?'127.0.0.1:28083':index===1?'127.0.0.1:28084':null,samples:process.length,heapUsedBytesMax:max(process.map(p=>p.heapUsedBytes)),heapMaxBytes:max(process.map(p=>p.heapMaxBytes)),processCpuLoadMax:max(process.map(p=>p.processCpuLoad)),activeTasksSampledMax:max(gauge('citebase.tasks.active')),poolActiveSampledMax:max(gauge('hikaricp.connections.active')),poolPendingSampledMax:max(gauge('hikaricp.connections.pending'))};})};
}
export function buildOperationsReport(raw,rows,resources){
 assert(raw.modelMode==='mock/fault-test-only','This reporter requires explicitly controlled mock evidence');
 const measured=rows.filter(r=>r.phase==='measurement');
 assert(rows.every(r=>['warmup','measurement'].includes(r.phase)),'Unknown sample phase');
 const expected=raw.registration?.load?.concurrency??[];
 assert(measured.every(r=>expected.includes(r.level)),'Unexpected concurrency level');
 const levels=expected.map(level=>{
  const subset=measured.filter(r=>r.level===level),stats=summarize(subset);
  const low=subset.length?Math.min(...subset.map(r=>Date.parse(r.startedAt))):null;
  const high=subset.length?Math.max(...subset.map(r=>Date.parse(r.startedAt)+r.elapsedMs)):null;
  const points=resources.filter(p=>low!==null&&Date.parse(p.at)>=low&&Date.parse(p.at)<=high);
  return {concurrency:level,...stats,byKind:Object.fromEntries(['INDEX','RAG','AGENT','EVALUATION'].map(kind=>[kind,summarize(subset.filter(r=>r.kind===kind))])),resources:resourceSummary(points)};
 });
 return {schema:'quality-operations-report-v1',generatedAt:new Date().toISOString(),harnessStatus:raw.status,modelMode:raw.modelMode,sourceBuild:raw.source?.sha256??null,registration:raw.registration,loadComplete:expected.length>0&&levels.every(l=>l.samples>0)&&raw.status==='PASSED',rawRows:rows.length,warmupRows:rows.length-measured.length,measurementRows:measured.length,levels,resources:resourceSummary(resources),recovery:(raw.checks??[]).filter(c=>typeof c.evidence?.recoveryMs==='number').map(c=>({check:c.name,passed:c.passed,recoveryMs:c.evidence.recoveryMs,definition:'Harness-observed restoration until asserted task completion; not inferred from API health'})),checks:raw.checks,qualityConclusion:null,limitations:[
  'Closed-loop concurrency; arrivals slow when response times rise. This is not open-loop offered-load capacity or proof against coordinated omission.',
  'All model calls use a controlled mock/fault adapter; throughput does not measure DeepSeek and provides no human quality conclusion.',
  'All failed measurement rows remain in latency, error and completion denominators. Throughput window spans earliest submission to latest completion including drain.',
  'Queue wait is first task createdAt to startedAt, only when both were observed; synchronous RAG has no durable task queue sample.',
  'Resources are sampled maxima, not strict concurrency or peak-memory proofs. Per-process position follows fixed endpoint order and may aggregate process restarts.',
  'PostgreSQL connection snapshots include the observing SQL connection. Resource points are assigned to a level only when their timestamp falls within its measured operation window.',
  'P50/P95 use nearest rank, unlike the online SELF API percentile_cont. Recovery durations are reported only for explicitly recorded harness evidence.',
  'SELF queue and lease maxima are authenticated-user database snapshots; they are not per-JVM metrics or strict peak/backpressure proofs.',
  'Missing resource values remain null. Failure runs and partial files remain valid incomplete evidence, not a successful acceptance result.'
 ]};
}
function jsonl(file){if(!fs.existsSync(file))return [];const lines=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(s=>s.trim());return lines.map((s,i)=>{try{return JSON.parse(s);}catch{throw Error(`Malformed JSONL ${file}:${i+1}; preserve and repair source collection, do not silently drop failed rows`);}});}
export function writeOperationsReport(directory,output){
 const input=['report.json','load-samples.jsonl','resource-samples.jsonl'];
 const raw=JSON.parse(fs.readFileSync(path.join(directory,input[0]),'utf8'));
 const report=buildOperationsReport(raw,jsonl(path.join(directory,input[1])),jsonl(path.join(directory,input[2])));
 report.inputs=Object.fromEntries(input.map(name=>{const file=path.join(directory,name);return [name,fs.existsSync(file)?{sha256:sha(fs.readFileSync(file)),bytes:fs.statSync(file).size}:null];}));
 report.reporterSha256=sha(fs.readFileSync(fileURLToPath(import.meta.url)));
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert(process.argv.length===4,'Usage: node scripts/quality-operations-report.mjs RAW_DIRECTORY NEW_REPORT_JSON');
 const result=writeOperationsReport(process.argv[2],process.argv[3]);console.log(JSON.stringify({harnessStatus:result.harnessStatus,measurementRows:result.measurementRows,output:process.argv[3]}));
}
