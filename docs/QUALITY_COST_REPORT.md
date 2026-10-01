# 检索成本探索只读报告

运行 `node scripts/quality-cost-report.mjs docs/results/quality-phase3/cost-exploration-v2 NEW-output.json`。输出必须为新文件，原始实验与冻结采集器不改。运行 `node --test scripts/quality-cost-report.test.mjs` 验证统计风险。工具不调用任何服务或模型。

从注册六组64个case/mode意图出发，输出各组overall、vector/hybrid、注册traffic phase×mode的实际统计。未采集行逐项pending，失败保留；完整分母failureRate和当前调用总数在缺样本时为null。观测条件指标另列observedMetrics，不代表完整样本结论。检索与端到端延迟及timings均报告样本数、缺失数、均值、nearest-rank P50/P95。

cold/hot/mixed标签仅代表请求设计。cacheStatuses来自实际diagnostics.cost.cache.status，不假定hot一定命中；当前实现不区分TTL过期miss与首次miss，不能声称报告了独立expiry次数。rerankDecision、原始/唯一候选和节省字符来自实际诊断；HIT时这些候选与决策是缓存来源计算的元数据，不代表本次重新重排。当前调用数以currentProviderCalls为准，命中时可为真实0，供应商usage不可用仍null。

taskAudit读取采集器已保存的终态任务快照：包含有限重试及UNKNOWN调用；缺失时总数null。账本实际用量与最终结果行用量并列，禁止相加重复计算。注册limits只原样列为theoreticalBudget，不能把理论无重试调用值解释为已执行硬上限。配对明细按注册baseCaseId和trafficIndex/mode映射，允许两组caseId不同；保留四项单变量对照，不挑选赢家。

humanCorrectness、humanCitationSupport、selectedDefault保持null，defaultChange=false。检索Recall/MRR、自动拒答信号不能替代真人正确性与引用支持评审。完整性应以实际输出核对，不能仅凭注册意图声称完成。


## 2026-10-01 实际工程结果

新注册真实实验已完成 **64/64 单题×模式行，执行失败 0/64**。证据为 `results/quality-phase3/cost-v2-engineering-report.json`；原始输出和逐任务调用账本位于 `results/quality-phase3/cost-exploration-v2/runs/`。本次文档更新逐一核对了报告 `rawSources` 的 12 个文件 SHA256，并读取原始结果/任务结构。没有删除旧失败实验，没有人工评分，也没有读取独立测试集用于选择参数。

样本是预先固定的四题 `brass-002 / cobalt-019 / dahlia-004 / elm-018`，dev、validation 各一题可回答和一题不可回答。64 行包括两种检索模式和重复流量，**不是 64 道独立问题**。模型为硅基流动 DeepSeek-V3.2、BGE-M3 embedding、BGE-reranker-v2-m3；topK=5，结构切分900/200。注册 SHA256 为 `53940fc5a9e2cad7c9c07bf91420a7444513032995544a00f89235272c933e88`。运行源码基于提交 `939c6a05d86f97ce504f109dc76baee3751fabb4` 加未提交修改，源码摘要 `50a133ef1bb459b64bbe25a3b348177571f2f73e42f8ae2870ffe9e680310026`；不能把结果归于该提交的干净源码。镜像为 `sha256:d8caf87b1946d2b8988e2bd32b8cebfa021f9e6ff1f44016ca9962dbceffbb8a`，完整配置与工作区状态保存在报告 runtime。

以下延迟单位毫秒，统计为均值 / nearest-rank P50 / P95，包含全部执行行；账本调用含 embedding、rerank、generation，不含建库索引调用。

| 配置 | 行数 | 检索延迟 | 端到端延迟 | embedding / rerank 次数 | 任务账本调用数 |
|---|---:|---:|---:|---:|---:|
| fixed20 | 8 | 1182.63 / 1146 / 1643 | 8662 / 6129 / 25726 | 8 / 8 | 24 |
| candidate5 | 8 | 850.50 / 591 / 1716 | 8321.13 / 3124 / 31179 | 8 / 8 | 24 |
| conditional5 | 8 | 331.88 / 303 / 471 | 5418.88 / 2967 / 22247 | 8 / 0 | 16 |
| deduplicate20 | 8 | 764.25 / 607 / 1258 | 6554.38 / 2815 / 18471 | 8 / 8 | 24 |
| repeated-no-cache | 16 | 834.06 / 686 / 1432 | 6284.50 / 4723 / 15695 | 16 / 16 | 48 |
| repeated-cache | 16 | 368.75 / 20 / 1458 | 5049.75 / 4267 / 16851 | 8 / 8 | 32 |

条件重排相对 candidate5 唯一改变调用策略，实际重排从 8 次降至 0 次，八行均记录 `SKIPPED_CANDIDATE_PRESSURE`。候选数等于 topK，仅说明这批样本触发了规则，不能推断一般流量都能跳过重排或答案质量不变。

缓存组实际 **8 MISS、8 HIT**，embedding 与 rerank 分别从 16 次降至 8 次，生成仍为 16 次，任务账本总调用从 **48 降至 32**（减少三分之一）。缓存组检索 P95 为1458，高于未缓存组1432；端到端 P95 为16851，高于15695，因此不能只展示均值下降、宣称普遍加速。顺序执行、小样本和供应商波动限制延迟归因。HIT 的 `rerankDecision=APPLIED` 是缓存来源元数据，不代表本次又调用重排。

精确去重没有收益：fixed20 与 deduplicate20 都是原始候选8、唯一输入8，节省输入字符0，重排输入用量同为14208。两组延迟差不能归因为去重。candidate20 实际只有8个候选，小语料不足以检验大候选池收益。

所有组可回答行的自动 Recall@5/MRR 为1（前四组各4行，重复组各8行），不可回答行自动拒答标志均命中预期。它们不是人工答案正确率、引用支持率或质量非劣证明。`humanCorrectness / humanCitationSupport / selectedDefault` 仍为 null，`defaultChange=false`。

实际供应商用量按字段保留：重复无缓存→缓存的 embedding totalTokens 256→132，rerank promptTokens 28352→14208；generation promptTokens 27219→27219，completionTokens 516→578。缓存组8个HIT的embedding/rerank用量为不可用（未调用），不能伪记供应商返回0。generation/rerank 的 totalTokens 未返回，仍为null；调用数与 token 字段不转换为费用，不重复叠加行用量和账本用量。六组账本没有 UNKNOWN 调用。

## 保留的失败与未完成门槛

旧 `cost-exploration/` 采集了24/64行，其中 conditional5 的8行全部 `CONFIG_CHANGED`，该任务外部调用0；完整部分报告为 `cost-interrupted-report.json`，失败日志为 `engineering/cost-first-collection-failure.txt`。原因是 JSONB 读回的 Long/Integer 数值等价比较缺陷。修复后使用新注册、新运行环境重新执行，旧结果不覆盖、不混入新实验的零失败分母。重启破坏了旧缓存连续性，也不能把新实验称为原 warm 运行续跑。

仍缺真人正确性、引用支持及非劣化评审；独立测试没有参与此次成本选择，也未据此完成正式独立测试验收。缓存TTL失效次数未独立观测，多worker各自缓存的命中率不能由单实例小实验外推。保留全部原始结果与未提升项；默认配置不变。
