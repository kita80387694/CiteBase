import assert from 'node:assert/strict';
import {readdirSync,readFileSync,mkdirSync,writeFileSync}from'node:fs';
import {pathToFileURL}from'node:url';
import {read,sha}from'./phase2-client.mjs';
import {BUDGET}from'./phase3-experiment.mjs';
const terminal=new Set(['COMPLETED','FAILED','CANCELLED','INTERRUPTED']);
export function auditRun(run,freeze){
 const issues=[],warnings=[];
 const check=(condition,code)=>{if(!condition)issues.push(code);};
 const same=(a,b,code)=>{try{assert.deepEqual(a,b);}catch{issues.push(code);}};
 check(terminal.has(run.status),'NONTERMINAL_RAW');same(run.config,freeze.serverConfig,'CONFIG_DRIFT');same(run.snapshot,freeze.snapshot,'SNAPSHOT_DRIFT');
 same(run.request.budget,freeze.budget,'BUDGET_CONFIG_DRIFT');same(run.request.retrievalOptions,freeze.options,'OPTIONS_DRIFT');
 check(run.request.topK===5,'TOPK_DRIFT');check(Date.parse(run.createdAt)>=Date.parse(freeze.frozenAt),'PREDATES_FREEZE');
 for(const[key,hard]of Object.entries(BUDGET))check(Number.isInteger(run.request.budget?.[key])&&run.request.budget[key]>=1&&run.request.budget[key]<=hard,`INVALID_HARD_LIMIT:${key}`);
 const r=run.result;
 if(!r){check(run.status!=='COMPLETED','COMPLETED_MISSING_RESULT');warnings.push('NO_PARTIAL_RESULT_AVAILABLE');return{runId:run.id,status:run.status,issues,warnings};}
 check(r.modelMode==='real','MOCK_RESULT');check(r.answerCorrect===null,'HUMAN_SCORE_NOT_NULL');
 check(r.mode===run.request.mode,'MODE_MISMATCH');same(r.retrievalOptions,freeze.options,'RESULT_OPTIONS_DRIFT');
 if(run.status==='COMPLETED'){check(run.errorCode==null&&r.error==null,'SUCCESS_WITH_ERROR');check(r.citationValid===true,'SUCCESS_INVALID_CITATION');}
 else{check(typeof run.errorCode==='string'&&run.errorCode.length>0,'FAILED_NO_ERROR');check(r.error===run.errorCode,'FAILURE_ERROR_MISMATCH');check(r.citationValid===false&&r.abstained===true,'FAILURE_PRESENTED_AS_ANSWER');}
 const evidence=r.evidence||[],ids=new Set(evidence.map(e=>e.id));check(ids.size===evidence.length,'DUPLICATE_EVIDENCE');
 const redacted=(run.status==='CANCELLED'&&run.errorCode==='CANCELLED')||(run.status==='FAILED'&&run.errorCode==='SOURCE_CHANGED');
 if(redacted){check(evidence.length===0&&(r.citations||[]).length===0,'REVOKED_RESULT_EXPOSES_EVIDENCE');check(r.answer==='','REVOKED_RESULT_EXPOSES_ANSWER');}
 for(const citation of r.citations||[]){const id=typeof citation==='string'?citation:citation.id;check(ids.has(id),'FOREIGN_CITATION');if(typeof citation==='object')same(citation,evidence.find(e=>e.id===id),'CITATION_PAYLOAD_MISMATCH');}
 const snapshot=new Map(run.snapshot.map(v=>[v.id,v.version_id]));for(const e of evidence)check(snapshot.get(e.documentId)===e.versionId,'FOREIGN_EVIDENCE_VERSION');
 const used=r.budgetUsed||{};
 for(const[field,limit]of Object.entries({plannerSteps:'maxPlannerSteps',tools:'maxTools',searches:'maxSearch',externalCalls:'maxExternalCalls',evidenceCount:'maxEvidence',evidenceChars:'maxEvidenceChars'}))check(Number.isInteger(used[field])&&used[field]>=0&&used[field]<=run.request.budget[limit],`BUDGET_OVERRUN:${field}`);
 if(!redacted){check(used.evidenceCount===evidence.length,'EVIDENCE_COUNT_MISMATCH');check(used.evidenceChars===evidence.reduce((sum,e)=>sum+e.text.length,0),'EVIDENCE_CHARS_MISMATCH');}
 const steps=run.steps||[];same(steps.map(s=>s.sequence),steps.map((_,i)=>i+1),'STEP_SEQUENCE_GAP');
 for(const step of steps){check(['tool','planner','generation'].includes(step.kind),'UNKNOWN_STEP_KIND');if(step.kind!=='generation')check(['search','neighbors','inspectCitation','finish'].includes(step.action)||(step.kind==='planner'&&step.action==='decision'&&step.status==='FAILED'&&typeof step.output?.error==='string'&&step.output.error.length>0),'UNKNOWN_ACTION');check(typeof step.elapsedMs==='number'&&step.elapsedMs>=0,'INVALID_STEP_TIME');}
 check(steps.filter(s=>s.kind==='tool').length<=used.tools,'TOOL_TRACE_EXCEEDS_BUDGET_COUNT');check(steps.filter(s=>s.kind==='planner').length<=used.plannerSteps,'PLANNER_TRACE_EXCEEDS_BUDGET_COUNT');check(steps.filter(s=>s.kind==='tool'&&s.action==='search').length<=used.searches,'SEARCH_TRACE_EXCEEDS_BUDGET_COUNT');check(steps.filter(s=>s.kind==='generation').length<=1,'MULTIPLE_FINAL_GENERATIONS');
 const callIds=steps.filter(s=>s.kind==='planner').map(s=>s.output?.callId).filter(Boolean);check(new Set(callIds).size===callIds.length,'REPEATED_COMPLETED_TOOL_CALL_ID');
 const acquired=new Set(steps.filter(s=>s.kind==='tool').flatMap(s=>[...(s.output?.evidenceIds||[]),...(s.status==='FAILED'&&s.output?.error==='BUDGET_EXCEEDED'?s.output?.acceptedEvidenceIds||[]:[])]));for(const id of ids)check(acquired.has(id),'RESULT_EVIDENCE_NOT_IN_EXECUTED_TOOL');
 for(const usage of r.usage||[]){check(['embedding','rerank','planner','generation'].includes(usage.kind),'UNKNOWN_USAGE_KIND');for(const field of ['promptTokens','completionTokens','totalTokens']){const value=usage.actual?.[field];check(value==null||Number.isInteger(value)&&value>=0,'INVALID_ACTUAL_USAGE');}const output=usage.actual?.completionTokens;if(output!=null&&['planner','generation'].includes(usage.kind))check(output<=run.request.budget[usage.kind==='planner'?'maxPlannerOutputTokens':'maxFinalOutputTokens'],'OUTPUT_TOKEN_LIMIT_EXCEEDED');}
 if(r.inFlightUsageUnavailable===true)warnings.push('PROVIDER_USAGE_IN_FLIGHT_UNAVAILABLE');
 if(r.totalMs>run.request.budget.deadlineSeconds*1000+2000)warnings.push('ELAPSED_EXCEEDS_DEADLINE_PLUS_2S_REQUIRES_REVIEW');
 return{runId:run.id,status:run.status,errorCode:run.errorCode,partialEvidenceCount:run.status==='COMPLETED'?null:evidence.length,issues,warnings};
}
export function auditDirectory(root,complete=false){
 const freeze=read(`${root}/registration.json`),files=readdirSync(`${root}/test`).filter(f=>f.endsWith('.raw.json')).sort(),entries=[];
 const expected=read('samples/phase2/test.json').questions.flatMap(q=>['vector','hybrid'].map(mode=>`${q.id}-${mode}.raw.json`)).sort();
 if(complete)assert.deepEqual(files,expected,'Full audit requires exact104 raw case/mode files');
 for(const file of files){assert(expected.includes(file),'Unknown raw filename');const path=`${root}/test/${file}`;const bytes=readFileSync(path);const run=JSON.parse(bytes);entries.push({file:path,sha256:sha(bytes),...auditRun(run,freeze)});}
 return{kind:'engineering-trace-audit',generatedAt:new Date().toISOString(),complete,expectedRuns:104,observedRuns:entries.length,issueCount:entries.reduce((sum,x)=>sum+x.issues.length,0),warningCount:entries.reduce((sum,x)=>sum+x.warnings.length,0),entries,limitations:['Read-only static audit of saved terminal raw records; no model calls, quality selection or human scoring.','Provider concurrency and authorization require dedicated runtime tests; trace consistency alone cannot prove them.','No mutable state files read. In-flight files absent from this fixed inventory are not failures.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const root=process.argv[2]||'docs/results/phase3-v2';const result=auditDirectory(root,process.argv.includes('--complete'));mkdirSync(`${root}/audits`,{recursive:true});const path=`${root}/audits/traces-${Date.now()}.json`;writeFileSync(path,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({path,runs:result.observedRuns,issues:result.issueCount,warnings:result.warningCount}));if(result.issueCount)process.exitCode=1;}
