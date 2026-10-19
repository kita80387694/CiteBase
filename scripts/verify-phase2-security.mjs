import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const args=process.argv.slice(2), opt=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const base=process.env.CITEBASE_URL||'http://localhost:28080';
const label=opt('--label','security-rag'); assert(/^[a-z0-9_-]+$/i.test(label));
const path=`docs/results/phase2/${label}.json`, fixture=readFileSync('samples/phase2/security.json');
const dataset=JSON.parse(fixture), hash=createHash('sha256').update(fixture).digest('hex');
const record=existsSync(path)?JSON.parse(readFileSync(path)):{createdAt:new Date().toISOString(),fixtureSha256:hash,results:[]};
assert.equal(record.fixtureSha256,hash,'Fixture changed; use new label');
mkdirSync('docs/results/phase2',{recursive:true});
const save=()=>writeFileSync(path,JSON.stringify(record,null,2)+'\n');
const tokens={};
async function request(route,token,{method='GET',body,form,status=200}={}) {
  const response=await fetch(base+route,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:form||(body?JSON.stringify(body):undefined)});
  assert.equal(response.status,status,`${method} ${route}`);
  return response.status===204?null:response.json();
}
for(const username of ['alice','bob']) tokens[username]=(await request('/api/auth/login',null,{method:'POST',body:{username,password:username==='alice'?'Alice-demo-123!':'Bob-demo-123!'}})).token;
record.modelMode=(await request('/api/me',tokens.alice)).mode;
assert.equal(record.modelMode,'real','Security effectiveness validation requires real provider');
const runtimePath=opt('--runtime-manifest','.tools/phase2-runtime.json');
const runtime=JSON.parse(readFileSync(runtimePath));
if(record.runtime)assert.deepEqual(record.runtime,runtime,'Runtime changed; use new label');else record.runtime=runtime;
const cases=dataset.cases.slice(0,Number(opt('--limit',String(dataset.cases.length))));
for(const test of cases){
  if(record.results.some(r=>r.id===test.id))continue;
  const result={id:test.id,category:test.category,action:test.action,status:'RUNNING',assertions:[]};record.results.push(result);save();
  const check=(name,condition)=>{result.assertions.push({name,passed:!!condition});assert(condition,name);};
  try{
    const owner=tokens[test.setup.owner],other=tokens[test.setup.otherOwner||'bob'];assert(owner&&other&&owner!==other);
    const kb=await request('/api/knowledge-bases',owner,{method:'POST',body:{name:`Phase2 security ${test.id} ${Date.now()}`}});result.kbId=kb.id;save();
    const form=new FormData();form.append('file',new Blob([test.setup.documentText]),test.setup.documentName);
    await request(`/api/knowledge-bases/${kb.id}/documents`,owner,{method:'POST',form});
    let ready=false;
    for(let i=0;i<180;i++){const docs=await request(`/api/knowledge-bases/${kb.id}/documents`,owner);if(docs.some(d=>d.status==='FAILED'))throw Error('Index failed');if(docs.length&&docs.every(d=>d.status==='SUCCESS')){ready=true;break;}await new Promise(r=>setTimeout(r,1000));}
    check('Index ready',ready);
    const ask={kbId:kb.id,question:test.question,mode:'vector',topK:5};
    if(test.action==='cross_user_kb'){
      await request('/api/questions',other,{method:'POST',body:ask,status:test.expected.status||404});check('Foreign user cannot query KB',true);
    }else{
      const answer=await request('/api/questions',owner,{method:'POST',body:ask});result.answer=answer;
      const blocked=!!test.expected.allowCitationRejection && answer.abstained && answer.citations.length===0 && /模型引用|模型回答未提供可验证引用/.test(answer.error||'');
      result.blockedByCitationValidation=blocked;
      check('Generation succeeded or forged citation was explicitly blocked',!answer.error||blocked);
      check('Citations are from current evidence',answer.citations.every(c=>answer.evidence.some(e=>e.id===c.id)));
      for(const text of test.expected.answerContains||[])check(`Answer contains ${text} or allowed safe rejection`,answer.answer.includes(text)||blocked);
      for(const text of test.expected.answerNotContains||[])check(`Answer excludes ${text}`,!answer.answer.includes(text));
      if(typeof test.expected.abstained==='boolean')check('Abstention matches expectation or allowed safe rejection',answer.abstained===test.expected.abstained||blocked);
      check('Citation format valid or explicitly rejected',answer.citationValid||blocked);
      if(test.action==='cross_user_citation'){
        check('Owner obtained evidence citation',answer.citations.length>0);
        for(const c of answer.citations)await request(`/api/citations/${c.id}`,other,{status:test.expected.status||404});
        check('Foreign citation access refused',true);
      }else assert.equal(test.action,'ask');
    }
    result.status='PASSED';
  }catch(error){result.status='FAILED';result.error=String(error);}
  result.completedAt=new Date().toISOString();save();console.log(`${result.id}: ${result.status}`);
}
record.completedAt=new Date().toISOString();record.total=record.results.length;record.passed=record.results.filter(r=>r.status==='PASSED').length;record.failed=record.total-record.passed;save();
console.log(`${record.passed}/${record.total} real safety cases passed; original responses retained in ${path}`);
if(record.failed)process.exitCode=1;
