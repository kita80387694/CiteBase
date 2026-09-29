import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {read,sha,immutable} from './phase2-client.mjs';
import {buildReport,agentSummary,markdown,verifyCollectedCase} from './phase3-report.mjs';
import {deriveRow} from './phase3-experiment.mjs';
const parent=process.argv[2]||'docs/results/phase3-v2';
const root=`${parent}/provider-recovery`;
const original=buildReport(parent),registration=read(`${root}/registration.json`);
const replacements=new Map(),attempts=[];
for(const task of registration.tasks){
  assert.equal(sha(readFileSync(task.originalFile)),task.originalSha256);
  const id=`${task.question.id}-${task.mode}`,file=`${root}/runs/${id}.raw.json`;
  const run=read(file),state=read(`${root}/runs/${id}.state.json`);
  assert.equal(sha(readFileSync(file)),state.rawSha256);
  verifyCollectedCase(state,run,task.question,task.mode,{...original.registration,frozenAt:registration.frozenAt});
  const row=deriveRow(run,task.question);
  assert.notEqual(row.error,'PROVIDER_ERROR','Provider still failed; do not declare restoration complete');
  replacements.set(task.originalRunId,{...row,recoveryOriginalRunId:task.originalRunId});
  attempts.push({file,sha256:state.rawSha256,originalFile:task.originalFile,originalSha256:task.originalSha256});
}
assert.equal(replacements.size,46);
const rows=original.rows.map(row=>replacements.get(row.rawRunId)||row);
assert.equal(rows.length,104);
assert.equal(original.rows.filter(row=>row.error==='PROVIDER_ERROR').length,46);
const report={...original,generatedAt:new Date().toISOString(),acceptanceStatus:'PROVIDER_RESTORED_COMPOSITE_COMPLETE',
  kind:'composite-provider-restoration-not-an-uninterrupted-run',externalBlocker:null,
  historicalBlocker:original.externalBlocker, recoveryRegistration:registration, recoveryInputs:attempts,
  originalAttemptSummary:original.agent,recoveryAttemptSummary:agentSummary([...replacements.values()]),
  allPaidAttemptsUsageAndFailures:agentSummary([...original.rows,...replacements.values()]),
  rows,agent:agentSummary(rows),paired:original.paired.map(pair=>{
    const row=rows.find(r=>r.caseId===pair.caseId&&r.mode===pair.mode);
    return {...pair,agentStatus:row.status,agentError:row.error,agentRecallAt5:row.recallAt5,
      agentAccumulatedRecall:row.accumulatedRecall,agentMrrAt5:row.mrrAt5,agentTotalMs:row.totalMs};
  }),limitations:[
    'Composite: 58 original non-provider-error rows plus 46 separately registered recovered rows. Original104 and all recovery attempts remain immutable. Original21 budget/loop failures are not retried or removed.',
    'Effective-row latency excludes earlier failed attempts. All150 attempt usage/failures are separately reported; observed usage is not complete billing, and unknown original calls may have been billed.',
    ...original.limitations]};
immutable(`${root}/report.json`,report);
immutable(`${root}/resolution.json`,{resolvedAt:report.generatedAt,originalAttempts:104,recoveryAttempts:46,originalFilesUnchanged:true,report:`${root}/report.json`,state:report.acceptanceStatus});
const {writeFileSync}=await import('node:fs');
writeFileSync(`${root}/report.md`,'# 供应商恢复后的组合报告\n\n58条原记录 + 46条单独补测；原104条及全部补测均保留。未重跑预算/循环失败。完整150次尝试成本覆盖见JSON，表中延迟只统计有效组合行。\n\n'+markdown(report),{flag:'wx'});
console.log(JSON.stringify({path:`${root}/report.json`,agent:report.agent},null,2));
