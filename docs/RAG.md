# 检索、生成与评测实现

`ModelGateway` 隔离模型接口。真实路径显式构造 Spring AI `OpenAiChatModel` 与 `OpenAiEmbeddingModel`，分别设置服务地址、密钥、模型名；不使用自动配置的默认 OpenAI Key。`MODEL_MODE=mock` 使用确定性的 256 维词哈希与证据摘录，只能验证工程流程，所有记录保存模式标识，不能据此推导真实模型质量。

环境变量为 `MODEL_MODE`、`CHAT_BASE_URL`、`CHAT_API_KEY`、`CHAT_MODEL`、`EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`、`MODEL_TIMEOUT_SECONDS`（默认 60 秒）。BASE_URL 为不含 `/v1` 的根地址，Spring AI 使用 `/v1/chat/completions` 与 `/v1/embeddings`。供应商同步调用禁用隐式重试；索引任务负责有界业务重试，问答错误直接显示。网络连接和读取均有超时。实际 token 统计来自供应商 usage；缺失返回 null，不进行估算。

## 检索与权限

`RetrievalService` 的向量 SQL 和关键词 SQL 均在候选产生时连接 knowledge_base 并过滤 `user_id`、kb id、active_version_id 和 embedding_model。没有全库候选后过滤，也没有跨租户搜索接口。MVP 用 pgvector 精确余弦检索，未配置 ANN 索引，因此适合演示和小规模库，不能宣称百万级检索性能。更换 embedding 模型需重新索引资料。

关键词使用 PostgreSQL simple 文本检索，输入预分为 Latin 单词、数字、Han 相邻双字；例如“知识库 Java”得到“知识 识库 java”。这是字面重叠检索，不是中文语义分词，不识别同义词和繁简变换。关键词采用 OR 查询，按 `ts_rank_cd` 排名。

混合检索分别取向量和关键词前 max(20,4K) 个候选，用等权 Reciprocal Rank Fusion：score(d)=Σ 1/(60+rank(d))，排名从 1 开始，取前 K，分数相同按 chunk id 排序。仅为关键词与向量融合，不是多查询 RAG Fusion；本版未增加查询改写、多查询或 reranker，是否需要由真实评测决定。

## 引用与生成边界

生成消息将系统规则与 JSON 编码的证据分离，明确文档只是数据，不执行文档指令。没有模型工具调用入口，模型不能访问文件、网络或其他用户资料。提示词防御不能保证消除所有提示注入，真正的租户权限由 SQL 与引用 API 校验。

模型必须使用 `[chunk-id]` 引用。`Citations.validate` 验证所有方括号编号都属于本次检索结果；未知编号或无引用的非拒答回答被替换为证据不足说明，保留失败原因。证据为空时不调用模型。模型也可在候选不支持问题时主动拒答。引用格式有效不意味着事实正确，语义正确性仍需要人工逐题审阅；前端证据面板支持核对。

ASCII 方括号仅用于引用：残缺、空白或嵌套括号均拒绝，完整编号仍须属于本次检索。引用检查后，没有引用且包含规范拒答措辞，或具有引用但开头明确拒答的输出，会替换为固定拒答并清空引用。有合法引用的说明正文可以讨论“无法根据当前资料回答”这一文档规则，不能仅因出现该短语便误判本轮拒答。真实评测 q049 暴露了这一边界并促成修正；原始评测文件保留修正前输出，检索指标不受影响。供应商 null/空白回答视为调用失败，不会作为成功生成保存。

引用详情 API 再次检查 owner 和当前 active version；旧版和已删除文档引用不再开放。按 KB 使用 PostgreSQL advisory transaction lock：问答与评测取得共享读锁，可以同时读取同一知识库；删除和索引版本切换取得独占写锁，等待在途读取结束。这样长评测不会阻塞问答，同时其活动文档版本保持一致，删除后也不会被在途请求重新写回证据。删除文档会清除该 KB 历史问答与评测，牺牲历史保留以确保撤回内容不会继续暴露。

## 评测口径

证据标注为 documentName、page、paragraph、quote，引用原文与位置，不绑定 chunk id。可回答题必须有标注；Recall@K 为命中标注数/全部标注数（同一标注被多个块命中只计一次），MRR 为首个相关检索结果排名倒数。文档名、给定位置必须匹配，quote 必须是块内容子串。指标对可回答题按问题宏平均，不可回答题的 Recall/MRR 为 null；延迟对全部题目平均，单位毫秒。失败样本不被悄悄排除。

向量与混合检索依次运行同一评测集。保存完整数据集、active document version/hash、聊天/embedding 模型、mode、K、候选数、RRF 参数、词法分析器、逐题答案与证据。`answerCorrect` 始终 null，等待人工语义判定；`referenceAnswerMatch` 仅去空白转小写后的标准答案字面包含，不能等同正确；`evidenceHit` 是检索命中，不代表生成内容支持；`citationValid` 仅校验来源集合及格式；不可回答题另存 `abstentionCorrect`。

评测每题后以独立事务保存进度，应用启动将遗留 RUNNING 标记 FAILED，可导出检查部分结果，再重新发起。未做 LLM judge。JSON 导出包含完整原始记录。mock 结果仅用于测试这些逻辑。

真实 58 题、116 行对比中，向量与混合 Recall@5 均为 1.00，MRR 分别为 0.9900 与 0.9667；混合没有提升检索质量，因此默认使用向量。此结论只针对自建短手册的一次评测，详见 [评测报告](EVALUATION.md) 与 [完整原始结果](results/real-05cd747f-259c-499b-b372-01289b6d1546.json)。没有把延迟波动描述为性能优化，也没有将引用有效或短答案匹配当作答案正确。

## 已执行测试

`mvn test -Dtest=RagUnitTest,ProviderContractTest`：12 项通过（2026-09-26）。涵盖引用伪造/缺失、稳定证据指标去重及首命中排名、中文双字局限、RRF 数值、mock 标识、真实 Spring AI HTTP 429、超时、异常 embedding/chat 响应以及 usage 缺失/原样保存。恶意证据测试验证 system/user 角色边界及无 tools，不宣称证明模型抵抗所有注入。HTTP fixture 是协议测试，不是真实供应商效果或性能验证。

数据库风险场景位于 `RagScenarios`，分别通过 Testcontainers `RagIntegrationTest` 或显式设置独立测试数据库后的 `ExternalRagIntegrationTest` 执行，覆盖实际授权检索与引用、问答历史隔离、评测双模式闭环、删除后的撤回、任务中断保留已保存的题目。外部测试会清理知识库，不能指向演示或生产数据库。

2026-09-26 14:16，在本地 PostgreSQL 17.6 + pgvector 0.8.5 的独立 `citebase_rag_test` 数据库执行 `ExternalRagIntegrationTest`，**4 项全部通过**。其中并发测试在第二次模型生成暂停期间，通过另一数据库连接观察到 RUNNING 状态和第一题已提交的结果，证明逐题进度不是直到总事务结束才落库。首次测试同时验证从空库执行 Flyway V1/V2；重跑验证迁移幂等。该测试使用 mock 模型和真实 SQL，不是模型效果评测。

2026-09-26 14:18，收紧拒答与引用格式后重新执行 `RagUnitTest,ProviderContractTest`，**21 项全部通过**。新增覆盖拒答夹带事实/指令、未知引用优先拒绝、残缺/空/嵌套方括号，以及供应商 JSON null、缺失 choices、null choice/message/content、空白内容，均不产生成功的空回答或向上泄漏 NullPointerException。

2026-09-26 14:31，将问答及评测改为共享读锁后，在独立 `citebase_rag_test` 执行 `ExternalRagIntegrationTest`，**5 项全部通过**。并发测试暂停评测生成，确认同一 KB 的问答可在评测继续等待时完成；另一测试通过 PostgreSQL `pg_locks` 确认删除正在等待独占锁，评测结束后删除成功并清除评测记录。测试未重启或操作演示服务。

最终 Java 21 Maven package 验证完成：36 项测试，0 失败、0 错误、0 跳过，其中真实 Docker Testcontainers 核心场景 6 项、RAG 场景 5 项。真实供应商安全闭环 33 条断言和完整 HTTP 闭环 51 条断言另存于 docs/results/security-real.json 与 docs/results/api-real.json，不与模型协议 fixture 混为一谈。
