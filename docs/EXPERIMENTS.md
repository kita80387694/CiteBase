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

- 扩充语料真实基线：已完成312行，开发集结果见下文，test暂封存。
- 检索消融：未开始，不使用独立测试集选参。
- Agent对比：未开始。
- 异步与多worker验证：未开始。

## 拒答口径修正

冻结基线后端的原始abstentionCorrect仅表示不可回答题输出了拒答，可能把供应商失败或非法引用拦截误计为正确。原始JSON保留不改；派生摘要phase2-derived-v2仅在abstained=true、citationValid=true、error=null时计正确拒答，失败仍进入不可回答题分母，另列defensiveAbstentionErrorCount。不能将防御性失败归为正常答案。node --test scripts/phase2-summary.test.mjs新增对应测试通过。后端字段已在24c382b修正并通过25项回归，基线运行期间未部署，不将基线原字段直接作为结论。

## 阶段一冻结真实基线（2026-09-28完成）

代码90145a5，DeepSeek-V3.2/BGE-M3，12文档220块，156题双配置共312行，20个唯一数据库批次。开发集104题208行完整；独立测试集52题104行已封存，只做完整性检查，待开发集选参冻结后分析。原始文件在results/phase2/baseline及baseline-holdout，部署commit/镜像/源码摘要/数据哈希位于各state.json；没有将当前24c382b的未部署修复冒充基线代码。

| 开发集配置 | Recall@5 | MRR | 错误/104 | 检索均值/P50/P95 ms | 端到端均值/P50/P95 ms | 正确拒答/16 |
|---|---:|---:|---:|---|---|---:|
| vector | 0.901515 | 0.853598 | 9 | 352.22 / 303 / 665 | 10274.48 / 7141 / 27173 | 16 |
| hybrid 等权RRF | 0.740530 | 0.754735 | 11 | 340.86 / 311 / 516 | 9741.61 / 7065 / 21799 | 13 |

Recall/MRR为88可答题的必需证据组宏平均；延迟与错误包含全部104行。正确拒答按派生v2口径排除错误；hybrid另有3个错误导致防御拒答。聊天供应商实际prompt/completion tokens分别为vector 93710/8350、hybrid 102459/7754，均104/104可用；embedding usage未采集，不把此值称完整模型成本。人工正确性与引用支持仍null；字面参考匹配不能当正确性。并发执行及网络波动使延迟仅为本轮观察，不做显著性或生产性能结论。

独立测试完成后空出的并发用于同名预提交dev88/96批，主runner按现有持久记录复用；只读SQL最终验证20批=20唯一名称=312行。prefetch日志包含调度器源码摘要与实际运行manifest，没有额外重跑问题。检索优化尚未执行，本轮混合召回较低，不更改默认向量。

## 阶段二预登记实验

首次优化调用前固定results/phase2/registration/plan.json与tuning.json。开发子集按8题类×2不同主题确定16题，每主题4题；固定seed与SHA排序选题，不按失败表现挑题，不读取test。全部端到端配置使用同一子集并保留原始行，之后用全dev确认，再冻结配置并评估test。

先保持900/200比较legacy与结构边界；结构长度600/900/1200时固定绝对overlap200，另在900长度单独比较overlap0/100/200。随后依次仅调整candidateK、关键词权重、专用reranker、引用别名，每阶段保留控制组。长度变化隐含重叠比例变化，因此只归因于长度参数，不声称独立比例收益。具体选择阈值及最多700新增生成行/两个评测并发限制见预登记JSON；任何偏离必须在实验开始前记录原因。
