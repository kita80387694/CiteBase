import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { client, read, save, immutable } from './phase2-client.mjs';
export const sourceKey = s => JSON.stringify([s.kind,s.runId,s.caseId??null,s.mode??null]);
export function validateReviewProject(detail,intent){
  assert.equal(detail.name,intent.name,'Recovered project name mismatch');
  assert.equal(detail.ruleVersion,intent.ruleVersion,'Recovered scoring rule mismatch');
  const expected=intent.sources.map(sourceKey).sort(),actual=detail.items.map(i=>sourceKey(i.source)).sort();
  assert.equal(new Set(expected).size,expected.length,'Duplicate intended source');
  assert.equal(new Set(detail.items.map(i=>i.id)).size,detail.items.length,'Duplicate item identity');
  assert.deepEqual(actual,expected,'Recovered project contains different source answers');
  assert(detail.items.every(i=>i.status==='AVAILABLE'&&i.modelMode==='real'),'Withdrawn/mock source cannot enter formal review');
}
export function validateAssignments(detail,assignment){
  const wantedDouble=Math.ceil(detail.items.length*assignment.secondReviewPercent/100);
  assert.equal(detail.assignments.length,detail.items.length+wantedDouble,'Assignment count mismatch');
  assert.equal(new Set(detail.assignments.map(a=>a.id)).size,detail.assignments.length,'Duplicate assignment identity');
  const groups=new Map(detail.items.map(i=>[i.id,[]]));
  for(const a of detail.assignments){assert(groups.has(a.itemId),'Unknown assigned item');assert(assignment.usernames.includes(a.username)&&!a.revoked,'Unexpected or revoked reviewer');groups.get(a.itemId).push(a);}
  let actualDouble=0;
  for(const rows of groups.values()){assert(rows.length===1||rows.length===2,'Each item must have one or two assignments');assert.equal(new Set(rows.map(a=>a.username)).size,rows.length,'Double review requires distinct accounts');if(rows.length===2)actualDouble++;}
  assert.equal(actualDouble,wantedDouble,'Double-review coverage mismatch');
}
async function main(){
const root = process.argv[2];
assert(root, 'Usage: quality-prepare-review.mjs paired-baseline-directory');
const state = read(`${root}/state.json`), plan = read(`${root}/registration.json`);
assert(state.collectionCompleted, 'Full preregistered collection required; failures must remain included');
const sources = plan.caseIds.flatMap((caseId,index) => {
  const pair = read(`${root}/q${String(index).padStart(3,'0')}-pair.json`);
  assert.equal(pair.caseId, caseId); return [pair.rag,pair.agent];
});
assert.equal(sources.length,80);
const api = await client(), name = `质量盲评-${state.registrationSha256.slice(0,12)}`;
const journal = `${root}/review-project.state.json`;
const intent = { name, ruleVersion:'citebase-human-quality-v1', sources };
const local = existsSync(journal) ? read(journal) : { intent };
assert.deepEqual(local.intent, intent, 'Review source list changed');
save(journal,local);
if (!local.id) {
  const matching = (await api.request('/api/reviews/projects')).filter(p => p.name === name);
  assert(matching.length <= 1, 'Ambiguous project; reconcile manually');
  const project = matching[0] || await api.request('/api/reviews/projects',intent);
  local.id = project.id; save(journal,local);
}
let detail = await api.request(`/api/reviews/projects/${local.id}`);
validateReviewProject(detail,intent);
const assignment = { usernames:['quality_reviewer1','quality_reviewer2'],secondReviewPercent:20,seed:20260930 };
immutable(`${root}/review-assignment-request.json`,assignment);
if (detail.assignments.length === 0) detail = await api.request(`/api/reviews/projects/${local.id}/assign`,assignment);
validateReviewProject(detail,intent);
validateAssignments(detail,assignment);
// Only capture the initial unscored package once. Never overwrite subsequent human activity.
if (!existsSync(`${root}/review-initial.json`)) {
  assert.equal(detail.scores.length,0, 'Existing scores require audit; do not claim newly unscored');
  immutable(`${root}/review-initial.json`,detail);
}
local.prepared = true; save(journal,local);
console.log(JSON.stringify({projectId:local.id,answers:80,assignments:96,reviewers:assignment.usernames,humanScoresSubmittedByScript:0}));

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await main();
