# 供应商恢复后的组合报告

58条原记录 + 46条单独补测；原104条及全部补测均保留。未重跑预算/循环失败。完整150次尝试成本覆盖见JSON，表中延迟只统计有效组合行。

# 基础 RAG 与有边界 Agent：冻结对照
生成时间：2026-09-29T07:13:55.493Z；Agent运行提交：8eb9a43bc41ce3e5a4efb2ff8b2bd26fece307e4。
冻结时间：2026-09-29T06:32:32.341Z；完整52题×两模式，失败不排除。人工答案正确性和引用支持度仍为null。

| 路径 | 模式 | 样本 | Recall@5 | MRR@5 | 错误率 | 检索均值/P50/P95 ms | 端到端均值/P50/P95 ms |
|---|---|---:|---:|---:|---:|---|---|
| 基础RAG | vector | 52 | 1.0000 | 1.0000 | 0.0000 | 1063.5385 / 958.0000 / 1635.0000 | 9262.2308 / 6825.0000 / 22888.0000 |
| Agent | vector | 52 | 1.0000 | 1.0000 | 0.3462 | 1237.9423 / 1226.0000 / 1691.0000 | 28216.8269 / 23320.0000 / 63523.0000 |
| 基础RAG | hybrid | 52 | 1.0000 | 1.0000 | 0.0000 | 1147.2692 / 1066.0000 / 1568.0000 | 9679.4808 / 6646.0000 / 22736.0000 |
| Agent | hybrid | 52 | 1.0000 | 1.0000 | 0.3654 | 1126.4231 / 982.0000 / 1769.0000 | 27781.2115 / 21442.0000 / 67218.0000 |

## 执行、累计证据及实际用量

### vector
状态：{"COMPLETED":34,"FAILED":18}；错误：{"BUDGET_EXCEEDED":12,"NO_PROGRESS":6}。
累计证据Recall=1.0000，不等同相同K的检索提升。正确拒答=7/8，引用格式有效=34/52，都不是语义答案正确率。
调用/工具分布：{"plannerSteps":{"availableCount":52,"unavailableCount":0,"mean":2.423076923076923,"p50":2,"p95":4},"tools":{"availableCount":52,"unavailableCount":0,"mean":2.423076923076923,"p50":2,"p95":4},"searches":{"availableCount":52,"unavailableCount":0,"mean":1,"p50":1,"p95":1},"externalCalls":{"availableCount":52,"unavailableCount":0,"mean":5.076923076923077,"p50":5,"p95":6},"evidenceCount":{"availableCount":52,"unavailableCount":0,"mean":5,"p50":5,"p95":5},"evidenceChars":{"availableCount":52,"unavailableCount":0,"mean":1600.7115384615386,"p50":1441,"p95":2459}}。
实际用量与缺失覆盖：{"embedding":{"callRecords":52,"promptTokens":{"availableCount":52,"unavailableCount":0,"observedSum":1061},"completionTokens":{"availableCount":0,"unavailableCount":52,"observedSum":null},"totalTokens":{"availableCount":52,"unavailableCount":0,"observedSum":1061}},"rerank":{"callRecords":52,"promptTokens":{"availableCount":52,"unavailableCount":0,"observedSum":299666},"completionTokens":{"availableCount":52,"unavailableCount":0,"observedSum":0},"totalTokens":{"availableCount":0,"unavailableCount":52,"observedSum":null}},"planner":{"callRecords":126,"promptTokens":{"availableCount":126,"unavailableCount":0,"observedSum":300166},"completionTokens":{"availableCount":126,"unavailableCount":0,"observedSum":5166},"totalTokens":{"availableCount":0,"unavailableCount":126,"observedSum":null}},"generation":{"callRecords":34,"promptTokens":{"availableCount":34,"unavailableCount":0,"observedSum":56489},"completionTokens":{"availableCount":34,"unavailableCount":0,"observedSum":2215},"totalTokens":{"availableCount":0,"unavailableCount":34,"observedSum":null}}}。
用量限制：{"runsMissingUsageArray":0,"explicitlyReportedInFlightUnavailableRuns":0,"inFlightFlagUnavailableRuns":34,"positiveCallRecordGapObserved":0,"note":"Explicit in-flight flags are reported separately. Call-record gaps are an accounting signal, not an exact count of unknown or billable calls: a no-evidence generation may record usage without an external call. Observed sums are not complete billing totals; missing usage remains unavailable."}。

### hybrid
状态：{"COMPLETED":33,"FAILED":19}；错误：{"BUDGET_EXCEEDED":13,"NO_PROGRESS":6}。
累计证据Recall=1.0000，不等同相同K的检索提升。正确拒答=7/8，引用格式有效=33/52，都不是语义答案正确率。
调用/工具分布：{"plannerSteps":{"availableCount":52,"unavailableCount":0,"mean":2.4038461538461537,"p50":2,"p95":4},"tools":{"availableCount":52,"unavailableCount":0,"mean":2.4038461538461537,"p50":2,"p95":4},"searches":{"availableCount":52,"unavailableCount":0,"mean":1,"p50":1,"p95":1},"externalCalls":{"availableCount":52,"unavailableCount":0,"mean":5.038461538461538,"p50":5,"p95":6},"evidenceCount":{"availableCount":52,"unavailableCount":0,"mean":5,"p50":5,"p95":5},"evidenceChars":{"availableCount":52,"unavailableCount":0,"mean":1600.9807692307693,"p50":1441,"p95":3013}}。
实际用量与缺失覆盖：{"embedding":{"callRecords":52,"promptTokens":{"availableCount":52,"unavailableCount":0,"observedSum":1061},"completionTokens":{"availableCount":0,"unavailableCount":52,"observedSum":null},"totalTokens":{"availableCount":52,"unavailableCount":0,"observedSum":1061}},"rerank":{"callRecords":52,"promptTokens":{"availableCount":52,"unavailableCount":0,"observedSum":365071},"completionTokens":{"availableCount":52,"unavailableCount":0,"observedSum":0},"totalTokens":{"availableCount":0,"unavailableCount":52,"observedSum":null}},"planner":{"callRecords":125,"promptTokens":{"availableCount":125,"unavailableCount":0,"observedSum":295980},"completionTokens":{"availableCount":125,"unavailableCount":0,"observedSum":5144},"totalTokens":{"availableCount":0,"unavailableCount":125,"observedSum":null}},"generation":{"callRecords":33,"promptTokens":{"availableCount":33,"unavailableCount":0,"observedSum":53943},"completionTokens":{"availableCount":33,"unavailableCount":0,"observedSum":2546},"totalTokens":{"availableCount":0,"unavailableCount":33,"observedSum":null}}}。
用量限制：{"runsMissingUsageArray":0,"explicitlyReportedInFlightUnavailableRuns":0,"inFlightFlagUnavailableRuns":33,"positiveCallRecordGapObserved":0,"note":"Explicit in-flight flags are reported separately. Call-record gaps are an accounting signal, not an exact count of unknown or billable calls: a no-evidence generation may record usage without an external call. Observed sums are not complete billing totals; missing usage remains unavailable."}。

## 全部执行失败
- tide-005 / vector：BUDGET_EXCEEDED，运行dab3a97c-b349-4d0a-8384-4d5220dfe1a4。
- tide-006 / vector：BUDGET_EXCEEDED，运行dd58a788-a4ee-4852-92df-ab092a43397e。
- tide-006 / hybrid：BUDGET_EXCEEDED，运行e938b436-ddf6-4dd1-999c-175474a65449。
- tide-007 / hybrid：BUDGET_EXCEEDED，运行f2d914f0-efd7-409d-b051-67b0625f7754。
- tide-008 / vector：BUDGET_EXCEEDED，运行a5440d3b-c9b4-493c-a0ab-da3d3b0fafe6。
- tide-008 / hybrid：BUDGET_EXCEEDED，运行fa5a8e65-6d70-4703-a787-1cc213f95604。
- tide-010 / hybrid：BUDGET_EXCEEDED，运行006718f4-5f95-4f3c-94ea-01a7a9cb67aa。
- tide-012 / vector：BUDGET_EXCEEDED，运行b00eebaa-f54e-45dc-a063-e485068f82d1。
- tide-012 / hybrid：NO_PROGRESS，运行f5503c61-3819-4d90-b874-93191a42ae4e。
- tide-015 / vector：BUDGET_EXCEEDED，运行960fd0a7-aa5d-462b-90bb-f66f26cc81f3。
- tide-015 / hybrid：BUDGET_EXCEEDED，运行3e90842f-afc1-411a-af63-f5376685e5fc。
- tide-016 / vector：NO_PROGRESS，运行a8363d3c-1242-4e57-8e1c-fc67ea746061。
- tide-016 / hybrid：NO_PROGRESS，运行231346f4-df8f-4fd2-a4ef-d8e481b8f88d。
- tide-017 / vector：BUDGET_EXCEEDED，运行a3339747-afd1-46f5-8737-54d58a284638。
- tide-017 / hybrid：BUDGET_EXCEEDED，运行0bd4e313-4562-4ee9-9f7b-282927ddcd18。
- tide-018 / vector：BUDGET_EXCEEDED，运行ba027468-3a3f-4a29-9f7e-84acd5181dc1。
- tide-018 / hybrid：BUDGET_EXCEEDED，运行27598313-7b47-4eab-bbdc-dd8b3ec1f67f。
- tide-019 / vector：BUDGET_EXCEEDED，运行3ec780c7-d34a-4496-85ad-f155e0072d7c。
- tide-019 / hybrid：BUDGET_EXCEEDED，运行783ead17-047b-4293-80d3-8214724831a4。
- tide-026 / vector：NO_PROGRESS，运行ba19dfe2-320b-4257-a23d-d6a19a0f07d1。
- tide-026 / hybrid：BUDGET_EXCEEDED，运行792c31ec-8b1b-47b4-92c5-96cce3201964。
- ember-005 / hybrid：BUDGET_EXCEEDED，运行37909fe2-5533-47d8-a6fb-d076a70f1fe3。
- ember-011 / vector：BUDGET_EXCEEDED，运行11979f4e-b372-464b-96c3-d609ea27dde9。
- ember-012 / vector：BUDGET_EXCEEDED，运行0f080e40-7a2b-4d12-a41d-5ad0c2d30222。
- ember-012 / hybrid：BUDGET_EXCEEDED，运行c015dc6a-69e1-481b-8edd-6ebafbb10193。
- ember-014 / vector：BUDGET_EXCEEDED，运行555c23e8-45f9-42e9-b653-b8817fd9160c。
- ember-014 / hybrid：BUDGET_EXCEEDED，运行54c52eab-9c56-41a0-bc33-7967759022dd。
- ember-017 / vector：NO_PROGRESS，运行b3c00544-8e75-485f-ac8c-c603b9958978。
- ember-017 / hybrid：NO_PROGRESS，运行3fdeedf6-b56e-42da-9a92-9bdab717be01。
- ember-018 / vector：NO_PROGRESS，运行38f459b9-0095-4981-a22f-6921f4edef90。
- ember-018 / hybrid：NO_PROGRESS，运行da7cc538-763e-454d-b60c-58eb57709b8d。
- ember-019 / vector：BUDGET_EXCEEDED，运行cee2e6bd-6c50-4180-820e-b29db31239ef。
- ember-019 / hybrid：BUDGET_EXCEEDED，运行5e3c981a-b1d0-4522-b356-5eff7a5492b5。
- ember-020 / vector：NO_PROGRESS，运行074c3927-82ad-4501-922c-09f9ddcdcee5。
- ember-020 / hybrid：NO_PROGRESS，运行6400d7d5-24e4-4986-b8a2-f27a9deb8e2b。
- ember-022 / vector：NO_PROGRESS，运行b65f35ea-8ce2-46af-9969-af8a0d593aaa。
- ember-022 / hybrid：NO_PROGRESS，运行07f61e3f-f387-41c6-bf79-4d81fe460809。

## 口径与限制
- Composite: 58 original non-provider-error rows plus 46 separately registered recovered rows. Original104 and all recovery attempts remain immutable. Original21 budget/loop failures are not retried or removed.
- Effective-row latency excludes earlier failed attempts. All150 attempt usage/failures are separately reported; observed usage is not complete billing, and unknown original calls may have been billed.
- Shared previously evaluated phase2 benchmark; no new test-tuned selection.
- First five Agent evidence is acquisition order; accumulated recall permits up to published maxEvidence and is not equivalent-cost Recall@5.
- Agent final output is capped at 1024 tokens; base retains original provider settings. This compares the complete bounded treatment, not solely supplemental retrieval.
- Actual timings reflect separate run times, not controlled causal performance gains.
- Citation format and reference substring are auxiliary metrics, never semantic correctness; human review remains null.
- Agent retrievalMs covers cumulative search-tool time; base retrievalMs covers its single retrieval.
- Failures remain in quality denominators; missing latency and usage have explicit coverage.

完整逐题回答、证据、用量和输入SHA见配套JSON及原始test目录；没有把自动辅助信号写成人工评审。
