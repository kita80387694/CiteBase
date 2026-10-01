import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {read,sha,client,immutable} from './phase2-client.mjs';
import {deriveRow} from './phase3-experiment.mjs';
import {distribution,summarizeRows,usageSummary} from './quality-baseline-report.mjs';
const terminal=new Set(['COMPLETED','FAILED','CANCELLED','INTERRUPTED']);
export function intents(plan,dataset){
 assert.equal(new Set(plan.caseIds).size,plan.caseIds.length,'Duplicate case');assert.equal(new Set(plan.strategies).size,plan.strategies.length,'Duplicate strategy');
 return plan.caseIds.flatMap(caseId=>{const question=dataset.questions.find(q=>q.id===caseId);assert(question&&['dev','validation'].includes(question.split),'Unknown or independent-test case');return plan.strategies.map(strategy=>({caseId,strategy,question,id:`${caseId}-${strategy}`}));});
}
export function summarizeExploration(root,plan,dataset,io={exists:existsSync,read,bytes:readFileSync}){
 const expected=intents(plan,dataset),rawSources=[],rows=[],pending=[],audits=[],missingAudits=[];
 const capture=file=>rawSources.push({file,sha256:sha(io.bytes(file))});
 for(const intent of expected){const file=`${root}/runs/${intent.id}.raw.json`,stateFile=`${root}/runs/${intent.id}.state.json`,auditFile=`${root}/tasks/${intent.id}.json`;
  const run=io.exists(file)?io.read(file):null,state=io.exists(stateFile)?io.read(stateFile):null;if(state)capture(stateFile);
  if(run){capture(file);assert.equal(run.request.strategy??'original',intent.strategy,'Strategy identity mismatch');assert.equal(run.config.agentStrategy??'original',intent.strategy,'Strategy configuration mismatch');assert.equal(run.request.question,intent.question.question,'Question identity mismatch');assert.equal(run.config.modelMode,'real','Mock cannot enter real report');if(state?.runId)assert.equal(state.runId,run.id,'Journal run mismatch');}
  if(run&&terminal.has(run.status)){const row={...deriveRow(run,intent.question),strategy:intent.strategy};rows.push(row);}
  else pending.push({caseId:intent.caseId,strategy:intent.strategy,runId:run?.id??state?.runId??null,status:run?.status??state?.status??'NOT_SAVED',note:'Unfinished intent, not success or zero usage'});
  if(io.exists(auditFile)){const task=io.read(auditFile);capture(auditFile);assert.equal(task.id,run?.id??state?.runId,'Audit identity mismatch');assert(['SUCCEEDED','FAILED','CANCELLED'].includes(task.status),'Task audit must be terminal');assert(Array.isArray(task.externalCalls));audits.push({caseId:intent.caseId,strategy:intent.strategy,calls:task.externalCalls});}
  else missingAudits.push({caseId:intent.caseId,strategy:intent.strategy,runId:run?.id??state?.runId??null});
 }
 const arms={};for(const strategy of plan.strategies){const subset=rows.filter(r=>r.strategy===strategy),waiting=pending.filter(r=>r.strategy===strategy),missing=missingAudits.filter(r=>r.strategy===strategy),calls=audits.filter(r=>r.strategy===strategy).flatMap(a=>a.calls.map(c=>({kind:c.provider,actual:c.usage,status:c.status}))),failures=subset.filter(r=>r.error).length;
  const reasons={};for(const r of subset){const reason=r.error||r.status;reasons[reason]=(reasons[reason]||0)+1;}
  arms[strategy]={intended:plan.caseIds.length,terminal:subset.length,pending:waiting.length,failures,complete:waiting.length===0,
   failureRate:waiting.length?null:failures/plan.caseIds.length,observedTerminalFailureRate:subset.length?failures/subset.length:null,terminalReasons:reasons,
   observedTerminalMetrics:summarizeRows(subset),counts:Object.fromEntries(['tools','searches','plannerSteps','externalCalls'].map(k=>[k,distribution(subset.map(r=>r.budgetUsed?.[k]))])),
   returnedResultUsage:usageSummary(subset.flatMap(r=>r.usage||[])),taskAudit:{expected:plan.caseIds.length,available:plan.caseIds.length-missing.length,missing:missing.length,complete:!missing.length,totalExternalCalls:missing.length?null:calls.length,unknownExternalCalls:missing.length?null:calls.filter(c=>c.status!=='RETURNED').length,observedCalls:calls.length,observedUnknownCalls:calls.filter(c=>c.status!=='RETURNED').length,actualUsage:usageSummary(calls)},humanCorrectness:null,humanCitationSupport:null};
 }
 return{kind:'exploratory-agent-engineering-report',registrationSha256:sha(JSON.stringify(plan)),runtime:plan.runtime,expectedRuns:expected.length,terminalRuns:rows.length,complete:pending.length===0,arms,pending,missingAudits,rows,rawSources,humanReviewed:0,humanCorrectness:null,humanCitationSupport:null,qualityConclusion:null,selectedStrategy:null,defaultChange:false,
  definitions:{population:'Every preregistered case × strategy intent is retained. Missing/active runs stay pending. Full-intent failureRate is null until all intended runs finish; observedTerminalFailureRate uses only terminal runs.',metrics:'Automatic evidence recall/MRR are retrieval aids, not answer quality. Failed terminal runs remain included. First-five Agent acquisition order is not final reranked top-K. Latency uses available terminal result values; unknown observations explicitly counted; P50/P95 nearest rank.',counts:'tools/searches/plannerSteps/externalCalls are execution budget counters, not estimates of tokens or billable amounts. Task ledger is a separate provider-call audit; do not add ledger usage to result usage.',usage:'Only returned provider values summed; missing fields remain unavailable. Missing task snapshots mean total and unknown external calls are null. Result usage can omit an in-flight crash window; use task audit coverage and unknown calls.',scope:'Development/validation exploratory ablation only; no independent-test access, no human assessment, no winner or default selection.'}};
}
export async function auditExploration(api,root,plan,dataset){
 const targets=intents(plan,dataset),pending=[];let saved=0,existing=0;mkdirSync(`${root}/tasks`,{recursive:true});
 for(const target of targets){const rawFile=`${root}/runs/${target.id}.raw.json`,stateFile=`${root}/runs/${target.id}.state.json`,file=`${root}/tasks/${target.id}.json`;const run=existsSync(rawFile)?read(rawFile):null,state=existsSync(stateFile)?read(stateFile):null;const runId=run?.id??state?.runId;if(run&&state?.runId)assert.equal(run.id,state.runId);if(!runId){pending.push({...target,question:undefined,reason:'No saved run identity'});continue;}
  if(existsSync(file)){const old=read(file);assert.equal(old.id,runId);assert(['SUCCEEDED','FAILED','CANCELLED'].includes(old.status));assert(Array.isArray(old.externalCalls));existing++;continue;}
  const task=await api.request(`/api/tasks/${runId}`);assert.equal(task.id,runId);assert(Array.isArray(task.externalCalls));if(!['SUCCEEDED','FAILED','CANCELLED'].includes(task.status)){pending.push({caseId:target.caseId,strategy:target.strategy,runId,status:task.status});continue;}immutable(file,task);saved++;
 }
 return{saved,existing,pending,modelCallsSubmitted:0,note:'GET task audit only; existing raw/audits never overwritten'};
}
async function main(){const[command,root,output]=process.argv.slice(2);assert(['report','audit'].includes(command)&&root,'Usage: quality-agent-report.mjs report ROOT NEW-output.json | audit ROOT');const plan=read(`${root}/registration.json`),bytes=readFileSync('samples/phase3-quality/evaluation.json'),dataset=JSON.parse(bytes);assert.equal(sha(bytes),plan.datasetSha256);assert.equal(plan.caseIds.length*plan.strategies.length,32,'Formal exploration has 32 frozen intents');if(command==='audit'){console.log(JSON.stringify(await auditExploration(await client(),root,plan,dataset)));return;}assert(output,'New report output path required');writeFileSync(output,JSON.stringify(summarizeExploration(root,plan,dataset),null,2)+'\n',{flag:'wx'});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
