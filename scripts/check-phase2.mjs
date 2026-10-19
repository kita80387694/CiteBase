import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve,delimiter} from 'node:path';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {ROOT,SEED,hash,paragraphs,extractPdfs,generate,pdfBytes} from './generate-phase2.mjs';
import {topics} from './generate-phase2-data.mjs';
const read=path=>JSON.parse(readFileSync(join(ROOT,path),'utf8'));
if(process.argv.includes('--regenerate')){
  const before=readFileSync(join(ROOT,'manifest.json'));
  generate();assert.deepEqual(readFileSync(join(ROOT,'manifest.json')),before,'Regeneration changed the frozen manifest');
}
const manifest=read('manifest.json'),dataset=read('evaluation.json'),security=read('security.json');
assert.equal(manifest.seed,SEED);assert.equal(dataset.seed,SEED);
assert.equal(readFileSync(join(ROOT,'manifest.sha256'),'utf8').split(' ')[0],hash(readFileSync(join(ROOT,'manifest.json'))));
for(const f of manifest.files)assert.equal(hash(readFileSync(join(ROOT,f.path))),f.sha256,'File hash: '+f.path);
for(const f of manifest.generatorFiles||[])assert.equal(hash(readFileSync(resolve(f.path))),f.sha256,'Generator hash: '+f.path);
assert.equal(manifest.documents.length,12);assert.equal(readdirSync(join(ROOT,'documents')).length,12);
assert.equal(new Set(manifest.documents.map(d=>d.documentName)).size,12);
const extracted=new Map();const pdfPages=extractPdfs(manifest.documents.filter(d=>d.type==='pdf').map(d=>join(ROOT,'documents',d.documentName)));
let estimatedChunks=0,spanningParagraphs=0;
for(const d of manifest.documents){
  const bytes=readFileSync(join(ROOT,'documents',d.documentName));assert.equal(hash(bytes),d.sourceHash);assert.equal(bytes.length,d.bytes);
  const saved=read('extracted/'+d.documentName+'.json');assert.equal(saved.sourceHash,d.sourceHash);
  const pages=d.type==='pdf'?pdfPages.get(d.documentName):[bytes.toString('utf8').replace(/\r\n?/g,'\n')];assert.equal(saved.pages.length,pages.length);
  for(const [i,text] of pages.entries()){
    assert.equal(text,saved.pages[i].text,`${d.documentName} page ${i+1} PDF/text reconstruction`);
    assert.deepEqual(paragraphs(text),saved.pages[i].paragraphs,'Paragraph reconstruction');
    for(const p of paragraphs(text)){if(p.text.length>900)spanningParagraphs++;estimatedChunks+=p.text.length<=900?1:1+Math.ceil((p.text.length-900)/700);}
  }
  if(d.type==='pdf'){
    const topic=topics.find(t=>t.id===d.topic);assert.deepEqual(bytes,pdfBytes(topic.pdf),'Deterministic PDF bytes');
    assert.equal(pages.length,topic.pdf.length);
    pages.forEach((text,i)=>assert.equal(text.replace(/\s+/g,' ').trim(),topic.pdf[i],`${d.documentName} card ${i+1} text lost or altered`));
  }
  extracted.set(d.documentName,{...d,extraction:saved});
}
assert.equal(estimatedChunks,manifest.counts.estimatedChunks);assert(estimatedChunks>=200&&estimatedChunks<=350);assert(spanningParagraphs>0,'At least one long source paragraph must cross chunk windows');
// Independent comparison with the compiled production parser, including overlap windows and UTF-16 offsets.
assert(existsSync('backend/target/classes/io/citebase/DocumentParser.class'),'Run Maven compile in backend before validating the production parser');
const mavenRepo=process.env.MAVEN_REPO||join(homedir(),'.m2','repository');
const parserJars=['org/apache/pdfbox/pdfbox','org/apache/pdfbox/pdfbox-io','org/apache/pdfbox/fontbox','commons-logging/commons-logging'].map(path=>{
  const dir=join(mavenRepo,path);for(const v of readdirSync(dir).filter(v=>/^\d/.test(v)).sort().reverse()){const p=join(dir,v,path.split('/').at(-1)+'-'+v+'.jar');if(existsSync(p))return p;}throw Error('Dependency absent: '+path);
});
const localJava=resolve('.tools/jdk-21.0.12.1+1/bin/java.exe');const java=existsSync(localJava)?localJava:process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
const parserRun=spawnSync(java,['-Dfile.encoding=UTF-8','--class-path',[resolve('backend/target/classes'),...parserJars].join(delimiter),resolve('scripts/check-phase2-parser.java'),...manifest.documents.map(d=>join(ROOT,'documents',d.documentName))],{encoding:'utf8',maxBuffer:10*1024*1024});
assert.equal(parserRun.status,0,parserRun.stderr);const actualChunks=[];
for(const row of parserRun.stdout.trim().split(/\r?\n/)){const [documentName,page,paragraph,startOffset,endOffset,base64]=row.split('\t');if(base64)actualChunks.push({documentName,page:Number(page),paragraph:Number(paragraph),startOffset:Number(startOffset),endOffset:Number(endOffset),text:Buffer.from(base64,'base64').toString('utf8')});}
const expectedChunks=[];for(const d of manifest.documents)for(const page of extracted.get(d.documentName).extraction.pages)for(const p of page.paragraphs)for(let start=0;start<p.text.length;start+=700){const end=Math.min(start+900,p.text.length);expectedChunks.push({documentName:d.documentName,page:page.page,paragraph:p.paragraph,startOffset:p.startOffset+start,endOffset:p.startOffset+end,text:p.text.slice(start,end)});if(end===p.text.length)break;}
assert.deepEqual(actualChunks,expectedChunks,'Production DocumentParser differs from evidence extraction');
assert.equal(dataset.questions.length,156);assert.equal(dataset.questions.filter(q=>!q.answerable).length,24);
const ids=new Set(),normalized=new Set(),categoryCounts={},splitCounts={};let labels=0,alternativeQuestions=0,multiGroupQuestions=0;
for(const q of dataset.questions){
  assert(!ids.has(q.id));ids.add(q.id);const norm=q.question.replace(/[\s\p{P}]/gu,'');assert(!normalized.has(norm),'Duplicate question '+q.id);normalized.add(norm);
  assert.equal(q.group,q.topic);const topic=topics.find(t=>t.id===q.topic);assert(topic);assert.equal(q.split,topic.split);
  categoryCounts[q.category]=(categoryCounts[q.category]||0)+1;splitCounts[q.split]=(splitCounts[q.split]||0)+1;
  if(!q.answerable){assert.equal(q.evidence.length,0);assert.equal(q.expectedAnswer,null);assert.equal(q.category,'不可回答');continue;}
  assert(q.expectedAnswer?.length>0);assert(q.evidence.length>0);const groups=new Map();
  for(const e of q.evidence){
    const source=extracted.get(e.documentName);assert(source,q.id+' unknown document');assert.equal(source.topic,q.topic,'Cross-topic evidence');assert.equal(source.split,q.split,'Cross-split leakage');assert.equal(e.sourceHash,source.sourceHash);
    assert(Number.isInteger(e.page)&&Number.isInteger(e.paragraph)&&Number.isInteger(e.startOffset)&&Number.isInteger(e.endOffset));
    const page=source.extraction.pages[e.page-1],p=page.paragraphs[e.paragraph-1];assert(page&&p);
    assert(e.startOffset>=p.startOffset&&e.endOffset<=p.endOffset&&e.endOffset>e.startOffset);
    assert.equal(page.text.slice(e.startOffset,e.endOffset),e.quote,`${q.id}: exact UTF-16 span`);
    assert.equal(e.endOffset-e.startOffset,e.quote.length);assert(e.groupId);groups.set(e.groupId,(groups.get(e.groupId)||0)+1);labels++;
    const windows=[];for(let start=0;start<p.text.length;start+=700){const end=Math.min(start+900,p.text.length);windows.push([p.startOffset+start,p.startOffset+end]);if(end===p.text.length)break;}
    assert(windows.some(([start,end])=>start<=e.startOffset&&end>=e.endOffset),q.id+' reference cannot fit any current candidate');
  }
  if(groups.size>1)multiGroupQuestions++;if([...groups.values()].some(n=>n>1))alternativeQuestions++;
  if(q.category==='跨文档')assert(new Set(q.evidence.map(e=>e.documentName)).size>=2);
  if(q.category==='跨段落')assert(new Set(q.evidence.map(e=>e.documentName+':'+e.page+':'+e.paragraph)).size>=2);
  if(q.category==='表格')assert(q.evidence.some(e=>e.quote.includes('|')));
}
for(const split of ['dev','test']){const part=read(split+'.json');assert.equal(part.split,split);assert.deepEqual(part.questions,dataset.questions.filter(q=>q.split===split));}
assert.deepEqual(splitCounts,{dev:104,test:52});assert(alternativeQuestions>0);assert(multiGroupQuestions>=48);
assert.equal(security.cases.length,24);const securityCounts={};const securityIds=new Set();
for(const c of security.cases){assert(!securityIds.has(c.id));securityIds.add(c.id);securityCounts[c.category]=(securityCounts[c.category]||0)+1;assert.notEqual(c.setup.owner,c.setup.otherOwner);assert(['ask','cross_user_kb','cross_user_citation'].includes(c.action));assert.equal(paragraphs(c.setup.documentText).length,1);assert(c.setup.documentText.length<=900);if(c.category==='authorization')assert.equal(c.expected.status,404);else{assert(c.expected.answerNotContains.length>0);assert(c.expected.answerContains.length>0);}if(c.expected.allowCitationRejection)assert.equal(c.category,'forged_citation');}
assert.deepEqual(securityCounts,{prompt_injection:6,forged_citation:6,tool_abuse:6,authorization:6});
console.log(JSON.stringify({validated:true,questions:ids.size,labels,estimatedChunks,productionParserChunks:actualChunks.length,spanningParagraphs,multiGroupQuestions,alternativeQuestions,categoryCounts,splitCounts,securityCounts,manifestSha256:hash(readFileSync(join(ROOT,'manifest.json')))},null,2));
