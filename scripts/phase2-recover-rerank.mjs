import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {client,read,sha,immutable} from './phase2-client.mjs';
import {assertRunMatchesRequest} from './phase2-comparability.mjs';
import {retrievalMetrics} from './phase2-metrics.mjs';

const modes=['vector','hybrid'];
const key=r=>`${r.caseId}:${r.mode}`;
const atomic=(file,data)=>{writeFileSync(file+'.tmp',JSON.stringify(data,null,2)+'\n');renameSync(file+'.tmp',file);};
const exclusiveIntent=(file,data)=>{const fd=openSync(file,'wx');try{writeSync(fd,JSON.stringify(data,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}};
const normalize=s=>s.toLowerCase().replace(/[ \t\n\x0B\f\r]+/g,'');
export function missingPairs(run,dataset){
  const pairs=dataset.questions.flatMap(c=>modes.map(mode=>({caseId:c.id,mode,c})));
  const expected=new Set(pairs.map(key)),seen=new Set();
  for(const row of run.results){assert(expected.has(key(row)),'Unexpected case/mode');assert(!seen.has(key(row)),'Duplicate case/mode');seen.add(key(row));}
  return pairs.filter(p=>!seen.has(key(p)));
}
export function evaluationRow(answer,c,versions,source){
  const metrics=retrievalMetrics(c.evidence||[],answer.evidence,versions);
  return {...answer,...metrics,caseId:c.id,category:c.category??null,split:c.split??null,group:c.group??null,topic:c.topic??null,
    expectedAnswer:c.expectedAnswer??null,answerable:c.answerable,expectedEvidence:c.evidence||[],
    recallAtK:c.answerable?metrics.recallAtK:null,mrr:c.answerable?metrics.mrr:null,answerCorrect:null,
    referenceAnswerMatch:c.expectedAnswer==null?null:normalize(answer.answer).includes(normalize(c.expectedAnswer)),
    abstentionCorrect:c.answerable?null:answer.abstained===true&&answer.citationValid===true&&answer.error==null,recoverySource:source};
}
function matches(answer,c,mode,options,versions){
  try{assert.equal(answer.question,c.question);assert.equal(answer.mode,mode);assert.equal(answer.modelMode,'real');assert.deepEqual(answer.retrievalOptions,options);assert.deepEqual(answer.diagnostics?.dataVersions,versions);assert(Array.isArray(answer.evidence));assert.equal(typeof answer.answer,'string');assert(answer.id);return true;}catch{return false;}
}
export async function assertActiveSnapshot(api,kbId,versions){
  const docs=await api.request(`/api/knowledge-bases/${kbId}/documents`);
  const identities=docs.filter(d=>d.activeVersionId).map(d=>[d.id,d.activeVersionId]).sort();
  assert.deepEqual(identities,versions.map(v=>[v.id,v.version_id]).sort(),'Active source snapshot changed');
  for(const v of versions){
    const records=await api.request(`/api/documents/${v.id}/versions`),actual=records.find(x=>x.id===v.version_id);
    assert(actual,'Active version missing');
    assert.deepEqual([actual.contentHash,actual.chunkStrategy,actual.chunkSize,actual.chunkOverlap],[v.content_hash,v.chunk_strategy,v.chunk_size,v.chunk_overlap],'Source hash/profile changed');
  }
}
/** Does not retry ambiguous paid submissions. Re-entry reconciles uniquely persisted history only. */
export async function recover(api,{root,runtime,id='c-rerank'}){
  const originalPath=`${root}/${id}.interrupted.raw.json`,original=read(originalPath),state=read(`${root}/${id}.state.json`),spec=state.spec;
  assert.deepEqual(runtime,spec.runtime,'Runtime differs from frozen experiment');
  const dataset=original.config.dataset,versions=original.config.dataVersions;
  assertRunMatchesRequest(original,{dataset,options:spec.options,topK:spec.topK});
  assert.equal(dataset.questions.length,16,'Rerank recovery is registered for 16 cases');
  assert.equal(original.results.length,25,'Expected immutable 25-row interrupted snapshot');
  const missing=missingPairs(original,dataset);assert.equal(missing.length,7);
  const dir=`${root}/${id}.recovery`;mkdirSync(dir,{recursive:true});
  const manifestPath=`${dir}/manifest.json`,manifest={kind:'paid-question-recovery',originalFile:originalPath,originalSha256:sha(readFileSync(originalPath)),originalRunId:original.id,runtime,kbId:spec.kbId,expectedRows:32,
    operationalInterruption:{kind:'process-interruption',potentialUnpersistedCase:key(missing[0]),executionStatus:'unknown',usage:null,qualityError:false,note:'The original next request may have consumed provider calls before process loss. Its answer and cost are unavailable; recovery is a separately observed call, not a claim of free retry.'}};
  immutable(manifestPath,manifest);
  await assertActiveSnapshot(api,spec.kbId,versions);
  const rows=[...original.results],sources=[{kind:'interrupted-evaluation',file:originalPath,sha256:manifest.originalSha256,runId:original.id,rows:25}];
  for(const {c,mode,caseId} of missing){
    assert(/^[a-z0-9_-]+$/i.test(caseId),'Unsafe case ID');
    const stem=`${dir}/${caseId}.${mode}`,intentPath=stem+'.intent.json',answerPath=stem+'.answer.json';
    const body={kbId:spec.kbId,question:c.question,mode,topK:spec.topK,retrievalOptions:spec.options};
    let answer;
    if(existsSync(answerPath))answer=read(answerPath);
    else {
      await assertActiveSnapshot(api,spec.kbId,versions);
      const history=await api.request(`/api/questions?kbId=${encodeURIComponent(spec.kbId)}`);
      if(existsSync(intentPath)){
        const intent=read(intentPath);assert.deepEqual(intent.body,body,'Recovery intent changed');
        const candidates=history.filter(a=>!intent.priorHistoryIds.includes(a.id)&&matches(a,c,mode,spec.options,versions));
        assert.equal(candidates.length,1,'Uncertain paid submission: history must contain exactly one new match; do not resubmit (history is limited to 100)');
        answer=candidates[0];immutable(answerPath,answer);
        atomic(stem+'.receipt.json',{source:'uniquely-reconciled-history',answerId:answer.id,reconciledAt:new Date().toISOString()});
      }else{
        // Save intent before the network boundary, even a crash before POST requires reconciliation.
        exclusiveIntent(intentPath,{status:'SUBMITTING',body,priorHistoryIds:history.map(a=>a.id),createdAt:new Date().toISOString()});
        answer=await api.request('/api/questions',body);
        immutable(answerPath,answer); // retain actual response even if subsequent validation fails
        atomic(stem+'.receipt.json',{source:'question-api-response',answerId:answer.id,receivedAt:new Date().toISOString()});
      }
    }
    assert(matches(answer,c,mode,spec.options,versions),'Recovered answer configuration/snapshot differs');
    const source={kind:'question-response',caseId,mode,file:answerPath,sha256:sha(readFileSync(answerPath)),answerId:answer.id,intentFile:intentPath};
    sources.push(source);rows.push(evaluationRow(answer,c,versions,source));
  }
  assert.equal(missingPairs({results:rows},dataset).length,0);
  await assertActiveSnapshot(api,spec.kbId,versions);
  const output={...original,id:`${original.id}:composite-recovery`,kind:'composite-recovered-evaluation',status:rows.some(r=>r.error!=null)?'COMPLETED_WITH_ERRORS':'COMPLETED',error:rows.some(r=>r.error!=null)?'Actual question responses contain errors; none omitted':null,
    results:rows,summary:{},rawSources:sources,recovery:{...manifest,completed:true,originalRows:25,recoveredRows:7,note:'Composite of original persisted rows and separately persisted questions; not a single server evaluation. Original server run remains untouched. Operational interruption is reported separately from observed answer errors.'}};
  immutable(`${root}/${id}.raw.json`,output);return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const runtime=read('.tools/phase2-stage2-runtime.json');
  for(const [file,hash] of Object.entries(runtime.fileHashes))assert.equal(sha(readFileSync(file)),hash,`Frozen source changed: ${file}`);
  const original=read('docs/results/phase2/optimization/c-rerank.interrupted.raw.json'),spec=read('docs/results/phase2/optimization/c-rerank.state.json').spec;
  const requested=read('docs/results/phase2/registration/tuning.json');
  assert.equal(sha(JSON.stringify(requested)),spec.datasetSha256,'Registered dataset changed');
  assertRunMatchesRequest(original,{dataset:requested,options:spec.options,topK:spec.topK});
  const output=await recover(await client(),{root:'docs/results/phase2/optimization',runtime});
  console.log(`${output.kind}: ${output.results.length} rows; original run unmodified`);
}
