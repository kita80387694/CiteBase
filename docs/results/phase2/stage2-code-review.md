# 阶段二冻结版本代码审查

审查日期：2026-09-28。审查方式：只读检查实现、既有测试及执行日志；未部署、未调用真实模型、未读取 holdout 结果。本报告不代表真实优化实验已完成。

## 版本与证据

- 运行清单：`.tools/phase2-stage2-runtime.json`，commit `da20d5193a5862d37ad03d3f39ddd51005d0a7f2`，sourceSha256 `c4152b1994ed1d064423cc4b105383b7a9ad0d7372d87cdc0787932be46d1e0d`。
- 镜像：`sha256:ce29871312627ee4763dc0aa9ce0f403eb1c0db6351d705f7deb4dcce5063a70`。审查时逐文件核对清单哈希，与工作区一致。该检查确认源文件对应关系，不是重新部署验证。
- `.tools/phase2-stage2-integrated-tests.log`：2026-09-28 15:51:46 完成，71 tests、0 failures、0 errors、0 skipped、BUILD SUCCESS。本次没有重复执行测试。

未发现本轮必须打断冻结实验修复的权限绕过、伪造 rerank 成功或默认启用实验功能。以下结论限于检查的代码路径与已有测试；不是全面安全审计或效果结论。

## 权限与引用边界

`RetrievalService` 的向量及关键词 SQL 都在排序前限定知识库所属用户、指定知识库、文档当前 active version 及 embedding model。reranker 只接收这些候选文本；没有全库检索后由模型过滤权限的路径。问答、诊断、历史、评测与评分入口均要求会话，服务层继续检查归属。检索诊断只返回该用户授权的快照，不生成答案或写入问答历史。

compact 只把本次提示词中的引用标识替换为 E1 等短别名。服务端恢复 UUID 后仍执行 `Citations` 校验；未知别名、混入原始 UUID、格式异常不会成为有效引用。引用读取重新验证用户与 active version；删除流程清除相关历史与评测快照，避免已删除正文仍由这些接口返回。默认 uuid 不经过别名替换。原始供应商回答保存在诊断中供排错，不能将其视为已通过校验的最终回答。

文档作为不可信用户上下文传入，没有变成系统指令，也没有工具执行权限。权限隔离依赖数据库条件和接口校验，不依赖模型遵守提示词。引用格式有效、标签命中、人工判定引用支持、答案正确性仍是不同字段；未人工评分不自动获得正确性结论。

## 默认兼容与实验可解释性

旧请求可以省略 retrievalOptions；旧 Java 构造函数保留。默认 rerank=false、citationStyle=uuid、keywordWeight=1。默认向量路径仍直接取 topK；默认混合路径仍为两路候选及 RRF（常数 60、等权）。结构切分需显式选择，默认 legacy 900/200；每个 active version 的实际 profile 进入快照，不能把全库描述成统一切分。

显式 candidateK 限定 topK 至 100，keywordWeight 限定有限的 0 至 4；未知 JSON 字段、错误类型及非法值提前拒绝。评测仍产生 vector、hybrid 两种 mode，不把配置编号混入 mode。真实供应商输出仍可能波动，默认兼容测试不能证明每次生成文本完全相同。

实验脚本的 compact 对照按逐题 caseId/mode 检查证据身份、顺序、版本、文本与位置及 Recall/MRR，并检查配置与数据快照；允许 rerank 分数微小浮动，但保存其诊断。比较不一致时保存偏差并停止归因，不筛选出有利行。检索诊断结果标为 retrieval-only，不能冒充端到端评测。

## 供应商失败与用量

独立 `/v1/rerank` 使用单独配置，不使用聊天评分替代。返回数量、索引类型/范围/唯一性、分数有限性均校验；超时、429 或异常响应变成显式 error，不静默退回未重排结果伪装成功。mock 模式即便配置真实密钥也不调用真实 reranker；有候选时开启 rerank 明确失败。空候选不会触发供应商调用。

Spring AI embedding 用原始供应商 usage，而非 SDK 可能填零或计算的默认值；查询 embedding、rerank 的实际字段进入结果，缺失为 null。rerank 的实际 0 值保留，已有 meta.tokens 时同时保存 billed_units。聊天原有 token 字段保留。失败产生的防御拒答不能计为正确拒答；新口径要求无 error、引用校验有效且确实拒答，旧原始 payload 不重写。

用量并不完整：索引任务仍调用 `embed(text)`，未持久化索引阶段的 embedding usage；协议校验失败的响应即便可能已计费，也没有完整失败调用用量账本；仅有 billed_units 而没有 usage/meta.tokens 的响应当前返回 null。这些缺口禁止用估算补齐，也不支持声称已统计项目全部模型成本。

## 71 项测试实际覆盖范围

| 测试类 | 执行数 | 主要风险 |
|---|---:|---|
| ChunkingIntegrationTest | 8 | 核心继承用例、切分 profile 更新/回退、跨段稳定标签 |
| CoreIntegrationTest | 6 | 会话归属、去重更新、失败保旧索引、重试恢复、删除期间索引不复活 |
| DocumentParserTest | 3 | PDF/文本解析及位置 |
| Phase2EvaluationIntegrationTest | 8 | 标签哈希/位置/越权、严格输入、评分 ACL/审计及自动原文不变、拒答错误口径、NUL |
| Phase2EvaluationUnitTest | 4 | 分组标签指标及输入/指标边界 |
| ProviderContractTest | 14 | 聊天/embedding 协议、超时/429、异常内容及原始 usage |
| RagIntegrationTest | 5 | SQL 隔离/引用/删除、评测恢复与进度持久化、共享读锁与删除互斥 |
| RagUnitTest | 8 | 引用、指标、词法及 mock 行为 |
| RetrievalProtocolTest | 8 | 专用 rerank 协议及坏索引/分数/数量、缺失配置/用量、超时/429、别名与严格参数 |
| Stage2RetrievalIntegrationTest | 4 | 默认排名回归、候选/trace ACL、compact 校验、mock 重排失败、诊断和评测配置导出 |
| StructureChunkingTest | 3 | 标题/表格/结构边界、源坐标、重叠与 surrogate 边界、legacy 不变 |

合计 71 次测试执行，不等于 71 个互不重复的风险：ChunkingIntegrationTest 包含继承的核心用例。未把目录内旧 ExternalCore/ExternalRag 报告重复计入。协议故障使用受控 HTTP 服务，数据库集成使用真实 PostgreSQL/pgvector Testcontainers；这些测试不证明真实模型回答正确性或新语料效果提升。

## 剩余限制与后续验证

1. 长事务仍在模型调用期间持有知识库共享锁；删除和版本提升需独占锁，可能等待长评测。已有锁测试证明互斥，不证明高并发吞吐、取消、租约/fencing 或多 worker 治理已完成。这些仍属阶段四待办。
2. 问答计时从取得锁和授权检查后开始；阶段耗时不覆盖所有排队、HTTP、数据库提交开销。不能把服务端 totalMs 当作用户观察的完整响应时间，亦不能以此宣称锁等待已优化。
3. 有限/非零向量检查不验证查询向量与既有索引维度一致。同名供应商模型维度改变可能导致 pgvector SQL 错误，而非逐题 ModelFailure；现有配置未发现该故障，测试尚未覆盖这一配置漂移场景。建议后续增加维度契约及失败归类。
4. 单任务逐块 embedding、当前索引恢复机制不能等同多实例任务队列；慢索引不是本轮已完成吞吐治理的证据。索引用量缺失见上文。
5. 当前检索使用精确向量距离与明确的词法策略；中文词法不是专业分词或语义理解。人工评分工作流可用，不意味着所有问题已经人工裁定。
6. 新语料真实优化实验及 holdout 结论由冻结实验流程另行生成。本报告没有读取 holdout，没有根据代码或 mock 结果推断真实改进幅度。
