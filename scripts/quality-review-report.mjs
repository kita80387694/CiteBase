import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const dimensions = ['correctness','completeness','citationSupport','unsupportedContent','refusal'];
export function summarizeReviews(project, pairs) {
  const sourceKey = s => `${s.kind}:${s.runId}:${s.caseId||''}:${s.mode||''}`;
  const index = new Map(project.items.map(i => [sourceKey(i.source),i]));
  const activeAssignments = new Set(project.assignments.filter(a => !a.revoked).map(a=>a.id));
  const latest = new Map(), adjudications = new Map();
  // Owner export preserves database sequence_id order, including append-only revisions.
  for (const [eventIndex,event] of project.scores.entries()) {
    if (event.payload?.withdrawn) continue;
    if (event.kind === 'HUMAN' && activeAssignments.has(event.assignmentId)) latest.set(event.assignmentId,{...event,eventIndex});
    if (event.kind === 'ADJUDICATION') adjudications.set(event.itemId,{...event,eventIndex});
  }
  const arms = Object.fromEntries(['rag','agent'].map(a => [a,{intended:0,withdrawn:0,unreviewed:0,disputed:0,resolved:0,dimensions:Object.fromEntries(dimensions.map(d=>[d,{}]))}]));
  const rows=[];
  for (const pair of pairs) {
    const row={caseId:pair.caseId};
    for (const arm of ['rag','agent']) {
      const item=index.get(sourceKey(pair[arm]));assert(item,`Missing review source for ${pair.caseId}:${arm}`);
      const stats=arms[arm]; stats.intended++;
      if(item.status!=='AVAILABLE'){stats.withdrawn++;row[arm]={status:'WITHDRAWN',score:null};continue;}
      const events=[...latest.values()].filter(e=>e.itemId===item.id);
      if(!events.length){stats.unreviewed++;row[arm]={status:'UNREVIEWED',score:null};continue;}
      const signatures=new Set(events.map(e=>JSON.stringify(dimensions.map(d=>e.payload[d]))));
      const adjudication=adjudications.get(item.id);
      const currentAdjudication=adjudication && adjudication.eventIndex>Math.max(...events.map(e=>e.eventIndex));
      const decision=(currentAdjudication?adjudication.payload:null) || (signatures.size===1?events[0].payload:null);
      if(!decision){stats.disputed++;row[arm]={status:'DISPUTED',score:null};continue;}
      stats.resolved++;
      for(const d of dimensions){const value=decision[d];assert(value,'Incomplete score');stats.dimensions[d][value]=(stats.dimensions[d][value]||0)+1;}
      row[arm]={status:'RESOLVED',score:Object.fromEntries(dimensions.map(d=>[d,decision[d]]))};
    }
    rows.push(row);
  }
  return {kind:'authenticated-review-analysis',humanIdentityVerified:false,
    warning:'Account submissions alone do not prove human or independent review. Automated fixtures cannot count toward acceptance; actual reviewer confirmation is required.',
    arms,rows,pairedResolved:rows.filter(r=>r.rag.status==='RESOLVED'&&r.agent.status==='RESOLVED').length,
    definitions:'One result per item: latest live assignment scores; unanimous dimensions or owner adjudication newer than all latest live scores in append-only export sequence. A later human revision invalidates an earlier adjudication. Disagreements unresolved remain null; NA remains a category, never correct. Withdrawn, unreviewed and disputed coverage reported separately.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [projectFile,pairsFile,output]=process.argv.slice(2);assert(projectFile&&pairsFile&&output,'Usage: quality-review-report.mjs owner-export.json pairs.json NEW-output.json');
  const report=summarizeReviews(JSON.parse(readFileSync(projectFile)),JSON.parse(readFileSync(pairsFile)));
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
