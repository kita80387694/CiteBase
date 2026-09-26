import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.env.CITEBASE_URL||'http://localhost:8080';
let checks=0;
async function req(path,{token,body,form,method='GET',status=200}={}){
 const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body?{'Content-Type':'application/json'}:{})},body:form|| (body?JSON.stringify(body):undefined)});
 assert.equal(response.status,status,`${method} ${path}: ${await response.clone().text()}`);checks++;
 const text=await response.text();return text?JSON.parse(text):null;
}
const alice=(await req('/api/auth/login',{method:'POST',body:{username:'alice',password:'Alice-demo-123!'}})).token;
const bob=(await req('/api/auth/login',{method:'POST',body:{username:'bob',password:'Bob-demo-123!'}})).token;
const me=await req('/api/me',{token:alice});
await req('/api/knowledge-bases',{status:401});
await req('/api/auth/login',{method:'POST',body:{username:'alice',password:'wrong'},status:401});
const ak=await req('/api/knowledge-bases',{token:alice,method:'POST',body:{name:`API验收-${Date.now()}`}});
const bk=await req('/api/knowledge-bases',{token:bob,method:'POST',body:{name:`Bob隔离验收-${Date.now()}`}});
async function upload(kb,token,text,name,documentId){const form=new FormData();form.append('file',new Blob([text]),name);if(documentId)form.append('documentId',documentId);return req(`/api/knowledge-bases/${kb}/documents`,{token,method:'POST',form});}
async function ready(kb,token){for(let i=0;i<120;i++){const ds=await req(`/api/knowledge-bases/${kb}/documents`,{token});if(ds.every(d=>d.status==='SUCCESS'))return ds;if(ds.some(d=>d.status==='FAILED'))throw Error(JSON.stringify(ds));await new Promise(r=>setTimeout(r,1000));}throw Error('Index timeout');}
const body='测试验收服务的 HTTP 监听端口是 9081。';
const ad=await upload(ak.id,alice,body,'验收.md');
const duplicate=await upload(ak.id,alice,body,'重复.md');assert.equal(ad.id,duplicate.id);checks++;
const bd=await upload(bk.id,bob,'Bob 私密保险库的测试口令是 BOB-ONLY-7391。','private.txt');
await ready(ak.id,alice);await ready(bk.id,bob);
for(const mode of ['vector','hybrid'])await req('/api/questions',{token:alice,method:'POST',body:{kbId:bk.id,question:'Bob 口令',mode,topK:5},status:404});
await req(`/api/knowledge-bases/${bk.id}/documents`,{token:alice,status:404});
await req(`/api/documents/${bd.id}/versions`,{token:alice,status:404});
await req(`/api/documents/${bd.id}`,{token:alice,method:'DELETE',status:404});
await req(`/api/knowledge-bases/${bk.id}`,{token:alice,method:'DELETE',status:404});
const bt=(await req('/api/tasks',{token:bob})).find(t=>t.documentId===bd.id);
await req(`/api/tasks/${bt.id}/retry`,{token:alice,method:'POST',status:404});
assert(!(await req('/api/tasks',{token:alice})).some(t=>t.id===bt.id));checks++;
await req(`/api/questions?kbId=${bk.id}`,{token:alice,status:404});
const answer=await req('/api/questions',{token:alice,method:'POST',body:{kbId:ak.id,question:'测试验收服务的 HTTP 监听端口是多少？',mode:'hybrid',topK:5}});
assert(answer.evidence.length>0);assert(answer.citationValid);assert(answer.citations.length>0);assert(!JSON.stringify(answer).includes('BOB-ONLY-7391'));checks+=4;
for(const c of answer.citations){await req(`/api/citations/${c.id}`,{token:alice});await req(`/api/citations/${c.id}`,{token:bob,status:404});}
const evaluation=await req('/api/evaluations',{token:alice,method:'POST',body:{kbId:ak.id,name:'API双模式验收',topK:5,dataset:{version:'api-v1',questions:[{id:'port',question:'测试验收服务的 HTTP 监听端口是多少？',answerable:true,expectedAnswer:'9081',evidence:[{documentName:'验收.md',page:1,paragraph:1,quote:body}]}]}}});
assert.equal(evaluation.status,'COMPLETED');assert.equal(evaluation.results.length,2);checks+=2;
await req(`/api/evaluations/${evaluation.id}`,{token:bob,status:404});await req(`/api/evaluations/${evaluation.id}/export`,{token:bob,status:404});
const exported=await req(`/api/evaluations/${evaluation.id}/export`,{token:alice});assert.equal(exported.results.length,2);checks++;
await req(`/api/documents/${ad.id}`,{token:alice,method:'DELETE'});
for(const c of answer.citations)await req(`/api/citations/${c.id}`,{token:alice,status:404});
assert.equal((await req(`/api/questions?kbId=${ak.id}`,{token:alice})).length,0);checks++;
await req(`/api/evaluations/${evaluation.id}`,{token:alice,status:404});
const empty=await req('/api/questions',{token:alice,method:'POST',body:{kbId:ak.id,question:'监听端口？',mode:'hybrid',topK:5}});assert(empty.abstained);assert.equal(empty.evidence.length,0);checks+=2;
await req(`/api/knowledge-bases/${ak.id}`,{token:alice,method:'DELETE'});await req(`/api/knowledge-bases/${bk.id}`,{token:bob,method:'DELETE'});
const result={verifiedAt:new Date().toISOString(),modelMode:me.mode,checks,status:'PASSED',scope:'Actual HTTP endpoints: login, upload, duplicate, index, vector/hybrid ACL, documents/tasks/history/citations/evaluation/export isolation, deletion revocation, no-evidence abstention',answer,evaluation};
mkdirSync('docs/results',{recursive:true});writeFileSync(`docs/results/api-${me.mode}.json`,JSON.stringify(result,null,2)+'\n');console.log(`${checks} API assertions passed (${me.mode}); raw record docs/results/api-${me.mode}.json`);
