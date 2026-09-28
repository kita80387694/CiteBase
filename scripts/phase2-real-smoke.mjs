import {client,read,immutable,sha,save} from './phase2-client.mjs';
import {existsSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const path='docs/results/phase2/stage2-real-smoke.json',checkpoint='docs/results/phase2/stage2-real-smoke-checkpoint.json',intent='docs/results/phase2/stage2-real-smoke-intent.json';
assert(!existsSync(path),'Smoke already saved; inspect rather than repeat paid calls');
const runtime=read('.tools/phase2-stage2-runtime.json'),api=await client();
const kb=(await api.request('/api/knowledge-bases')).find(x=>x.name==='Phase2 baseline');assert(kb,'Run frozen baseline seed first');
const question=read('docs/results/phase2/registration/tuning.json').questions.find(x=>x.answerable);
const input={kbId:kb.id,question:question.question,mode:'hybrid',topK:5,retrievalOptions:{candidateK:20,keywordWeight:1,rerank:true,citationStyle:'compact'}};
let answer,recovery='new-generation';
if(existsSync(checkpoint)){const saved=read(checkpoint);assert.deepEqual(saved.input,input);assert.deepEqual(saved.runtime,runtime);answer=saved.answer;recovery='saved-checkpoint';}
else if(process.argv.includes('--recover-history')){
  const matches=(await api.request('/api/questions?kbId='+kb.id)).filter(x=>x.question===input.question&&x.mode===input.mode&&Object.entries(input.retrievalOptions).every(([k,v])=>x.retrievalOptions?.[k]===v));
  assert.equal(matches.length,1,'Recovery requires exactly one saved matching answer; do not blindly repeat');answer=matches[0];recovery='unique-saved-history';
}else{assert(!existsSync(intent),'Uncertain prior submission; recover saved history or inspect server before any new model call');save(intent,{runtime,input,submittedAt:new Date().toISOString()});answer=await api.request('/api/questions',input);}
immutable(checkpoint,{runtime,input,answer});
const citations=[];for(const cited of answer.citations)citations.push(await api.request('/api/citations/'+cited.id));
immutable(path,{createdAt:new Date().toISOString(),runtime,scriptSha256:sha(readFileSync('scripts/phase2-real-smoke.mjs')),input,answer,citations,recovery,note:'One real pipeline smoke, not used to choose retrieval parameters or establish answer correctness. Resume uses saved answers and never repeats an uncertain generation.'});
assert.equal(answer.modelMode,'real');assert.equal(answer.error,null);assert.equal(answer.citationValid,true);assert(answer.evidence.length>0);assert(answer.diagnostics.candidateCounts.rerankInput>0);assert(answer.usage.rerank);assert(citations.length>0);console.log('Real stage2 rerank/compact smoke saved; actual usage retained. Recovery: '+recovery);
