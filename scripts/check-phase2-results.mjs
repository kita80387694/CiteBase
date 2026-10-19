import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {retrievalMetrics} from './phase2-metrics.mjs';
const root=process.argv[2]||'docs/results/phase2/optimization',scope=process.argv[3]||'dev';
assert(['dev','all'].includes(scope),'Usage: check-phase2-results.mjs [suite-directory] [dev|all]');
if(scope==='all')assert(existsSync(root+'/final-configuration.json'),'Freeze before reading holdout results');
const suite=JSON.parse(readFileSync(root+'/suite.json'));let count=0;const inputs=[];
for(const v of Object.values(suite.variants)){
 if(scope==='dev'&&v.id.startsWith('test-'))continue;
 const bytes=readFileSync(v.rawFile),run=JSON.parse(bytes);assert.equal(run.modelMode,'real','This check records real experiments only');
 inputs.push({file:v.rawFile,sha256:createHash('sha256').update(bytes).digest('hex')});
 for(const row of run.results){const score=retrievalMetrics(row.expectedEvidence,row.evidence,run.config.dataVersions);for(const key of Object.keys(score))assert.equal(score[key],row[key],`${v.id}/${row.caseId}/${row.mode}/${key}`);count++;}
}
const stamp=new Date().toISOString(),output=`${root}/metric-crosscheck-${scope}-${stamp.replace(/[:.]/g,'-')}.json`;
writeFileSync(output,JSON.stringify({at:stamp,count,inputs,scope,result:'passed',fields:['recallAtK','mrr','evidenceHit','allEvidenceHit','evidenceGroupCount','hitEvidenceGroupCount'],method:'Independent JS sourceHash/page/UTF16/quote evidence-group recomputation of every Java-produced field; failures retained; only persisted suite variants considered.'},null,2)+'\n',{flag:'wx'});
console.log(`Verified ${count} rows; ${output}`);
