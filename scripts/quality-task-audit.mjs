import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { client,read,immutable,sha } from './phase2-client.mjs';
export function taskCandidates(root,plan,io={exists:existsSync,read}){
  const prefix=`Quality3-${sha(JSON.stringify(plan)).slice(0,12)}`,targets=[],pending=[];
  for(let i=0;i<plan.caseIds.length;i++){
    const id=`q${String(i).padStart(3,'0')}`,caseId=plan.caseIds[i],pairFile=`${root}/${id}-pair.json`;
    const pair=io.exists(pairFile)?io.read(pairFile):null;
    if(pair)assert.equal(pair.caseId,caseId,'Pair case differs from registration');
    for(const arm of ['rag','agent']){
      const stem=arm==='rag'?`${root}/rag/${prefix}-${id}`:`${root}/agent/${id}`;
      const raw=io.exists(stem+'.raw.json')?io.read(stem+'.raw.json'):null;
      const state=io.exists(stem+'.state.json')?io.read(stem+'.state.json'):null;
      const ids=[pair?.[arm]?.runId,raw?.id,state?.runId].filter(Boolean);
      assert(new Set(ids).size<=1,'Pair/raw/journal task identity mismatch');
      if(ids.length)targets.push({caseId,arm,runId:ids[0],file:`${root}/tasks/${id}-${arm}.json`});
      else pending.push({caseId,arm,reason:'No persisted run identity; no new work submitted'});
    }
  }
  return{targets,pending};
}
export function validateTaskSnapshot(task,target){
  assert.equal(task.id,target.runId,'Task audit belongs to another run');
  assert(Array.isArray(task.externalCalls),'External call audit missing');
  return ['SUCCEEDED','FAILED','CANCELLED'].includes(task.status);
}
async function main(){
  const root=process.argv[2];assert(root,'Usage: quality-task-audit.mjs paired-directory');
  const plan=read(`${root}/registration.json`),api=await client();mkdirSync(`${root}/tasks`,{recursive:true});
  const {targets,pending}=taskCandidates(root,plan);let saved=0,existing=0;
  for(const target of targets){
    if(existsSync(target.file)){assert(validateTaskSnapshot(read(target.file),target),'Saved audit must be terminal');existing++;continue;}
    const task=await api.request(`/api/tasks/${target.runId}`);
    if(!validateTaskSnapshot(task,target)){pending.push({caseId:target.caseId,arm:target.arm,runId:target.runId,status:task.status,reason:'Still active; audit not frozen'});continue;}
    immutable(target.file,task);saved++;
  }
  console.log(JSON.stringify({saved,existing,pending,note:'Read-only GET audit, includes single-arm raw or journal identities; no model calls or score submissions'}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
