// Experimental scheduling only: pre-submit a distant batch under the exact name
// the sequential runner already reconciles. Never change the live runner's state.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
const offset=Number(process.argv[2]);
assert(Number.isInteger(offset)&&offset>=0&&offset%8===0);
const root='docs/results/phase2/baseline', journal=`${root}/prefetch-${offset}.json`;
const state=JSON.parse(readFileSync(`${root}/state.json`));
const bytes=readFileSync('samples/phase2/evaluation.json'), dataset=JSON.parse(bytes);
const hash=createHash('sha256').update(bytes).digest('hex');assert.equal(hash,state.datasetSha256);
const selected=dataset.questions.filter(q=>q.split==='dev');assert(offset<selected.length);
const name=`baseline-dev-${offset}-${hash.slice(0,8)}`;
const runtime=JSON.parse(readFileSync('.tools/phase2-runtime.json'));assert.deepEqual(runtime,state.runtime);
let token;
function request(path,body){return new Promise((resolve,reject)=>{
  const data=body===undefined?null:JSON.stringify(body);
  const req=http.request(new URL(path,process.env.CITEBASE_URL||'http://localhost:28080'),{method:data?'POST':'GET',timeout:3600000,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{})}},res=>{
    let text='';res.setEncoding('utf8');res.on('data',x=>text+=x);res.on('end',()=>{try{assert(res.statusCode>=200&&res.statusCode<300,`HTTP ${res.statusCode}: ${text.slice(0,200)}`);resolve(JSON.parse(text));}catch(e){reject(e);}});
  });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Uncertain request: inspect persisted run; never automatically resubmit')));if(data)req.write(data);req.end();
});}
({token}=await request('/api/auth/login',{username:'alice',password:'Alice-demo-123!'}));
assert.equal((await request('/api/me')).mode,'real');
const existing=(await request('/api/evaluations')).find(r=>r.name===name);
if(existing){console.log(`Already persisted ${name}: ${existing.id}; sequential runner will reconcile`);process.exit(0);}
assert(!existsSync(journal),'Submission journal exists: inspect server before resolving uncertainty');
// At least two full intervening batches prevent racing the sequential submitter.
const latest=JSON.parse(readFileSync(`${root}/state.json`));
const current=Math.max(...latest.batches.map(b=>selected.findIndex(q=>q.id===b.caseIds[0])));
assert(offset-current>=16,'Batch too close to active sequential runner; do not submit');
const record={name,offset,caseIds:selected.slice(offset,offset+8).map(q=>q.id),runtime,createdAt:new Date().toISOString(),status:'SUBMITTING',schedulerSourceSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),purpose:'Use vacated holdout concurrency, no extra cases; sequential runner adopts exact-name persisted run.'};
writeFileSync(journal,JSON.stringify(record,null,2)+'\n');
const result=await request('/api/evaluations',{kbId:state.kbId,name,dataset:{...dataset,questions:selected.slice(offset,offset+8)},topK:5});
record.id=result.id;record.status=result.status;record.rows=result.results?.length;record.completedAt=new Date().toISOString();
writeFileSync(journal,JSON.stringify(record,null,2)+'\n');console.log(`${name}: ${result.status}, ${record.rows} rows; original runner will export`);
