import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { read, sha } from './phase2-client.mjs';
import { deriveRow } from './phase3-experiment.mjs';
export function distribution(values) {
  const available=values.filter(v=>typeof v==='number'&&Number.isFinite(v)).sort((a,b)=>a-b);
  const p=q=>available.length?available[Math.max(0,Math.ceil(available.length*q)-1)]:null;
  return {samples:available.length,unavailable:values.length-available.length,mean:available.length?available.reduce((a,b)=>a+b,0)/available.length:null,p50:p(.5),p95:p(.95)};
}
export function summarizeRows(rows) {
  const answerable=rows.filter(r=>r.answerable),refusals=rows.filter(r=>!r.answerable);
  return {samples:rows.length,failures:rows.filter(r=>r.error).length,errorRate:rows.length?rows.filter(r=>r.error).length/rows.length:null,
    recallAt5:distribution(answerable.map(r=>r.recallAtK??r.recallAt5??0)),mrr:distribution(answerable.map(r=>r.mrr??r.mrrAt5??0)),
    retrievalMs:distribution(rows.map(r=>r.retrievalMs)),totalMs:distribution(rows.map(r=>r.totalMs)),
    correctRefusals:refusals.filter(r=>!r.error&&r.abstentionCorrect===true).length,refusalSamples:refusals.length,
    answerCorrect:null,citationSupport:null,humanReviewed:0};
}
export function usageSummary(calls) {
  const kinds=[...new Set(calls.map(c=>c.kind))];
  return Object.fromEntries(kinds.map(kind=>{
    const group=calls.filter(c=>c.kind===kind);
    return [kind,Object.fromEntries(['promptTokens','completionTokens','totalTokens'].map(field=>{
      const known=group.map(c=>c.actual?.[field]).filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0);
      return [field,{available:known.length,unavailable:group.length-known.length,observedSum:known.length?known.reduce((a,b)=>a+b,0):null}];
    }))];
  }));
}
export function buildBaselineReport(root,plan,dataset) {
  const rows={rag:[],agent:[],auxiliaryHybrid:[]},rawSources=[],usage={rag:[],agent:[],auxiliaryHybrid:[]},pairs=[],taskCalls=[],pending=[],missingTaskAudits=[];
  const prefix=`Quality3-${sha(JSON.stringify(plan)).slice(0,12)}`;
  let auditedTasks=0;
  const capture=file=>rawSources.push({file,sha256:sha(readFileSync(file))});
  plan.caseIds.forEach((caseId,i)=>{
    const id=`q${String(i).padStart(3,'0')}`,pairFile=`${root}/${id}-pair.json`;
    const rf=`${root}/rag/${prefix}-${id}.raw.json`,af=`${root}/agent/${id}.raw.json`;
    const question=dataset.questions.find(q=>q.id===caseId);assert(question,'Registered question missing');
    const rag=existsSync(rf)?read(rf):null,agent=existsSync(af)?read(af):null;
    if(rag){
      capture(rf);assert(Array.isArray(rag.results),'RAG raw results missing');
      for(const row of rag.results){assert.equal(row.caseId,caseId,'Raw case identity differs');assert(['vector','hybrid'].includes(row.mode),'Unknown mode');const arm=row.mode==='vector'?'rag':'auxiliaryHybrid';rows[arm].push(row);usage[arm].push({kind:'generation',actual:{promptTokens:row.promptTokens,completionTokens:row.completionTokens}});for(const kind of ['embedding','rerank'])if(row.usage?.[kind])usage[arm].push({kind,actual:row.usage[kind]});}
      assert(new Set(rag.results.map(r=>r.mode)).size===rag.results.length,'Duplicate RAG mode');
    }
    if(agent){capture(af);rows.agent.push(deriveRow(agent,question));usage.agent.push(...(agent.result?.usage||[]));}
    const ragComplete=!!rag&&['COMPLETED','COMPLETED_WITH_ERRORS','SUCCEEDED'].includes(rag.status)&&rag.results.length===2;
    const agentComplete=!!agent&&['COMPLETED','FAILED','CANCELLED','INTERRUPTED'].includes(agent.status);
    const pair=existsSync(pairFile)?read(pairFile):null;
    if(pair){capture(pairFile);assert.equal(pair.caseId,caseId);assert(rag&&agent,'Pair references absent raw outputs');assert.equal(pair.rag.runId,rag.id);assert.equal(pair.agent.runId,agent.id);}
    if(pair&&ragComplete&&agentComplete)pairs.push(pair);
    else pending.push({caseId,ragRawPresent:!!rag,agentRawPresent:!!agent,ragComplete,agentComplete,pairJournalPresent:!!pair,
      note:'Not a completed pair. Any saved single-arm measurements are included below; outstanding/in-flight use is not assumed zero.'});
    for(const arm of ['rag','agent']){
      const stateFile=arm==='rag'?`${root}/rag/${prefix}-${id}.state.json`:`${root}/agent/${id}.state.json`;
      if(existsSync(stateFile))capture(stateFile);
      const taskFile=`${root}/tasks/${id}-${arm}.json`,run=arm==='rag'?rag:agent;
      if(existsSync(taskFile)){
        const task=read(taskFile);capture(taskFile);assert(Array.isArray(task.externalCalls),'Missing task call ledger');if(run)assert.equal(task.id,run.id,'Task audit belongs to another run');
        auditedTasks++;taskCalls.push(...task.externalCalls.map(c=>({...c,arm,caseId,kind:c.provider,actual:c.usage})));
      }else missingTaskAudits.push({caseId,arm,runId:run?.id??null,rawPresent:!!run});
    }
  });
  const expectedPairs=plan.caseIds.length,expectedTasks=expectedPairs*2;
  return {kind:'unreviewed-real-paired-baseline',runtime:plan.runtime,expectedPairs,savedPairs:pairs.length,complete:pairs.length===expectedPairs,humanReviewed:0,
    note:'Descriptive engineering metrics only; no human quality conclusion. Metrics include all available arm rows, even without a saved pair. Their denominator is observed rows, not the unfinished preregistered sample. Failures remain included. Missing arms and unaudited external use are unknown, never zero. Agent first-five acquisition-order recall differs from final reranked top-K.',
    coverage:{expectedPerArm:expectedPairs,ragRows:rows.rag.length,agentRows:rows.agent.length,auxiliaryHybridRows:rows.auxiliaryHybrid.length,pendingPairs:pending.length,pending},
    metrics:Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,summarizeRows(v)])),usage:Object.fromEntries(Object.entries(usage).map(([k,v])=>[k,usageSummary(v)])),
    taskAudit:{note:'Evaluation tasks include both vector and auxiliary hybrid. Ledger includes retries/unknowns and must not be added again to row usage. Missing audit records mean total calls/unknowns remain unavailable; observed fields cover saved records only. Indexing is outside these question tasks.',expectedTasks,auditedTasks,missingTaskAudits,complete:auditedTasks===expectedTasks,
      calls:auditedTasks===expectedTasks?taskCalls.length:null,unknownCalls:auditedTasks===expectedTasks?taskCalls.filter(c=>c.status!=='RETURNED').length:null,
      observedCalls:taskCalls.length,observedUnknownCalls:taskCalls.filter(c=>c.status!=='RETURNED').length,usage:usageSummary(taskCalls)},pairs,rawSources,rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [root,output]=process.argv.slice(2);assert(root&&output,'Usage: quality-baseline-report.mjs paired-directory NEW-output.json');
  const plan=read(`${root}/registration.json`),dataset=read('samples/phase3-quality/evaluation.json');
  assert.equal(sha(readFileSync('samples/phase3-quality/evaluation.json')),plan.datasetSha256);
  assert.equal(plan.caseIds.length,40,'Formal baseline must retain all 40 registered pairs');
  const report=buildBaselineReport(root,plan,dataset);
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
