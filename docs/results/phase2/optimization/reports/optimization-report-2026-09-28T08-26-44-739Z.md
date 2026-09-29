# 阶段二消融与自动错误分析
范围：dev_only；运行提交：da20d5193a5862d37ad03d3f39ddd51005d0a7f2；源码 SHA256：c4152b1994ed1d064423cc4b105383b7a9ad0d7372d87cdc0787932be46d1e0d。
人工答案正确性：未评分（null）。失败行保留，自动信号不是人工判分。
| Variant | Mode | Rows | Recall@K | MRR | Errors | 检索 mean/p50/p95 ms | 总耗时 mean/p50/p95 ms |
|---|---|---:|---:|---:|---:|---|---|
| a-legacy900 | vector | 16 | 1.0000 | 0.8893 | 6 | 355.8750/305.0000/846.0000 | 10101.7500/9158.0000/21156.0000 |
| a-legacy900 | hybrid | 16 | 0.7143 | 0.6905 | 2 | 337.4375/316.0000/479.0000 | 6944.5625/3928.0000/27272.0000 |
| a-structure900 | vector | 16 | 1.0000 | 0.8929 | 1 | 333.5625/278.0000/580.0000 | 11139.5625/9316.0000/23866.0000 |
| a-structure900 | hybrid | 16 | 0.9286 | 0.7976 | 0 | 325.1875/301.0000/543.0000 | 12378.7500/6294.0000/42256.0000 |
| a-structure600 | vector | 16 | 1.0000 | 0.8929 | 1 | 333.5625/302.0000/537.0000 | 8707.9375/10501.0000/16496.0000 |
| a-structure600 | hybrid | 16 | 0.8929 | 0.7262 | 2 | 345.3125/303.0000/583.0000 | 9317.3125/8299.0000/27283.0000 |
| a-structure1200 | vector | 16 | 1.0000 | 0.9286 | 0 | 338.8125/286.0000/627.0000 | 10527.6875/6070.0000/31391.0000 |
| a-structure1200 | hybrid | 16 | 0.8929 | 0.8571 | 0 | 315.1250/283.0000/535.0000 | 8484.9375/6352.0000/27421.0000 |
| a-structure900-o0 | vector | 16 | 1.0000 | 0.8750 | 1 | 306.5625/284.0000/523.0000 | 10221.2500/5596.0000/28967.0000 |
| a-structure900-o0 | hybrid | 16 | 0.8571 | 0.7440 | 0 | 332.2500/292.0000/541.0000 | 8862.8125/6344.0000/29252.0000 |
| a-structure900-o100 | vector | 16 | 1.0000 | 0.8274 | 2 | 384.5625/282.0000/931.0000 | 9552.0625/4744.0000/39148.0000 |
| a-structure900-o100 | hybrid | 16 | 0.8929 | 0.7262 | 1 | 360.6250/290.0000/1023.0000 | 9240.0000/4219.0000/25499.0000 |

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

### a-structure600
配置：{"id":"structure600","strategy":"structure-v1","size":600,"overlap":200} / {"candidateK":20,"keywordWeight":1,"rerank":false,"citationStyle":"uuid"}；状态：COMPLETED_WITH_ERRORS。
vector usage：chatPrompt 16/16，观测合计 26996；chatCompletion 16/16，观测合计 1593；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 31295；chatCompletion 16/16，观测合计 1539；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
- moss-004 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-004 / hybrid：missing_required_evidence；error=null；Recall=0.0000。
- harbor-005 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-005 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-007 / vector：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- quartz-007 / hybrid：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- lumen-016 / hybrid：missing_required_evidence；error=null；Recall=0.5000。
- moss-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-010 / hybrid：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- lumen-010 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### a-structure1200
配置：{"id":"structure1200","strategy":"structure-v1","size":1200,"overlap":200} / {"candidateK":20,"keywordWeight":1,"rerank":false,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 16/16，观测合计 27558；chatCompletion 16/16，观测合计 1474；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 34870；chatCompletion 16/16，观测合计 1561；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
- moss-004 / hybrid：missing_required_evidence；error=null；Recall=0.0000。
- harbor-005 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-005 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-016 / hybrid：missing_required_evidence；error=null；Recall=0.5000。
- moss-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### a-structure900-o0
配置：{"id":"structure900-o0","strategy":"structure-v1","size":900,"overlap":0} / {"candidateK":20,"keywordWeight":1,"rerank":false,"citationStyle":"uuid"}；状态：COMPLETED_WITH_ERRORS。
vector usage：chatPrompt 16/16，观测合计 26443；chatCompletion 16/16，观测合计 1556；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 31338；chatCompletion 16/16，观测合计 1744；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
- moss-004 / hybrid：missing_required_evidence；error=null；Recall=0.0000。
- harbor-005 / vector：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- harbor-005 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-016 / hybrid：missing_required_evidence；error=null；Recall=0.5000。
- quartz-019 / hybrid：missing_required_evidence；error=null；Recall=0.5000。
- moss-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### a-structure900-o100
配置：{"id":"structure900-o100","strategy":"structure-v1","size":900,"overlap":100} / {"candidateK":20,"keywordWeight":1,"rerank":false,"citationStyle":"uuid"}；状态：COMPLETED_WITH_ERRORS。
vector usage：chatPrompt 16/16，观测合计 26725；chatCompletion 16/16，观测合计 1440；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 31963；chatCompletion 16/16，观测合计 1504；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
- moss-004 / vector：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- moss-004 / hybrid：missing_required_evidence；error=null；Recall=0.0000。
- harbor-005 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-005 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-022 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-016 / vector：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- lumen-016 / hybrid：missing_required_evidence；error=null；Recall=0.5000。
- moss-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-014 / hybrid：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- quartz-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

## 对照与限制
- a-structure900 vs a-legacy900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0.0035714285714286698,"errorCount":-5},"hybrid":{"recallAtK":0.2142857142857143,"mrr":0.1071428571428571,"errorCount":-2}}。Paired observed difference, not a causal or generalization claim.
- a-structure600 vs a-structure900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0,"errorCount":0},"hybrid":{"recallAtK":-0.0357142857142857,"mrr":-0.0714285714285714,"errorCount":2}}。Paired observed difference, not a causal or generalization claim.
- a-structure1200 vs a-structure900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0.0357142857142857,"errorCount":-1},"hybrid":{"recallAtK":-0.0357142857142857,"mrr":0.059523809523809534,"errorCount":0}}。Paired observed difference, not a causal or generalization claim.
- a-structure900-o0 vs a-structure900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":-0.017857142857142905,"errorCount":0},"hybrid":{"recallAtK":-0.07142857142857151,"mrr":-0.0535714285714286,"errorCount":0}}。Paired observed difference, not a causal or generalization claim.
- a-structure900-o100 vs a-structure900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":-0.06547619047619058,"errorCount":1},"hybrid":{"recallAtK":-0.0357142857142857,"mrr":-0.0714285714285714,"errorCount":1}}。Paired observed difference, not a causal or generalization claim.

只读输入及 SHA256、逐题原文证据、配置快照见配套 JSON。未冻结时不读取 test-frozen 原始文件。未完成批次不作效果结论。
