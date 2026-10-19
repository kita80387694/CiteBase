# 检索成本：初步测量与实施边界

更新日期：2026-10-01。**三个成本开关已实现，真实成本探索完成64/64行且本次执行失败0；真人质量非劣化仍未评审，默认配置不变。** 最新结论见本文末节及 `QUALITY_COST_REPORT.md`。以下2026-09-30测量与设计记录按时间保留，不代表目前仍未实现。

## 已测量的成本

本阶段输入：`docs/results/quality-phase3/paired-baseline/rag/*.raw.json`，40个文件、80行（每题vector/hybrid）。正式配对基线预登记使用vector，hybrid是原评测API产生且完整保留的辅助结果。所有80行都纳入耗时统计，包括hybrid的1个失败行；不只统计成功行。统计单位为单题单模式的一次实际执行，P50/P95采用nearest-rank，毫秒；下表各格为均值/P50/P95。

| 阶段 | vector，n=40 | hybrid，n=40 |
|---|---:|---:|
| query embedding | 368.75 / 287 / 656 | 333.12 / 286 / 509 |
| 向量SQL | 1.15 / 1 / 2 | 1.57 / 1 / 3 |
| 关键词SQL | 0 / 0 / 0（未执行） | 2.62 / 2 / 4 |
| RRF融合 | 0 / 0 / 0（未执行） | 0.03 / 0 / 0 |
| 重排 | 0 / 0 / 0（关闭） | 0 / 0 / 0（关闭） |
| 检索合计 | 370.75 / 289 / 658 | 338.80 / 300 / 515 |
| 答案生成 | 6235.60 / 5499 / 11674 | 6105.40 / 4260 / 12410 |
| 端到端 | 6607.45 / 5813 / 11946 | 6445.45 / 4597 / 12754 |

基线vector执行错误0/40、hybrid执行错误1/40；不等同答案正确率。实际embedding totalTokens分别661；chat promptTokens分别68574、68517，completionTokens分别1420、1637，均按原始返回值求和，不是金额。未把未调用rerank的耗时零解释为供应商返回token零。

当前平均耗时主要在生成；即使假设完全消除vector检索耗时，也只相当于基线均值约5.6%的算术上限，不是可实现加速承诺。缓存不能据此宣传几倍端到端加速。向量SQL约1毫秒，现有小语料证据不支持优先更换数据库/索引架构。

历史真实重排证据只使用已经观察的开发集消融：`docs/results/phase2/optimization/b1-k40.raw.json` 与 `c-rerank.raw.json`，每份32行（16题×两模式），candidateK40，前者rerank=false，后者true。

| 历史配置 | 模式 | embedding均值 | rerank均值/P95 | rerank promptTokens观测和 |
|---|---|---:|---:|---:|
| b1-k40 | vector | 339.56 | 0 / 0（关闭） | 未调用 |
| b1-k40 | hybrid | 293.88 | 0 / 0（关闭） | 未调用 |
| c-rerank | vector | 321.94 | 748.88 / 1127 | 91051 |
| c-rerank | hybrid | 383.56 | 875.38 / 1226 | 118362 |

历史重排自身耗时比query embedding更高，存在优化价值；但新40题基线重排关闭，不能把省掉不存在的重排算成收益。历史生成耗时也不同，运行时段、候选内容和模型输出影响总耗时，不能简单相减后归因于一个因素。新策略应先在开发/验证集设有重排的固定对照，单独测量跳过率与质量损失。

输入SHA256：

- 当前40题registration：`76e03847b6de0c334b901d3131a625c4bcfdb61cebfa0c02eac5bd6ecfe567ad`
- 当前rag-config：`e4ac051a47a0b9582fb78a54a2ec8d8893f8db45d0c41c2ff85cc009719c1c51`
- 旧b1-k40.raw：`2039238015a99b0c5d25200928d4d026f89234796bc342d5f0f042ddabaf03f1`
- 旧c-rerank.raw：`329924e85343adc365cb44646ce06a8a9f1857937d8fbb1531bf5ceec9d08034`

## 当前实现必须保留的边界

`RetrievalService.retrieveDetailed`先验证知识库归属，再在vector/keyword SQL中限定user、kb、embedding_model与活动版本。评测另走evaluation_snapshot，允许活动文档更新后继续读取冻结版本；必须保留这个区别。引用访问也分普通活动引用与评测专属引用。

`QuestionService`在模型调用前后验证版本/评测归属，最终发布使用短事务KB共享锁；文档删除使用同一KB独占锁并撤回关联历史和任务。不能为了缓存命中把这些检查跳过，也不能让长模型调用一直持有KB锁。

Agent每轮及最终发布检查冻结snapshot，工具验证完整证据字段。RetrievalService中的真实embedding/rerank使用AgentPolicy预算与TaskContext调用审计。任何跳过或缓存命中都不能伪造外部调用或把历史用量加到当前Agent预算。

RetrievalOutcome的diagnostics目前是可变Map。QuestionService会追加generationMs、rawAnswer、aliasMap与dataVersions；缓存若直接复用这个对象，就可能将上一轮答案或计时带到下一请求。必须只缓存不可变的检索阶段数据，每次返回深拷贝，不缓存生成阶段附加字段。

一个兼容细节：现在vector不重排时，supplied.candidateK是否显式提供会影响实际SQL候选limit，即使normalized options相同。缓存键必须包含实际effectiveCandidateLimit，或先用独立回归消除该歧义，不能只对normalized options做hash。

## 2026-09-30 实现前草案（历史记录，现已实现）

### 条件重排

新增独立rerankPolicy，保持现有rerank=false/true原路径与默认。建议第一版只有off、always和candidate-pressure-v1：候选去重后组数大于topK时才调用，否则跳过，并记录确切decisionReason。该规则不声称模型置信度，不拿RRF分数冒充概率；它可能在本语料上完全没有节省，应保留无收益结果。

如需按相似度margin判断，仅能在vector空间内另做独立开发集标定；RRF排名分数不能沿用同一阈值。未完成真人非劣化评审前不新增或选择这种启发式默认。

### 候选去重

RRF现有按chunkId去重已实现，不能把同一功能再计作新增优化。最小有意义路径是**仅对重排供应商输入做精确文本分组**：保留原始授权候选及每个文档/版本/位置，将字节完全相同文本合并成一个供应商输入，保存representative→原候选成员映射。返回rank index先验证合法、唯一、有限分数，再展开回原候选，按固定原顺序处理同分，最后截取topK。

不删除跨文档证据归属，不折叠gold要求的不同位置；不做大小写/空白/表格归一化或未经验证的近重复阈值。诊断记录rawCandidateCount、uniqueRerankInputs、savedInputCharacters、代表映射与实际调用用量。候选分组不等于最终答案中合并引用。

重排接口可能只返回前N组，展开和topK边界需测试；不能因为分组代表被选中就丢掉其余源元数据。该改动是否改变排名与覆盖必须做消融，不能假定“相同文本就完全等效”。

### 隔离缓存

优先实验有限容量/TTL的进程内检索结果缓存，不增加共享服务。默认关闭，结果质量/故障缓存禁止，超时/限流/异常不缓存。先做正确性与隔离，避免同时引入回答缓存和模型输出复用。

键至少包含：认证userId、kbId、作用域类型ACTIVE或EVALUATION_SNAPSHOT、评测ID（首版不跨评测复用）、有序文档/版本/contentHash摘要、query精确文本hash、embedding/chat环境的公开配置摘要、reranker模型/端点、检索模式、topK、实际候选limit、权重、条件重排与去重版本、引用样式。

命中仍先做归属验证，并在短KB共享锁内核对当前scope版本和所有准备返回的证据（包括diagnostics.trace中的候选，不只selected）。失效立即拒绝返回并逐出，不只是等TTL。评测命中依据其snapshot而不是active_version_id；评测/文档删除后不能继续读取旧snapshot包。

缓存填充只能来自成功且已通过当前授权/版本检查的结果。miss的外部调用不持有KB共享锁；完成后短事务复验再入缓存。命中返回新的diagnostics对象：本次实际provider calls=0，usage.embedding/rerank=null并注明not_called_cache_hit；历史生成用量不得计为本次用量。若展示历史来源成本，另设originUsage且明确不是本次返回值。

多worker缓存各自独立，靠每次DB来源复验保证撤回，不能宣称分布式统一命中率。并发miss可以重复计算但受现有任务/Agent并发限制；是否需要single-flight应根据测量单独实施，不能用跨用户合并请求换取命中。

## 配置与快照兼容

新增字段应保持旧RetrievalOptions四参数构造器、旧JSON缺省、旧Agent请求hash与旧config快照语义。明确区分未提供新字段的原路径与显式实验策略；新增字段必须进入请求幂等摘要、评测normalized_request/config和Agent配置。

引用与长期评测的snapshot不变。缓存不能让评测恢复后的已完成项重跑，也不能把缓存命中记录成一次外部请求。Agent的stop-aware检索预算可以保守预留最坏调用数；命中少调用无需返还虚构用量，但计数应只在实际请求处增加。

## 风险与实验清单

1. 两用户同问题、同文档名不同内容永不串缓存；跨KB隔离。
2. active版本更新、同版本来源删除、KB删除、评测删除及授权撤销后hit也拒绝；在途miss晚到不能填入可见旧数据。
3. 评测旧snapshot在活动版本切换后仍按其合法旧版本检索，不能混入新版本；删除撤回优先。
4. 缓存命中和miss返回Map独立；上一题rawAnswer、aliasMap、generationMs不能污染下一题。
5. query/model/endpoint/dimension/候选limit/模式/策略参数任一变化导致不同键；embedding模型不自动更换。
6. 重排映射越界、重复index、NaN、空结果、超时、429与503明确失败且不缓存。
7. 精确文本重复来自同文档或不同文档，所有元数据可追溯；topK展开和gold证据定位不静默丢失。
8. hit实际调用数为0，未知token不伪造为0，task ledger没有虚构记录；miss遵循Agent预算及取消。
9. 固定模型和文档，分别比较always/conditional、dedup off/on、cache off/cold/warm/mixed；不得同时改变多个因素后单因归因。
10. 冷/热/混合命中比例事先登记；报告全样本错误、用量覆盖、均值/P50/P95。未评分人工指标保持null，未达到质量验收不改默认。

原计划是在Agent探索冒烟确认工程路径稳定后实施上述独立开关；目前已完成实现与真实工程探索。人工质量评审仍是正式参数选择和最终验收的必要依赖。

## 2026-09-30 实施更新（当时记录；验证结果见末节）

上文测量时标记为设计的三个独立开关现已落入源码，但本节撰写时尚未运行Java专项或真实成本实验，不能计作已验证质量改善。

- RetrievalOptions新增rerankPolicy（always/candidate-pressure-v1）、deduplicate、cache。默认规范化为null并从JSON省略，原四参数构造和旧请求序列化保持兼容。严格请求解析同步到基础问答/评测/Agent。
- candidate-pressure-v1在精确分组数大于topK时才重排；否则保留原检索顺序。即使返回集合相同，排序也可能影响答案，不能承诺质量不变。
- RetrievalCandidates仅合并供应商输入的完全相同文本，保存全部chunk成员映射；返回结果验证索引/重复/有限值后展开原位置和文档身份，再按topK截断。不开重排时不改变最终证据集合。
- RetrievalCache为进程内JSON快照缓存：GET反序列化得到新对象，防止QuestionService写入rawAnswer等污染缓存。只有成功结果写入，失败、过期、超容量结果不复用。
- 环境参数：RETRIEVAL_CACHE_MAX_ENTRIES=128（1..10000）、RETRIEVAL_CACHE_TTL_SECONDS=300（1..3600）、RETRIEVAL_CACHE_MAX_BYTES=8000000（1024..100000000）；公开于diagnostics.cost.cache.config，实验必须保存实际值和hit/miss，不能假定数分钟后仍命中。
- cache key含user/KB、ACTIVE或特定evaluationId、完整来源版本、精确query、mode、topK、有效候选limit、全部检索策略与公开模型/供应商/重排配置。没有跨评测ID复用。
- 每次读取/填充在短KB共享锁中核验范围和来源；校验selected及vector/keyword/fused trace全部候选。miss外部模型调用期间不持有锁。ACTIVE换版本新key；评测仍只使用其snapshot，删除评测/KB后拒绝旧缓存。
- diagnostics.cost返回rerankDecision、rawCandidateCount、uniqueRerankInputs、dedupMapping、savedInputCharacters、currentProviderCalls及cache状态。HIT当前embedding/rerank usage为null、调用数0、usageReason=not_called_cache_hit；不把历史token算成本次调用。timings清除旧阶段耗时并新增实际cacheLookupMs。

待主执行：RetrievalCostUnitTest与RetrievalCostIntegrationTest，以及旧Agent/问答/评测核心回归。新增风险覆盖TTL/容量/失败不缓存/深拷贝、跨用户与KB、模型与mode/候选limit隔离、版本更新、长评测snapshot、真实数据库并发删除、非法重排结果和重复文本来源展开。

### 拟登记成本目标与质量门槛（尚未用于选择）

为控制未完成人工评审前的调用规模，实际注册探索使用预先固定4题（dev2/validation2，每组1道不可回答），不按输出选择。分别比较fixed20 always、candidate5 always、candidate5 conditional、fixed20 dedup，以及无缓存重复/cold/hot/mixed。相邻重复才能有明确cold→hot机会；mixed需事先固定新旧问题顺序。各条件只改变一个因素，保存原始调用和服务器cache状态。

探索目标：观察条件重排是否减少实际rerank次数、去重是否减少供应商输入字符、缓存是否减少重复embedding/rerank与检索延迟；不是要求人为制造提升。正式选优拟要求零新增高严重度无依据/引用支持错误，且配对人工正确率差置信区间下界高于-5个百分点，再评估成本收益。4题及未评分数据不足以证明此非劣化门槛，必须报告不确定性；没有真人评分时不能判定通过、不能选默认或宣称完成正式质量验收。

公开预检：当cache/deduplicate/candidate-pressure任一启用，QuestionService.config及Agent创建返回config额外包含retrievalCost，含版本、算法和实际缓存容量/TTL/字节上限；原默认config不添加该字段。可先创建但不execute一个cache=true的Agent读取，付费实验前冻结配置。进程重启清空本地缓存，即使镜像相同也不等于持续warm实验，采集器应额外冻结容器ID和StartedAt。


## 2026-10-01 验证与真实成本结论

专项与兼容测试66项已通过，证据 `results/quality-phase3/engineering/retrieval-cost-tests.txt`。新真实实验报告 `results/quality-phase3/cost-v2-engineering-report.json`，原始输出及任务账本 `results/quality-phase3/cost-exploration-v2/runs/`，详细统计、源码/镜像身份和复现命令见 `QUALITY_COST_REPORT.md`。四道预先固定dev/validation问题、六组配置及两模式/重复流量共64行全部采集，执行错误0/64；不是64道独立题，也不代表答案正确率100%。

- 条件重排与candidate5 always对照：8行重排调用8→0，检索均值850.50→331.88ms；只证明该小样本触发候选压力规则，质量尚未人工确认。
- 缓存与相同重复流量对照：16行实际8 HIT/8 MISS，embedding/rerank各16→8次，generation仍16次，账本调用48→32。检索均值834.06→368.75ms，但P95为1432→1458ms；端到端均值6284.50→5049.75ms，P95为15695→16851ms。保留尾延迟退化，不能把时段/供应商波动当作稳定加速。
- 精确重排输入去重：实际8候选均唯一，节省字符0，重排调用和输入token未减少。延迟差不归因为没有发生的去重。
- Recall@5/MRR在各组可回答行均为1，仅为小样本自动证据指标。人工正确性、引用支持、非劣化结论和默认选择仍为null。未以独立测试集调参，默认开关不变。

旧实验 `cost-exploration/` 与 `cost-interrupted-report.json` 完整保留：24/64行已采集，conditional5的8行因JSONB Long/Integer等价比较缺陷全部CONFIG_CHANGED且外部调用0。修复后新注册重新采集，不能覆盖旧失败或合并分母来声称历史零错误。缓存重启后连续性丢失，所以新运行不是旧warm状态续跑。

当前实现与工程成本路径已经可验证；真人质量非劣化、正式独立测试及生产规模命中/负载结论仍不成立。单实例进程内缓存、多worker独立缓存、TTL未单独统计、4题小样本和顺序运行限制继续有效。


## 2026-10-19 最终成本独立验证

240条真实结果和288份匿名ASSISTED评分已完成，HUMAN覆盖0；两臂各6/120失败，调用360→240，但辅助正确75/120→68/120，40问题聚类差95%区间[-14.375,0]个百分点，未达到预登记门槛。引用支持存在不可评估项，不能写作全面质量通过；原默认保留。完整指标、冷/重复/混合请求、实际用量、恢复与网络环境限制、复算命令见[COST_INDEPENDENT_RESULTS](COST_INDEPENDENT_RESULTS.md)。历史“进行中/未完成”描述仅对应当时阶段，不代表本次采集状态。
