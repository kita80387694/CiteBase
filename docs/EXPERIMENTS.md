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
- 检索消融：开发子集 A/B/C/D、完整开发集确认及冻结后的独立测试均完成；共664行，失败及中断来源保留。
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

## 阶段二实际进展（2026-09-29）

A/B1/B2已完成10个配置、320条真实问答，原始结果位于results/phase2/optimization。预登记规则选择structure-v1 900/200、candidateK=40、关键词权重1；仅为16题开发子集选择，尚非独立测试结论。结构方案增加上下文token代价，低关键词权重没有收益，均保留原始记录。

C重排实验在25/32条后遇运行环境中断。封存c-rerank.interrupted.raw.json，原服务端运行不改写；恢复脚本只补缺失7条，将合成结果明确标记composite-recovered-evaluation并关联每份原始响应/hash。原在途调用是否计费、用量多少未知，单独记录null，不能把恢复结果当成一次无中断批次。D别名消融、全开发集确认、配置冻结及独立测试尚待执行，测试集仍不用于选参。

## 完整开发集确认与冻结

所选配置为结构900/200、候选40、关键词权重1、专用重排开启、UUID引用。开发集104题×2模式完整配对；vector/hybrid Recall均1、MRR均0.965909，错误0/104与4/104。检索均值约1.09秒，聊天输入190926/190868 tokens，另有reranker输入611385/730678 tokens；这比原基线付出更多上下文与重排成本。人工正确性未评分，端到端时延仅观察值。

完整开发集报告在results/phase2/optimization/reports/final-report-2026-09-29T05-36-01-417Z.*，包含逐题配对、失败、来源与实际usage覆盖率。2026-09-29T05:36:15.129Z已保存final-configuration.json，之后才启动独立52题测试。通用默认保持legacy/vector、rerank关闭，优化配置作为显式选择；独立测试完成前不作泛化结论。

复现边界：记录的是供应商模型标识、请求参数、源文件与代码摘要；兼容接口没有提供可锁定的模型权重构建版本。即使temperature=0，跨日调用也不保证逐字输出或重排浮点分数完全相同。原始结果可审查，复现命令可重跑，但不承诺外部服务的逐字确定性。

## 冻结独立测试结果（2026-09-29完成）

最终报告：[完整配对JSON](results/phase2/optimization/reports/final-report-2026-09-29T05-45-23-139Z.json)、[可读报告](results/phase2/optimization/reports/final-report-2026-09-29T05-45-23-139Z.md)。30个配置/批次共664条优化实验结果，全部指标重算通过；独立test为52题、44可答、8不可答，双模式104行。源代码冻结da20d51，选择冻结于本地提交3a51d0a；原基线代码90145a5来源另列，不能把两者称为相同二进制。

| 独立测试配置 | Recall@5 | MRR | 执行错误/52 | 检索均值/P50/P95 ms | 端到端均值/P50/P95 ms |
|---|---:|---:|---:|---|---|
| 原vector | .965909 | .892803 | 5 | 369.06/303/757 | 9282.79/6908/23898 |
| 原hybrid | .814394 | .807576 | 3 | 348.71/313/563 | 10989.37/8393/28524 |
| 优化vector | 1 | 1 | 0 | 1063.54/958/1635 | 9262.23/6825/22888 |
| 优化hybrid | 1 | 1 | 0 | 1147.27/1066/1568 | 9679.48/6646/22736 |

两优化模式均正确拒答8/8（排除执行错误的口径），但答案语义正确性和引用支持未人工评分，不是100%答案正确率。聊天输入由原45456/47816升至85773/86319，另有专用reranker输入299675/365073；检索耗时增加。供应商未提供rerank总tokens，保持null；不把不同模型输入token简单相加当价格或完整成本。

开发子集的原UUID与compact对照均无错误，按预登记规则未改变UUID；降低关键词权重未改善排名，保留权重1；结构1200虽局部MRR更高但Recall更低，未选用。所有退化记录保留。优化两模式本测试没有差距，不宣称混合必然更优，也不修改通用默认。没有加入缺乏错误分析依据的查询改写或多查询RAG Fusion。

## 新环境复现实验入口

需要已配置真实CHAT/EMBEDDING/RERANK接口及可用额度，先完成一个真实问答冒烟。使用新的Compose项目和空闲端口，不删除演示卷；下面会重新索引12份文档并最多执行664条生成结果，模型调用会消耗供应商额度。新源码版本必须记录为新实验，不能冒充上述冻结版本结果。若需严格复核历史实现，应在另一个干净检出中使用da20d51的后端，并记录相应构建/源码清单。

```powershell
$runTag = Get-Date -Format yyyyMMddHHmmss
$projectName = "citebase-phase2-repro-$runTag"
$env:API_PORT = '38080'
$env:WEB_PORT = '35173'
$env:DB_PORT = '35432'
$env:MODEL_MODE = 'real'
docker compose -p $projectName up --build -d
if ($LASTEXITCODE -ne 0) { throw 'Compose启动失败，请先排障' }
New-Item -ItemType Directory -Force .tools | Out-Null
$env:CITEBASE_URL = 'http://localhost:38080'
$env:PHASE2_EXPERIMENT_DIR = "docs/results/phase2/reproduce-$runTag"
$env:PHASE2_RUNTIME_MANIFEST = ".tools/reproduce-$runTag-runtime.json"
$env:PHASE2_KB_PREFIX = "Phase2 reproduce $runTag"
node scripts/capture-runtime.mjs "$projectName-backend" $env:PHASE2_RUNTIME_MANIFEST
foreach ($stage in @('seed','a','b1','b2','c','d','dev','freeze','test')) {
  node scripts/phase2-optimize.mjs $stage
  if ($LASTEXITCODE -ne 0) { throw "阶段 $stage 停止：检查持久状态，不盲目重提" }
}
node scripts/check-phase2-results.mjs $env:PHASE2_EXPERIMENT_DIR all
node scripts/report-phase2-optimization.mjs $env:PHASE2_EXPERIMENT_DIR
node scripts/report-phase2-final.mjs $env:PHASE2_EXPERIMENT_DIR
```

首次下载依赖和真实索引需要时间，等待Compose健康后再调用脚本。同轮恢复保留projectName/runTag、运行时清单、知识库和目录；重新运行同一阶段会核对并复用已持久完成的结果，不要为解决客户端超时新建整批。引用别名单变量的上下文可比性失败会主动停止，应如实记录，不能删除失败结果。历史中断的专用7条恢复脚本只适用已记录的那次事件，不是通用恢复服务。完成后可用原projectName执行docker compose stop保留数据；不要删除卷。
