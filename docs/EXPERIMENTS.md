# 第二阶段实验记录

## 实验规则

- 保留第一阶段所有原始结果；第二阶段写入 `docs/results/phase2/`。
- 仅在开发集选择切分、候选、权重及reranker参数；冻结后才分析独立测试集。按主题分组，近重复问题和跨文档关联不跨split。
- 每次运行关联实际部署的commit、源码SHA-256和镜像ID，不能把未提交修改的运行归因于旧HEAD。运行器另记录本地脚本/样例摘要。
- 实验使用专用Compose项目 `citebase-phase2` 与独立知识库。不得清空现有演示数据。
- 原始JSON不可覆盖；服务超时先从持久任务列表恢复，不能自动重提收费请求。
- 基础检索与Agent使用相同语料、题集、模型和版本。失败题保留，不能只统计成功样本。
- 人工答案正确性、引用支持程度须明确来源；没有人工评审时为null。自动字面匹配只是辅助信号。

## 已执行基线检查

2026-09-28，在 `1559a144e6a978a107e4584ddd6e773c4777d862` 的原有后端修改前重跑36项核心测试：0失败、0错误、0跳过，包含实际Testcontainers；前端构建成功。记录 `results/phase2/original-baseline-verification.json`。这验证工程基线，不是新增语料上的效果评测。

## 可复现入口

`scripts/phase2-experiment.mjs`：独立知识库幂等准备、真实模式检查、每批8题、长连接、提交意图/服务端记录核对、原始结果导出。默认只运行dev；test必须显式选择。参数：`--label`、`--seed`、`--run`、`--split dev|test`、`--dataset`、`--documents`、`--batch-size`、`--runtime-manifest`。环境变量 `CITEBASE_URL` 默认为 `http://localhost:28080`。

运行前必须生成实际部署清单（commit/sourceSha256/imageId），默认读取 `.tools/phase2-runtime.json`。恢复同一实验时数据哈希、运行时、批次边界必须一致；条件改变用新label，不能覆盖旧结果。

`node scripts/summarize-phase2.mjs <label> dev` 只读取该实验dev原始文件，生成派生摘要；test同理。Recall/MRR按可回答题宏平均；失败/缺失检索指标计0；延迟为所有有计时返回的行，P50/P95使用nearest-rank；token统计注明可用覆盖数，缺失为null。分组证据全命中与至少命中一组分别保留。

## 阶段状态

- 扩充语料真实基线：待生成器、严格标签校验和评分风险测试完成后执行。
- 检索消融：未开始，不使用独立测试集选参。
- Agent对比：未开始。
- 异步与多worker验证：未开始。

## 拒答口径修正

冻结基线后端的原始abstentionCorrect仅表示不可回答题输出了拒答，可能把供应商失败或非法引用拦截误计为正确。原始JSON保留不改；派生摘要phase2-derived-v2仅在abstained=true、citationValid=true、error=null时计正确拒答，失败仍进入不可回答题分母，另列defensiveAbstentionErrorCount。不能将防御性失败归为正常答案。node --test scripts/phase2-summary.test.mjs新增对应测试通过。后端展示字段需在后续代码更新统一修正，不将基线原字段直接作为结论。
