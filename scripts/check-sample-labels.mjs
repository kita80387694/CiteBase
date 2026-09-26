import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const data=JSON.parse(readFileSync('samples/evaluation.json','utf8'));
const ids=new Set();let labels=0;
for(const q of data.questions){assert(!ids.has(q.id));ids.add(q.id);assert.equal(typeof q.answerable,'boolean');if(!q.answerable){assert.equal(q.evidence.length,0);continue;}assert(q.evidence.length>0);for(const e of q.evidence){const text=readFileSync('samples/documents/'+e.documentName,'utf8').replace(/\r\n?/g,'\n');const paragraphs=text.trim().split(/\n[\t ]*\n/);assert(paragraphs[e.paragraph-1].includes(e.quote),q.id+' stable evidence mismatch');assert.equal(e.page,1);labels++;}}
assert(data.questions.length>=50);console.log(`${data.questions.length} unique questions; ${labels} stable labels verified against original documents.`);
