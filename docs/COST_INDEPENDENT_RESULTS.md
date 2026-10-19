# 第三阶段冻结成本独立结果（2026-10-19）

结论：完成采集和辅助评分，但不采用候选默认。固定20候选always重排与开发集预先选择的5候选conditional重排比较：调用账本360→240（−33.33%），辅助正确75/120→68/120。40个基础问题等权聚类的配对差−6.875个百分点，95% bootstrap区间[−14.375,0]个百分点，未满足下界严格高于−5个百分点的预登记门槛。真人覆盖0；这不是人工非劣结论。

## 范围与不可变输入

40基础问题、两个检索模式、固定冷/重复/混合流量，80任务共240终态行。240主评+48复核=288份ASSISTED评分，两位匿名AI各144份，无双评分歧，不制造裁决。原分批评分及合并文件均保留。独立集未用于重新选配置；候选缓存/去重均关闭，不把重复阶段称作缓存命中。开发六配置64行的单因素消融另见QUALITY_COST_REPORT.md。独立对照同时改变候选数量和条件策略，只评价组合，不把差异归因于单个因素。

原始文件：results/quality-phase3/assisted-cost-independent-v1/{freeze.json,runs,tasks}；分段恢复：assisted-cost-recovery-20261010与assisted-cost-recovery-20261019；匿名评分、工程报告、比较、汇总：assisted-cost-independent-review-v1。comparison-initial.json是完整最终比较，无争议无需改名或覆盖。summary.json保留输入SHA，complete=true表示采集/评分完整，decision=INCOMPLETE_EVIDENCE表示候选所有质量门槛无法证成，不能解读为采集没完成。

## 质量与失败

两臂各6/120执行失败（5%），失败一律计正确率0；错误拒答和正常完成但不正确的回答也保留。新出现2处unsupportedContent和1处citationSupport分类退化；部分失败/拒答的citationSupport为NA，汇总仍将全量“无新增支持错误”门槛保留null，不强填通过。即使不考虑该未知项，正确率区间门槛已经失败，足以决定保留原默认。不同AI共享偏差、单次生成随机性和40个问题规模限制外推。

| 配置/模式 | 失败/60 | Recall@5 | MRR | 检索ms均值/P50/P95（可用/计划） | 端到端ms均值/P50/P95（可用/计划） |
|---|---:|---:|---:|---|---|
| control/vector | 4 | 1 | 1 | 472.88 / 354 / 981（60/60） | 7741.15 / 4533 / 21511（60/60） |
| control/hybrid | 2 | 1 | 1 | 436.82 / 328 / 1043（60/60） | 7761.87 / 5142 / 22434（60/60） |
| candidate/vector | 4 | 1 | 0.94 | 162.05 / 108 / 381（60/60） | 8782 / 5171 / 31072（60/60） |
| candidate/hybrid | 2 | 0.96 | 0.91 | 158.62 / 111 / 413（58/60） | 7157.57 / 4831 / 20698（58/60） |

Recall/MRR每格47个可回答请求，包括重复流量，不是47道独立题；不可回答题不进入检索指标。候选hybrid的2条中断没有延迟，明确58/60，不记0、不从失败率分母剔除。行级来源和缺失字段见report.json。

## 预登记流量分组

下面cold/warm/mixed是请求安排名称；两臂缓存均OFF，warm不表示命中。各组包含可用时间的失败，不只统计成功。

| 配置/流量 | 失败/计划 | 检索均值/P50/P95（可用/计划） | 端到端均值/P50/P95（可用/计划） |
|---|---:|---|---|
| control/cold | 4/60 | 569.07 / 386 / 1124（60/60） | 7550.5 / 5980 / 15477（60/60） |
| control/warm | 1/20 | 320.25 / 303 / 387（20/20） | 11318.25 / 5122 / 31720（20/20） |
| control/mixed-new | 0/20 | 359.4 / 320 / 449（20/20） | 4358.7 / 2225 / 6663（20/20） |
| control/mixed-repeat | 1/20 | 342.25 / 323 / 434（20/20） | 8180.6 / 4266 / 22434（20/20） |
| candidate/cold | 4/60 | 207.64 / 145 / 510（59/60） | 8792.83 / 6073 / 36949（59/60） |
| candidate/warm | 1/20 | 102.63 / 99 / 116（19/20） | 7528.42 / 6029 / 20698（19/20） |
| candidate/mixed-new | 0/20 | 117.55 / 110 / 182（20/20） | 5641.25 / 3092 / 16244（20/20） |
| candidate/mixed-repeat | 1/20 | 118.55 / 106 / 144（20/20） | 8370.85 / 3044 / 32833（20/20） |

## 调用与实际用量

索引12次embedding独立计，评测600次账本尝试包含2次UNKNOWN，不等于已结算账单。控制embedding/rerank/generation各120；候选embedding/generation各120、rerank0。三次generation用量不可用（两中断、一次超时）；RETURNED表示适配器结束，不保证供应商成功。

| 臂/提供能力 | 次数 | 实际promptTokens观测和（可用次数） | 实际completionTokens观测和（可用次数） | 实际totalTokens观测和（可用次数） |
|---|---:|---:|---:|---:|
| control/embedding | 120 | 2186（120） | 不可用（0） | 2186（120） |
| control/rerank | 120 | 326952（120） | 0（120） | 不可用（0） |
| control/generation | 120 | 206060（119） | 4184（119） | 不可用（0） |
| candidate/embedding | 120 | 2186（120） | 不可用（0） | 2186（120） |
| candidate/generation | 120 | 204039（118） | 4080（118） | 不可用（0） |

embedding模型BAAI/bge-m3，生成deepseek-ai/DeepSeek-V3.2，重排BAAI/bge-reranker-v2-m3。模型名来自冻结配置，不伪称每个响应返回模型身份。重排completionTokens=0为供应商实际字段；未提供totalTokens保持不可用，不相加推算。不估价。

## 恢复与延迟局限

同容器/镜像/模型/源码的三个StartedAt段跨10月1、10、19日。两次中断结果和UNKNOWN均保留，不重复提交；一次PROVIDER_TIMEOUT经原始文件/任务/调查哈希精确登记后才继续剩余题，冻结collector不修改。原state.json字节保持，完成状态在20261019恢复目录collection-state.json。代码身份由freeze、collector-provenance与continuation-provenance区分，结果归档提交不是运行时源码身份。

Docker代理修复发生在212行已保存之后，末28行运行环境变化；BuildKit另设置仅进程代理。三StartedAt不能捕获同一段内所有网络变化。上述延迟只描述观察，不能证明因果加速、稳定P95或生产容量；原始运行段与行来源均保留。短时本机补充负载是否竞争也不能由这些数据排除。

## 本地复算（无模型调用）

```powershell
node scripts/quality-cost-independent-comparison.mjs docs/results/quality-phase3/assisted-cost-independent-review-v1/packets.json docs/results/quality-phase3/assisted-cost-independent-review-v1/private-mapping.json docs/results/quality-phase3/assisted-cost-independent-review-v1/scores-A.json docs/results/quality-phase3/assisted-cost-independent-review-v1/scores-B.json .tools/cost-comparison-recomputed.json
node scripts/quality-cost-independent-summary.mjs docs/results/quality-phase3/assisted-cost-independent-review-v1/report.json .tools/cost-comparison-recomputed.json docs/results/quality-phase3/assisted-cost-independent-v1/freeze.json .tools/cost-summary-recomputed.json
```

输出路径必须不存在，避免覆盖历史。实验完成不等于优化成功；保留可选开关、原默认和全部退化/失败。
