# 阶段二消融与自动错误分析
范围：dev_and_available_frozen_test；运行提交：da20d5193a5862d37ad03d3f39ddd51005d0a7f2；源码 SHA256：c4152b1994ed1d064423cc4b105383b7a9ad0d7372d87cdc0787932be46d1e0d。
人工答案正确性：未评分（null）。失败行保留，自动信号不是人工判分。

> **c-rerank 为组合恢复结果**：原 25 行 + 补 7 行，不是单次无中断实验。未知在途调用 moss-014:hybrid 的实际执行状态及用量不可用；不宣称免费重试，也不将操作中断伪装为回答错误。表中延迟和用量只统计已保存回答，不含停机/恢复等待或未知调用成本。

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
| b1-k10 | vector | 16 | 1.0000 | 0.8929 | 0 | 301.8125/285.0000/380.0000 | 7408.5625/6068.0000/14130.0000 |
| b1-k10 | hybrid | 16 | 0.9643 | 0.8155 | 0 | 334.8750/305.0000/488.0000 | 10471.8750/10201.0000/34033.0000 |
| b1-k40 | vector | 16 | 1.0000 | 0.8929 | 0 | 359.1250/308.0000/690.0000 | 10266.7500/9887.0000/24516.0000 |
| b1-k40 | hybrid | 16 | 1.0000 | 0.8119 | 0 | 324.8750/308.0000/487.0000 | 11959.5625/7022.0000/33275.0000 |
| b2-w0_25 | vector | 16 | 1.0000 | 0.8929 | 0 | 330.1875/286.0000/895.0000 | 9118.1875/5084.0000/27605.0000 |
| b2-w0_25 | hybrid | 16 | 1.0000 | 0.7976 | 0 | 341.3125/305.0000/536.0000 | 7305.4375/6266.0000/21710.0000 |
| b2-w0_5 | vector | 16 | 1.0000 | 0.8929 | 0 | 349.5625/303.0000/876.0000 | 10786.0625/7246.0000/32344.0000 |
| b2-w0_5 | hybrid | 16 | 1.0000 | 0.7857 | 0 | 305.5625/295.0000/398.0000 | 5746.5000/3928.0000/15254.0000 |
| c-rerank（组合恢复） | vector | 16 | 1.0000 | 0.9167 | 0 | 1088.5625/1050.0000/1407.0000 | 9924.3750/5496.0000/26518.0000 |
| c-rerank（组合恢复） | hybrid | 16 | 1.0000 | 0.9167 | 0 | 1291.5625/1288.0000/2218.0000 | 10485.1250/6007.0000/25425.0000 |
| d-compact | vector | 16 | 1.0000 | 0.9167 | 0 | 1088.7500/977.0000/2465.0000 | 8578.3750/8302.0000/16184.0000 |
| d-compact | hybrid | 16 | 1.0000 | 0.9167 | 0 | 1114.8750/992.0000/1660.0000 | 7428.8125/7397.0000/12401.0000 |
| dev-confirm-0 | vector | 8 | 1.0000 | 1.0000 | 0 | 1024.5000/925.0000/1168.0000 | 9096.3750/7504.0000/14341.0000 |
| dev-confirm-0 | hybrid | 8 | 1.0000 | 1.0000 | 0 | 1103.6250/976.0000/1868.0000 | 9640.3750/8238.0000/15564.0000 |
| dev-confirm-1 | vector | 8 | 1.0000 | 1.0000 | 0 | 1052.3750/988.0000/1430.0000 | 11389.6250/10710.0000/21536.0000 |
| dev-confirm-1 | hybrid | 8 | 1.0000 | 1.0000 | 1 | 1069.6250/917.0000/1463.0000 | 13223.1250/9383.0000/22718.0000 |
| dev-confirm-3 | vector | 8 | 1.0000 | 1.0000 | 0 | 996.0000/1021.0000/1079.0000 | 9596.7500/6020.0000/26993.0000 |
| dev-confirm-3 | hybrid | 8 | 1.0000 | 1.0000 | 1 | 1133.1250/995.0000/1747.0000 | 8037.3750/6806.0000/15459.0000 |
| dev-confirm-2 | vector | 8 | 1.0000 | 0.9000 | 0 | 1141.0000/948.0000/1915.0000 | 17141.5000/11686.0000/31817.0000 |
| dev-confirm-2 | hybrid | 8 | 1.0000 | 0.9000 | 1 | 1012.2500/933.0000/1236.0000 | 7441.5000/6182.0000/12808.0000 |
| dev-confirm-5 | vector | 8 | 1.0000 | 0.8333 | 0 | 1066.5000/938.0000/1311.0000 | 7859.0000/5450.0000/14844.0000 |
| dev-confirm-5 | hybrid | 8 | 1.0000 | 0.8333 | 0 | 1084.8750/955.0000/1499.0000 | 4949.0000/4727.0000/6454.0000 |
| dev-confirm-4 | vector | 8 | 1.0000 | 1.0000 | 0 | 926.1250/926.0000/960.0000 | 7083.2500/6737.0000/11837.0000 |
| dev-confirm-4 | hybrid | 8 | 1.0000 | 1.0000 | 0 | 1055.2500/1009.0000/1262.0000 | 9624.6250/6728.0000/23525.0000 |
| dev-confirm-6 | vector | 8 | 1.0000 | 1.0000 | 0 | 1311.5000/985.0000/3036.0000 | 9104.2500/6323.0000/17730.0000 |
| dev-confirm-6 | hybrid | 8 | 1.0000 | 1.0000 | 1 | 1090.8750/1036.0000/1353.0000 | 9964.3750/9417.0000/13919.0000 |
| dev-confirm-7 | vector | 8 | 1.0000 | 1.0000 | 0 | 1215.6250/993.0000/1952.0000 | 8737.6250/7357.0000/16733.0000 |
| dev-confirm-7 | hybrid | 8 | 1.0000 | 1.0000 | 0 | 1021.7500/997.0000/1155.0000 | 13033.2500/10214.0000/27370.0000 |
| dev-confirm-8 | vector | 8 | 1.0000 | 0.8889 | 0 | 1100.7500/1029.0000/1343.0000 | 7068.7500/6333.0000/15051.0000 |
| dev-confirm-8 | hybrid | 8 | 1.0000 | 0.8889 | 0 | 1016.0000/984.0000/1321.0000 | 8919.0000/6128.0000/21437.0000 |
| dev-confirm-9 | vector | 8 | 1.0000 | 1.0000 | 0 | 1154.0000/982.0000/1591.0000 | 8888.5000/7069.0000/19048.0000 |
| dev-confirm-9 | hybrid | 8 | 1.0000 | 1.0000 | 0 | 1043.7500/989.0000/1405.0000 | 9666.7500/7441.0000/16069.0000 |
| dev-confirm-10 | vector | 8 | 1.0000 | 1.0000 | 0 | 986.5000/902.0000/1294.0000 | 6669.0000/4641.0000/17832.0000 |
| dev-confirm-10 | hybrid | 8 | 1.0000 | 1.0000 | 0 | 1011.6250/1011.0000/1210.0000 | 7006.7500/4805.0000/21629.0000 |
| test-frozen-0 | vector | 8 | 1.0000 | 1.0000 | 0 | 979.2500/902.0000/1486.0000 | 7683.8750/6887.0000/13683.0000 |
| test-frozen-0 | hybrid | 8 | 1.0000 | 1.0000 | 0 | 1074.0000/1066.0000/1227.0000 | 8789.5000/4688.0000/22439.0000 |
| test-frozen-1 | vector | 8 | 1.0000 | 1.0000 | 0 | 1084.7500/990.0000/1635.0000 | 10684.5000/6314.0000/38287.0000 |
| test-frozen-1 | hybrid | 8 | 1.0000 | 1.0000 | 0 | 1163.3750/944.0000/1568.0000 | 10374.3750/7951.0000/18646.0000 |
| test-frozen-3 | vector | 8 | 1.0000 | 1.0000 | 0 | 1115.2500/1021.0000/1481.0000 | 7405.2500/4543.0000/13678.0000 |
| test-frozen-3 | hybrid | 8 | 1.0000 | 1.0000 | 0 | 1012.2500/947.0000/1329.0000 | 6662.5000/4900.0000/16914.0000 |
| test-frozen-2 | vector | 8 | 1.0000 | 1.0000 | 0 | 1227.5000/1010.0000/2082.0000 | 9716.0000/6801.0000/24153.0000 |
| test-frozen-2 | hybrid | 8 | 1.0000 | 1.0000 | 0 | 1182.2500/1066.0000/1622.0000 | 9922.3750/6253.0000/34559.0000 |
| test-frozen-4 | vector | 8 | 1.0000 | 1.0000 | 0 | 1021.6250/947.0000/1415.0000 | 11124.3750/9422.0000/21926.0000 |
| test-frozen-4 | hybrid | 8 | 1.0000 | 1.0000 | 0 | 1133.6250/1082.0000/1470.0000 | 11721.3750/5121.0000/28529.0000 |
| test-frozen-5 | vector | 8 | 1.0000 | 1.0000 | 0 | 929.2500/898.0000/1001.0000 | 10978.0000/6825.0000/22888.0000 |
| test-frozen-5 | hybrid | 8 | 1.0000 | 1.0000 | 0 | 1415.7500/1162.0000/2700.0000 | 11940.5000/10675.0000/22736.0000 |
| test-frozen-6 | vector | 4 | 不可用 | 不可用 | 0 | 1110.7500/896.0000/1533.0000 | 5225.0000/3248.0000/10108.0000 |
| test-frozen-6 | hybrid | 4 | 不可用 | 不可用 | 0 | 952.0000/950.0000/1010.0000 | 7012.0000/3817.0000/12267.0000 |

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

### b1-k10
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":10,"keywordWeight":1,"rerank":false,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 16/16，观测合计 28041；chatCompletion 16/16，观测合计 1247；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 37327；chatCompletion 16/16，观测合计 1297；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
- moss-004 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-005 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-005 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-007 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-010 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / hybrid：missing_required_evidence；error=null；Recall=0.5000。

### b1-k40
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":false,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 16/16，观测合计 28041；chatCompletion 16/16，观测合计 1475；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 34009；chatCompletion 16/16，观测合计 1411；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
- harbor-005 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-005 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-007 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### b2-w0_25
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":0.25,"rerank":false,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 16/16，观测合计 28041；chatCompletion 16/16，观测合计 1548；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 28228；chatCompletion 16/16，观测合计 1420；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
- harbor-005 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-005 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### b2-w0_5
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":0.5,"rerank":false,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 16/16，观测合计 28039；chatCompletion 16/16，观测合计 1290；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 29810；chatCompletion 16/16，观测合计 1343；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 0/16，观测合计 不可用；rerankCompletion 0/16，观测合计 不可用；rerankTotal 0/16，观测合计 不可用
- harbor-005 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-005 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### c-rerank
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 16/16，观测合计 27838；chatCompletion 16/16，观测合计 1304；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 16/16，观测合计 91051；rerankCompletion 16/16，观测合计 0；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 27833；chatCompletion 16/16，观测合计 1523；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 16/16，观测合计 118362；rerankCompletion 16/16，观测合计 0；rerankTotal 0/16，观测合计 不可用
- harbor-005 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-005 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### d-compact
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"compact"}；状态：COMPLETED。
vector usage：chatPrompt 16/16，观测合计 26186；chatCompletion 16/16，观测合计 1179；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 16/16，观测合计 91051；rerankCompletion 16/16，观测合计 0；rerankTotal 0/16，观测合计 不可用
hybrid usage：chatPrompt 16/16，观测合计 26180；chatCompletion 16/16，观测合计 1148；embeddingPrompt 16/16，观测合计 311；embeddingTotal 16/16，观测合计 311；rerankPrompt 16/16，观测合计 118372；rerankCompletion 16/16，观测合计 0；rerankTotal 0/16，观测合计 不可用
- harbor-005 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-005 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### dev-confirm-0
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 20084；chatCompletion 8/8，观测合计 562；embeddingPrompt 8/8，观测合计 170；embeddingTotal 8/8，观测合计 170；rerankPrompt 8/8，观测合计 47190；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 20088；chatCompletion 8/8，观测合计 592；embeddingPrompt 8/8，观测合计 170；embeddingTotal 8/8，观测合计 170；rerankPrompt 8/8，观测合计 59121；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- harbor-004 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-004 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-009 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### dev-confirm-1
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED_WITH_ERRORS。
vector usage：chatPrompt 8/8，观测合计 19777；chatCompletion 8/8，观测合计 1393；embeddingPrompt 8/8，观测合计 204；embeddingTotal 8/8，观测合计 204；rerankPrompt 8/8，观测合计 48956；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 19778；chatCompletion 8/8，观测合计 1005；embeddingPrompt 8/8，观测合计 204；embeddingTotal 8/8，观测合计 204；rerankPrompt 8/8，观测合计 59157；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- harbor-010 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-010 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- harbor-016 / hybrid：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- harbor-017 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### dev-confirm-3
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED_WITH_ERRORS。
vector usage：chatPrompt 8/8，观测合计 12198；chatCompletion 8/8，观测合计 578；embeddingPrompt 8/8，观测合计 187；embeddingTotal 8/8，观测合计 187；rerankPrompt 8/8，观测合计 46095；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 12197；chatCompletion 8/8，观测合计 501；embeddingPrompt 8/8，观测合计 187；embeddingTotal 8/8，观测合计 187；rerankPrompt 8/8，观测合计 55989；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- quartz-004 / hybrid：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- quartz-009 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-009 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-011 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-011 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-012 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### dev-confirm-2
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED_WITH_ERRORS。
vector usage：chatPrompt 8/8，观测合计 18555；chatCompletion 8/8，观测合计 643；embeddingPrompt 8/8，观测合计 137；embeddingTotal 8/8，观测合计 137；rerankPrompt 8/8，观测合计 46736；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 18553；chatCompletion 8/8，观测合计 694；embeddingPrompt 8/8，观测合计 137；embeddingTotal 8/8，观测合计 137；rerankPrompt 8/8，观测合计 51599；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- quartz-003 / hybrid：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。

### dev-confirm-5
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 15216；chatCompletion 8/8，观测合计 398；embeddingPrompt 8/8，观测合计 124；embeddingTotal 8/8，观测合计 124；rerankPrompt 8/8，观测合计 43431；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 15215；chatCompletion 8/8，观测合计 222；embeddingPrompt 8/8，观测合计 124；embeddingTotal 8/8，观测合计 124；rerankPrompt 8/8，观测合计 49171；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用

### dev-confirm-4
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 12383；chatCompletion 8/8，观测合计 578；embeddingPrompt 8/8，观测合计 176；embeddingTotal 8/8，观测合计 176；rerankPrompt 8/8，观测合计 44484；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 12390；chatCompletion 8/8，观测合计 546；embeddingPrompt 8/8，观测合计 176；embeddingTotal 8/8，观测合计 176；rerankPrompt 8/8，观测合计 55582；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- quartz-015 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-015 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-017 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- quartz-017 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### dev-confirm-6
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED_WITH_ERRORS。
vector usage：chatPrompt 8/8，观测合计 12875；chatCompletion 8/8，观测合计 452；embeddingPrompt 8/8，观测合计 176；embeddingTotal 8/8，观测合计 176；rerankPrompt 8/8，观测合计 48993；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 12810；chatCompletion 8/8，观测合计 792；embeddingPrompt 8/8，观测合计 176；embeddingTotal 8/8，观测合计 176；rerankPrompt 8/8，观测合计 57773；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- moss-009 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-009 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-010 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-010 / hybrid：execution_error, all_evidence_hit_but_abstained, citation_not_valid；error="模型引用不属于本次检索结果"；Recall=1.0000。
- moss-013 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-013 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### dev-confirm-7
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 13535；chatCompletion 8/8，观测合计 590；embeddingPrompt 8/8，观测合计 177；embeddingTotal 8/8，观测合计 177；rerankPrompt 8/8，观测合计 50773；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 13538；chatCompletion 8/8，观测合计 619；embeddingPrompt 8/8，观测合计 177；embeddingTotal 8/8，观测合计 177；rerankPrompt 8/8，观测合计 59665；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- moss-018 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- moss-018 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### dev-confirm-8
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 12607；chatCompletion 8/8，观测合计 461；embeddingPrompt 8/8，观测合计 153；embeddingTotal 8/8，观测合计 153；rerankPrompt 8/8，观测合计 52004；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 12607；chatCompletion 8/8，观测合计 557；embeddingPrompt 8/8，观测合计 153；embeddingTotal 8/8，观测合计 153；rerankPrompt 8/8，观测合计 56523；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用

### dev-confirm-9
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 12129；chatCompletion 8/8，观测合计 772；embeddingPrompt 8/8，观测合计 178；embeddingTotal 8/8，观测合计 178；rerankPrompt 8/8，观测合计 51920；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 12131；chatCompletion 8/8，观测合计 752；embeddingPrompt 8/8，观测合计 178；embeddingTotal 8/8，观测合计 178；rerankPrompt 8/8，观测合计 61230；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- lumen-009 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-009 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-012 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-013 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-013 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-015 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-015 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- lumen-017 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### dev-confirm-10
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 13729；chatCompletion 8/8，观测合计 411；embeddingPrompt 8/8，观测合计 141；embeddingTotal 8/8，观测合计 141；rerankPrompt 8/8，观测合计 39752；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 13728；chatCompletion 8/8，观测合计 400；embeddingPrompt 8/8，观测合计 141；embeddingTotal 8/8，观测合计 141；rerankPrompt 8/8，观测合计 46506；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用

### test-frozen-0
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 12764；chatCompletion 8/8，观测合计 416；embeddingPrompt 8/8，观测合计 147；embeddingTotal 8/8，观测合计 147；rerankPrompt 8/8，观测合计 45960；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 12765；chatCompletion 8/8，观测合计 467；embeddingPrompt 8/8，观测合计 147；embeddingTotal 8/8，观测合计 147；rerankPrompt 8/8，观测合计 52687；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- tide-004 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- tide-004 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- tide-006 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- tide-006 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### test-frozen-1
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 15169；chatCompletion 8/8，观测合计 696；embeddingPrompt 8/8，观测合计 202；embeddingTotal 8/8，观测合计 202；rerankPrompt 8/8，观测合计 51852；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 15169；chatCompletion 8/8，观测合计 828；embeddingPrompt 8/8，观测合计 202；embeddingTotal 8/8，观测合计 202；rerankPrompt 8/8，观测合计 59665；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- tide-011 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- tide-012 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- tide-012 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- tide-013 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- tide-013 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- tide-016 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- tide-016 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### test-frozen-3
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 12771；chatCompletion 8/8，观测合计 317；embeddingPrompt 8/8，观测合计 144；embeddingTotal 8/8，观测合计 144；rerankPrompt 8/8，观测合计 42591；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 12775；chatCompletion 8/8，观测合计 436；embeddingPrompt 8/8，观测合计 144；embeddingTotal 8/8，观测合计 144；rerankPrompt 8/8，观测合计 53003；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- ember-004 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### test-frozen-2
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 13408；chatCompletion 8/8，观测合计 651；embeddingPrompt 8/8，观测合计 167；embeddingTotal 8/8，观测合计 167；rerankPrompt 8/8，观测合计 53546；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 13941；chatCompletion 8/8，观测合计 554；embeddingPrompt 8/8，观测合计 167；embeddingTotal 8/8，观测合计 167；rerankPrompt 8/8，观测合计 60498；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- tide-018 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- tide-018 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### test-frozen-4
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 12210；chatCompletion 8/8，观测合计 442；embeddingPrompt 8/8，观测合计 167；embeddingTotal 8/8，观测合计 167；rerankPrompt 8/8，观测合计 39259；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 12213；chatCompletion 8/8，观测合计 743；embeddingPrompt 8/8，观测合计 167；embeddingTotal 8/8，观测合计 167；rerankPrompt 8/8，观测合计 59177；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
- ember-009 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- ember-011 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- ember-012 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- ember-012 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- ember-013 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- ember-014 / vector：all_evidence_hit_but_abstained；error=null；Recall=1.0000。
- ember-014 / hybrid：all_evidence_hit_but_abstained；error=null；Recall=1.0000。

### test-frozen-5
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 8/8，观测合计 12821；chatCompletion 8/8，观测合计 846；embeddingPrompt 8/8，观测合计 176；embeddingTotal 8/8，观测合计 176；rerankPrompt 8/8，观测合计 47313；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用
hybrid usage：chatPrompt 8/8，观测合计 12821；chatCompletion 8/8，观测合计 874；embeddingPrompt 8/8，观测合计 176；embeddingTotal 8/8，观测合计 176；rerankPrompt 8/8，观测合计 58815；rerankCompletion 8/8，观测合计 0；rerankTotal 0/8，观测合计 不可用

### test-frozen-6
配置：{"id":"structure900","strategy":"structure-v1","size":900,"overlap":200} / {"candidateK":40,"keywordWeight":1,"rerank":true,"citationStyle":"uuid"}；状态：COMPLETED。
vector usage：chatPrompt 4/4，观测合计 6630；chatCompletion 4/4，观测合计 171；embeddingPrompt 4/4，观测合计 58；embeddingTotal 4/4，观测合计 58；rerankPrompt 4/4，观测合计 19154；rerankCompletion 4/4，观测合计 0；rerankTotal 0/4，观测合计 不可用
hybrid usage：chatPrompt 4/4，观测合计 6635；chatCompletion 4/4，观测合计 134；embeddingPrompt 4/4，观测合计 58；embeddingTotal 4/4，观测合计 58；rerankPrompt 4/4，观测合计 21228；rerankCompletion 4/4，观测合计 0；rerankTotal 0/4，观测合计 不可用

## 对照与限制
- a-structure900 vs a-legacy900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0.0035714285714286698,"errorCount":-5},"hybrid":{"recallAtK":0.2142857142857143,"mrr":0.1071428571428571,"errorCount":-2}}。Paired observed difference, not a causal or generalization claim.
- a-structure600 vs a-structure900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0,"errorCount":0},"hybrid":{"recallAtK":-0.0357142857142857,"mrr":-0.0714285714285714,"errorCount":2}}。Paired observed difference, not a causal or generalization claim.
- a-structure1200 vs a-structure900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0.0357142857142857,"errorCount":-1},"hybrid":{"recallAtK":-0.0357142857142857,"mrr":0.059523809523809534,"errorCount":0}}。Paired observed difference, not a causal or generalization claim.
- a-structure900-o0 vs a-structure900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":-0.017857142857142905,"errorCount":0},"hybrid":{"recallAtK":-0.07142857142857151,"mrr":-0.0535714285714286,"errorCount":0}}。Paired observed difference, not a causal or generalization claim.
- a-structure900-o100 vs a-structure900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":-0.06547619047619058,"errorCount":1},"hybrid":{"recallAtK":-0.0357142857142857,"mrr":-0.0714285714285714,"errorCount":1}}。Paired observed difference, not a causal or generalization claim.
- b1-k10 vs a-structure900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0,"errorCount":-1},"hybrid":{"recallAtK":0.0357142857142857,"mrr":0.017857142857142905,"errorCount":0}}。Paired observed difference, not a causal or generalization claim.
- b1-k40 vs a-structure900：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0,"errorCount":-1},"hybrid":{"recallAtK":0.0714285714285714,"mrr":0.014285714285714346,"errorCount":0}}。Paired observed difference, not a causal or generalization claim.
- b2-w0_25 vs b1-k40：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0,"errorCount":0},"hybrid":{"recallAtK":0,"mrr":-0.014285714285714346,"errorCount":0}}。Paired observed difference, not a causal or generalization claim.
- b2-w0_5 vs b1-k40：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0,"errorCount":0},"hybrid":{"recallAtK":0,"mrr":-0.02619047619047621,"errorCount":0}}。Paired observed difference, not a causal or generalization claim.
- c-rerank vs b1-k40：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0.023809523809523836,"errorCount":0},"hybrid":{"recallAtK":0,"mrr":0.10476190476190483,"errorCount":0}}。Paired observed difference, not a causal or generalization claim.
- d-compact vs c-rerank：同题=true；Δ={"vector":{"recallAtK":0,"mrr":0,"errorCount":0},"hybrid":{"recallAtK":0,"mrr":0,"errorCount":0}}。Use recorded compactComparison; no citation-alias attribution if retrieval contexts differ.

只读输入及 SHA256、逐题原文证据、配置快照见配套 JSON。未冻结时不读取 test-frozen 原始文件。未完成批次不作效果结论。
- c-rerank: composite-recovered-evaluation，原始持久化 25 行 + 单独恢复 7 行；不是单次无中断实验。操作中断不计为回答错误，未知在途调用用量不包含在观测合计内。
