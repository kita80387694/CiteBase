import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {retrievalMetrics} from './phase2-metrics.mjs';
const versions=[{version_id:'v',content_hash:'hash'}];
const label=(quote,start,groupId)=>({documentName:'d',sourceHash:'hash',page:1,paragraph:2,startOffset:start,endOffset:start+quote.length,quote,groupId});
const evidence={documentName:'d',versionId:'v',page:1,paragraph:1,startOffset:0,endOffset:7,text:'A😀B xyz'};
test('alternatives are OR, required groups are AND, UTF-16 spanning paragraphs is stable',()=>{
  const labels=[label('😀',1,'a'),label('absent',9,'a'),label('xyz',5,'b')];
  const e={...evidence,endOffset:evidence.text.length};
  assert.equal(retrievalMetrics(labels,[e],versions).recallAtK,1);
  assert.equal(retrievalMetrics(labels,[{...e,text:'A😀B',endOffset:4}],versions).recallAtK,.5);
  assert.equal(retrievalMetrics(labels,[e],[{version_id:'v',content_hash:'other'}]).recallAtK,0);
  assert.equal(retrievalMetrics(labels,[{...e,documentName:'foreign'},e],versions).mrr,.5);
});
test('cross-check every dev baseline row against the Java-produced metric',()=>{
  const root='docs/results/phase2/baseline';let count=0;
  for(const file of readdirSync(root).filter(f=>f.startsWith('baseline-dev-')&&f.endsWith('.json'))){
    const run=JSON.parse(readFileSync(`${root}/${file}`));
    for(const row of run.results){const score=retrievalMetrics(row.expectedEvidence,row.evidence,run.config.dataVersions);
      assert.equal(score.recallAtK,row.recallAtK,`${row.caseId}/${row.mode} recall`);
      assert.equal(score.mrr,row.mrr,`${row.caseId}/${row.mode} mrr`);count++;
    }
  }
  assert.equal(count,208);
});
