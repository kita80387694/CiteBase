import http from 'node:http';
import https from 'node:https';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {assertRunMatchesRequest} from './phase2-comparability.mjs';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const read=path=>JSON.parse(readFileSync(path));
export const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function immutable(path,value){if(existsSync(path))assert.deepEqual(read(path),value,`Refusing to replace raw result ${path}`);else save(path,value);}
export async function client(){
  const base=process.env.CITEBASE_URL||'http://localhost:28080';let token;
  function request(path,body){return new Promise((resolve,reject)=>{
    const url=new URL(path,base),data=body===undefined?null:JSON.stringify(body);
    const req=(url.protocol==='https:'?https:http).request(url,{method:data?'POST':'GET',timeout:3600000,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{})}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>{try{assert(res.statusCode>=200&&res.statusCode<300,`${path}: HTTP ${res.statusCode} ${text.slice(0,200)}`);resolve(text?JSON.parse(text):null);}catch(e){reject(e);}});
    });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Request deadline: reconcile persisted task before retry')));if(data)req.write(data);req.end();
  });}
  ({token}=await request('/api/auth/login',{username:process.env.DEMO_USER||'alice',password:process.env.DEMO_PASSWORD||'Alice-demo-123!'}));
  assert.equal((await request('/api/me')).mode,'real','This runner refuses mock mode');
  return {request,async upload(kb,file,profile){const form=new FormData();form.append('file',new Blob([readFileSync(file)]),file.split(/[\\/]/).at(-1));for(const [key,value] of Object.entries({chunkStrategy:profile.strategy,chunkSize:profile.size,chunkOverlap:profile.overlap}))form.append(key,String(value));const r=await fetch(`${base}/api/knowledge-bases/${kb}/documents`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});assert.equal(r.status,200,`Upload failed ${file}`);return r.json();}};
}
export async function evaluation(api,{root,id,kbId,dataset,options,runtime,topK=5}){
  assert(/^[a-z0-9_-]+$/i.test(id));mkdirSync(root,{recursive:true});
  const journal=`${root}/${id}.state.json`,output=`${root}/${id}.raw.json`;
  const spec={kbId,datasetSha256:sha(JSON.stringify(dataset)),options,topK,runtime};
  let state=existsSync(journal)?read(journal):{id,spec,expectedRows:dataset.questions.length*2,status:'INTENT_SAVED',createdAt:new Date().toISOString()};assert.deepEqual(state.spec,spec,'Run configuration changed: new id required');
  if(existsSync(output)){const run=read(output);assert(['COMPLETED','COMPLETED_WITH_ERRORS','SUCCEEDED'].includes(run.status),'Saved failed/interrupted run requires investigation, not silent success');assertRunMatchesRequest(run,{dataset,options,topK});assert.equal(run.results?.length,dataset.questions.length*2,'Saved partial result must not be mistaken for a full run');return run;}
  save(journal,state);const name=`p2opt-${id}`;
  const existing=state.runId?{id:state.runId}:(await api.request('/api/evaluations')).find(r=>r.name===name);
  let run;
  if(existing){
    run=await api.request(`/api/evaluations/${existing.id}/export`);
    const documents=await api.request(`/api/knowledge-bases/${kbId}/documents`);
    const active=documents.filter(d=>d.activeVersionId).map(d=>[d.id,d.activeVersionId]).sort((a,b)=>a[0].localeCompare(b[0]));
    assert(Array.isArray(run.config?.dataVersions),'Recovered run has no data version snapshot');
    const recorded=run.config.dataVersions.map(d=>[d.id,d.version_id]).sort((a,b)=>a[0].localeCompare(b[0]));
    assert.deepEqual(recorded,active,'Recovered run belongs to another KB or changed active source versions');
  }
  else{assert.notEqual(state.status,'SUBMITTING','Uncertain submission: inspect server before explicit resolution');state.status='SUBMITTING';save(journal,state);run=await api.request('/api/evaluations',{kbId,name,dataset,topK,retrievalOptions:options});}
  assertRunMatchesRequest(run,{dataset,options,topK});
  state.runId=run.id;state.status=run.status;save(journal,state);
  while(['QUEUED','RUNNING','CANCEL_REQUESTED'].includes(run.status)){await pause(3000);run=await api.request(`/api/evaluations/${run.id}/export`);state.status=run.status;save(journal,state);}
  assertRunMatchesRequest(run,{dataset,options,topK});
  immutable(output,run);state.status=run.status;state.completedAt=new Date().toISOString();state.rawSha256=sha(readFileSync(output));save(journal,state);
  assert(['COMPLETED','COMPLETED_WITH_ERRORS','SUCCEEDED'].includes(run.status),`Run ${id} terminated ${run.status}; partial output retained`);
  assert.equal(run.results.length,dataset.questions.length*2,'Incomplete rows retained, not a valid full experiment');
  console.log(`${id}: ${run.status}, ${run.results.length} rows`);return run;
}
