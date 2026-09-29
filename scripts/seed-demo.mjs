import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import https from 'node:https';
const base=process.env.CITEBASE_URL||'http://localhost:8080';
const username=process.env.DEMO_USER||'alice',password=process.env.DEMO_PASSWORD||'Alice-demo-123!';
const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
if(!login.ok)throw Error(`Login failed ${login.status}`);
const {token}=await login.json(); const headers={Authorization:`Bearer ${token}`};
async function request(path,init={}){const r=await fetch(base+path,{...init,headers:{...headers,...init.headers}});if(!r.ok)throw Error(`${path}: ${r.status} ${await r.text()}`);return r.json();}
let bases=await request('/api/knowledge-bases');let kb=bases.find(x=>x.name==='CiteBase 自建手册 v1');
if(!kb)kb=await request('/api/knowledge-bases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'CiteBase 自建手册 v1'})});
for(const file of readdirSync('samples/documents').sort()){const form=new FormData();form.append('file',new Blob([readFileSync('samples/documents/'+file)]),file);await request(`/api/knowledge-bases/${kb.id}/documents`,{method:'POST',body:form});}
let docs;
for(let i=0;i<600;i++){docs=await request(`/api/knowledge-bases/${kb.id}/documents`);if(docs.every(d=>['SUCCESS','FAILED'].includes(d.status)))break;await new Promise(r=>setTimeout(r,1000));}
if(docs.some(d=>d.status!=='SUCCESS'))throw Error('Index not ready: '+JSON.stringify(docs));
const me=await request('/api/me');console.log(JSON.stringify({kbId:kb.id,mode:me.mode,documents:docs.length},null,2));
if(process.argv.includes('--evaluate')||process.argv.includes('--export-latest')){
 async function evaluate(){
  const spec={kbId:kb.id,name:`${me.mode} 自建手册对比`,dataset:JSON.parse(readFileSync('samples/evaluation.json','utf8')),topK:5};
  const idempotencyKey='demo-'+createHash('sha256').update(JSON.stringify({spec,versions:docs.map(d=>d.activeVersionId)})).digest('hex');
  return request('/api/evaluations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...spec,idempotencyKey})});
 }
 let result;
 if(process.argv.includes('--export-latest')){const runs=await request('/api/evaluations');const latest=runs.find(r=>r.name===`${me.mode} 自建手册对比`);if(!latest)throw Error('No matching evaluation');result=await request(`/api/evaluations/${latest.id}/export`);}else result=await evaluate();
 while(['QUEUED','RUNNING','RETRY_WAIT','CANCEL_REQUESTED'].includes(result.status)){await new Promise(r=>setTimeout(r,1500));result=await request(`/api/evaluations/${result.id}/export`);}
 mkdirSync('docs/results',{recursive:true});const file=`docs/results/${me.mode}-${result.id}.json`;writeFileSync(file,JSON.stringify(result,null,2)+'\n');console.log(`Raw result saved: ${file}`);console.log(JSON.stringify(result.summary,null,2));if(!['COMPLETED','COMPLETED_WITH_ERRORS','SUCCEEDED'].includes(result.status))throw Error('Evaluation incomplete: '+result.status);
}
