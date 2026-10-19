# Quality review API v1

All routes are under `/api/reviews`, authenticated using existing bearer sessions. No role or identity is accepted from a score body. This grants review-package access only, never knowledge-base or retrieval access.

## Owner
- `GET /projects` → array `{id,name,ruleVersion,createdAt}` owned projects only.
- `POST /projects` body `{name,ruleVersion,sources:[{kind:"EVALUATION"|"AGENT",runId,caseId?,mode?}]}` → owner project detail. Evaluation without caseId/mode expands all persisted terminal result rows, including failures; explicit caseId requires matching mode. Maximum 1000 answers. Sources must belong to caller. No arbitrary answer import.
- `GET /projects/{id}`, `GET /projects/{id}/export` → `{id,name,ruleVersion,items,assignments,scores,stats}`.
- items: `{id,source:{kind,runId,caseId?,mode?},status:"AVAILABLE"|"WITHDRAWN",modelMode}`. MOCK remains explicitly identifiable to owner and cannot substantiate real quality conclusions.
- assignments: `{id,itemId,username,revoked,ordinal}`.
- scores: append-only `{id,itemId,assignmentId:null|string,scoredBy,kind:"HUMAN"|"ADJUDICATION",payload,createdAt}`.
- stats: `{items,assignments,scoredAssignments,doubleReviewedItems,disputedItems,agreement:null|number}`. Agreement is exact agreement across all five dimensions among latest independent reviews, excluding rationale, per multiply reviewed item; denominator zero → null. It is not chance-corrected kappa and not accuracy.
- `POST /projects/{id}/assign` body `{usernames:[existingUsername,...],secondReviewPercent:20,seed:20260930}`. One primary per item, ceil(percent × items) assigned to a distinct second reviewer. Requires two users when percentage > 0. Seeded shuffled order, immutable once assigned; second call returns409.
- `POST /projects/{id}/revoke` body `{username}` revokes all package assignments for that user.
- `POST /projects/{id}/adjudications` body `{itemId,...scoreFields}`. Requires at least two independent human scores, appends decision retaining disagreements.

## Reviewer (strictly separate blind endpoints)
- `GET /assignments` → array `{id,projectName,ruleVersion,ordinal,status,scored}`; only caller's non-revoked assignments.
- `GET /assignments/{id}` → `{id,projectName,ruleVersion,status,question,answer,executionFailed,evidence,citations,referenceAnswer,latestScore,history}`.
- evidence: `{label:string,documentName,page,paragraph,text}`; citations is array of matching labels. No source run IDs, mode, model, config, latency, token usage, trace, owner identity or tool count is returned. Natural answer style can still reveal differences; this is configuration blinding, not guaranteed indistinguishability.
- latestScore: null or `{id,payload,createdAt}`; history is caller's append-only scores. Other reviewers' scores are not exposed before independent scoring.
- Withdrawn result returns only identity/title/rule/status; no answer/evidence/history.
- `POST /assignments/{id}/scores` → refreshed blind detail.
- `POST /scores/import` body `{scores:[{assignmentId,...scoreFields}]}`. Authenticated reviewer may import only their own assignments, transactionally; no scorer impersonation or arbitrary source import.

Score fields (all required, no unknown fields):
```
correctness: CORRECT | PARTIAL | INCORRECT | NA
completeness: CORRECT | PARTIAL | INCORRECT | NA
citationSupport: SUPPORTED | PARTIAL | UNSUPPORTED | NA
unsupportedContent: NONE | PRESENT | NA
refusal: CORRECT_REFUSAL | INCORRECT_REFUSAL | NOT_REFUSED | NA
rationale: nonempty string, max4000
```
No event means UNRATED/null, never correct. NA is explicitly inapplicable, not missing and not zero. Only actual authenticated user submission is HUMAN; no automatic scoring endpoint exists. Project ruleVersion is immutable and binds all events.

On every package read/score the source owner, source row digest, knowledge-base existence and document/version dependency snapshot are rechecked. Deletion, source mutation or version switching conservatively withdraws the package. Revocation blocks assignment read and score. Source failures remain eligible and visible as executionFailed; raw provider failure text is not exposed to blind reviewers.

## Reference packages and withdrawal details
`GET /projects/{id}/items/{itemId}` is owner-only and returns the same safe content packet for adjudication. `referenceAnswer`, `answerable`, and `expectedEvidence:[{documentName,page,paragraph,quote,group}]` are present in available packets. Same group means alternatives; separate groups are required separately. Unspecified legacy groups become independent groups. Agent references are associated only from an existing evaluation of the exact same question, owner and KB, then checked against current authorized document hashes; absent references remain null. No user-supplied gold answer is accepted by this endpoint.

Source JSON digests use recursively sorted map keys. Source mutation, any KB document-set/version change, or deletion conservatively withdraws the packet. Owner score export redacts payloads for withdrawn items too, so a rationale cannot reveal deleted source text. Audit IDs/timestamps remain retained. The current agreement statistic includes latest recorded reviews; withdrawal is visible on the corresponding item and consumers must not interpret withheld labels as current quality evidence.

Review project name and ruleVersion should be neutral (e.g. “质量评审 2026-09”); an owner can inherently unblind their own experiment, so formal blind reviewers should be different people from the experiment owner. The system hides configuration fields, not stylistic clues in generated prose.

## Human provenance boundary
Authentication proves which account submitted a score; it cannot prove that a human rather than automation controlled that account, nor that two accounts represent two distinct people. Formal HUMAN evidence therefore requires an actual reviewer roster and user confirmation of who performed the work. Browser E2E and integration fixtures exercise the HUMAN submission path only in isolated MOCK/test projects: their events must never be counted as genuine human review coverage. No actual human review was generated by this implementation.

Withdrawal counts are explicit: `withdrawnItems` and `activeScoredAssignments`. Agreement and dispute statistics use only still-available items; all recorded audit events remain retained, with withdrawn payloads redacted. No score or NA value is converted to correctness.

### Source audit hardening
AGENT sources accept exactly `kind` and `runId`; evaluation-only fields are rejected rather than silently ignored. Associated Agent gold references store an internal evaluation identity and canonical digest and are revalidated on every read/score; reference removal or mutation withdraws the package. Those internal identities are never returned in reviewer packets. Owner exports hold the same knowledge-base shared locks as source-package reads, using a consistent sorted KB order, and compute availability once before exposing any score rationale. V9 schema is unchanged.
