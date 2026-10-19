# 阶段二消融与自动错误分析
范围：dev_only；运行提交：da20d5193a5862d37ad03d3f39ddd51005d0a7f2；源码 SHA256：c4152b1994ed1d064423cc4b105383b7a9ad0d7372d87cdc0787932be46d1e0d。
人工答案正确性：未评分（null）。失败行保留，自动信号不是人工判分。
| Variant | Mode | Rows | Recall@K | MRR | Errors | 检索 mean/p50/p95 ms | 总耗时 mean/p50/p95 ms |
|---|---|---:|---:|---:|---:|---|---|
| a-legacy900 | vector | 16 | 1.0000 | 0.8893 | 6 | 355.8750/305.0000/846.0000 | 10101.7500/9158.0000/21156.0000 |
| a-legacy900 | hybrid | 16 | 0.7143 | 0.6905 | 2 | 337.4375/316.0000/479.0000 | 6944.5625/3928.0000/27272.0000 |
| a-structure900 | vector | 16 | 1.0000 | 0.8929 | 1 | 333.5625/278.0000/580.0000 | 11139.5625/9316.0000/23866.0000 |
| a-structure900 | hybrid | 16 | 0.9286 | 0.7976 | 0 | 325.1875/301.0000/543.0000 | 12378.7500/6294.0000/42256.0000 |

## 配置、用量覆盖和失败题

### a-legacy900
配置：{"id":"legacy900","strategy":"legacy","size":900,"overlap":200} / {"candidateK":20,"keywordWeight":1,"rerank":false,"citationStyle":"uuid"}；状态：COMPLETED_WITH_ERRORS。
vector usage：chatPrompt 16/16，观测合计 14699；chatCompletion 16/16，观测合计 1573；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 17172；chatCompletion 16/16，观测合计 1104；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
- lumen-003 / hybrid：missing_required_evidence；error=null；Recall=0.0000。
- moss-004 / vector：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- moss-004 / hybrid：missing_required_evidence；error=null；Recall=0.0000。
- harbor-005 / hybrid：missing_required_evidence；error=null；Recall=0.0000。
- lumen-008 / vector：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- moss-022 / vector：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- lumen-016 / vector：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- lumen-016 / hybrid：execution_error, missing_required_evidence, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=0.5000。
- quartz-019 / vector：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- quartz-019 / hybrid：missing_required_evidence；error=null；Recall=0.5000。
- moss-014 / vector：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- moss-014 / hybrid：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- quartz-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### a-structure900
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":20,"keywordWeight":1,"rerank":false,"citationStyle":"uuid"}；状态：COMPLETED_WITH_ERRORS。
vector usage：chatPrompt 16/16，观测合计 28040；chatCompletion 16/16，观测合计 1589；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 34016；chatCompletion 16/16，观测合计 1303；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
- lumen-003 / hybrid：missing_required_evidence；error=null；Recall=0.0000。
- moss-004 / vector：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- harbor-005 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-005 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-007 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

## 对照与限制
- a-structure900 vs a-legacy900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0.0035714285714286698,"errorCount":-5},"hybrid":{"recallAtK":0.2142857142857143,"mrr":0.1071428571428571,"errorCount":-2}}。Paired observed difference, not a causal or generalization claim.

只读输入及 SHA256、逐题原文证据、配置快照见配套 JSON。未冻结时不读取 test-frozen 原始文件。未完成批次不作效果结论。
