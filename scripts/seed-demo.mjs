import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import http from 'node:http';
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
 // A real 116-generation evaluation can exceed fetch/Undici's 300s header timeout.
 // The server persists every row. Use an explicit 30-minute socket deadline, never retry POST automatically.
 async function evaluate(){const url=new URL(base+'/api/evaluations');const body=JSON.stringify({kbId:kb.id,name:`${me.mode} 自建手册对比`,dataset:JSON.parse(readFileSync('samples/evaluation.json','utf8')),topK:5});return new Promise((resolve,reject)=>{const r=(url.protocol==='https:'?https:http).request(url,{method:'POST',headers:{...headers,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},timeout:1800000},res=>{let data='';res.setEncoding('utf8');res.on('data',s=>data+=s);res.on('end',()=>{try{if(res.statusCode!==200)throw Error(`Evaluation HTTP ${res.statusCode}`);resolve(JSON.parse(data));}catch(e){reject(e);}});});r.on('timeout',()=>r.destroy(new Error('Evaluation deadline exceeded; use --export-latest after checking run status')));r.on('error',reject);r.end(body);});}
 let result;
 if(process.argv.includes('--export-latest')){const runs=await request('/api/evaluations');const latest=runs.find(r=>r.name===`${me.mode} 自建手册对比`);if(!latest)throw Error('No matching evaluation');result=await request(`/api/evaluations/${latest.id}/export`);}else result=await evaluate();
 mkdirSync('docs/results',{recursive:true});const file=`docs/results/${me.mode}-${result.id}.json`;writeFileSync(file,JSON.stringify(result,null,2)+'\n');console.log(`Raw result saved: ${file}`);console.log(JSON.stringify(result.summary,null,2));if(result.status!=='COMPLETED')throw Error('Evaluation incomplete: '+result.status);
}
