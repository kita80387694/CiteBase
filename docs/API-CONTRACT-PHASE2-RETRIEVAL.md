# 阶段二检索接口契约

POST /api/questions 与 POST /api/evaluations 新增可选 retrievalOptions：
`{candidateK?:int,keywordWeight?:number,rerank?:boolean,citationStyle?:"uuid"|"compact"}`。
未知字段/错误类型/NUL/非有限数值/越界直接400。candidateK范围topK..100，缺省max(20,4*topK)；keywordWeight范围0..4，缺省1；向量权重固定1；rerank缺省false，citationStyle缺省uuid。旧构造和不传选项接口保留原行为：vector直接前topK，hybrid各路默认candidateK等权RRF取topK。显式candidateK只改变候选深度；rerank=false的vector最终仍前topK。

每个评测仍运行vector/hybrid两模式；row.mode不改，run.config.retrievalOptions记录规范化选项，不把多个实验配置混在同一个mode下。rerank=true时从vector或融合池取最多candidateK条，调用真实独立rerank模型返回topK；关闭时不调用rerank。独立环境变量RERANK_BASE_URL（根地址，自动追加/v1/rerank）、RERANK_API_KEY、RERANK_MODEL、RERANK_TIMEOUT_SECONDS，缺配置只在请求启用rerank时显式失败。不得回退为成功、不得用聊天模型打分冒充reranker。

QuestionResult保留所有原字段并增加：
- retrievalOptions：生效选项。
- diagnostics：{timings:{embeddingMs,vectorMs,keywordMs,fusionMs,rerankMs,generationMs,citationMs},candidateCounts:{vector,keyword,fused,rerankInput,selected},trace:{vector:Evidence[],keyword:Evidence[],fused:Evidence[],rerank:[{index,score,chunkId}]},rawAnswer,aliasMap}。失败时保留已完成阶段的候选、usage和耗时。rawAnswer为供应商规范化前输出；aliasMap仅compact时{E1:真实UUID,...}，不含系统推理。
- usage：{embedding:{promptTokens,totalTokens}|null,rerank:{promptTokens,completionTokens,totalTokens,providerUsage?,providerTokens?,billedUnits?}|null}，仅实际供应商usage，缺失字段null，不估算；原promptTokens/completionTokens仍为聊天usage。SiliconFlow meta.tokens.input_tokens/output_tokens对应prompt/completion，0保留为实际0，缺失total_tokens不相加估算。

compact仅把送入生成接口的证据id替换为E1..En，系统拒答策略不变。供应商返回后只接受本次别名，逐一映射回真实UUID再走原Citations校验；未知别名、原始UUID混用、残缺括号保持错误拒答。最终answer/citations保持真实UUID，引用API不变。所有原始与映射文本均可诊断；它不是放宽引用允许集合。

新增POST /api/retrieval-diagnostics，body与questions相同（kbId,question,mode,topK,retrievalOptions），返回{kind:"retrieval-only",id,question,mode,modelMode,evidence,error,retrievalMs,retrievalOptions,diagnostics,usage,config,dataVersions}。执行授权和KB共享读锁，保存当前活动版本快照但不生成答案、不写问答历史、不声称端到端效果。候选SQL内owner/kb/activeVersion/model条件保留。

rerank协议：POST /v1/rerank {model,query,documents:[text],top_n:N,return_documents:false}，响应results每项必须含唯一整数index（原输入范围内）及有限数值relevance_score；数量必须min(topK,input数)，按score降序并以index打破并列。429、超时、空/畸形/重复/越界/非有限响应均返回显式error，不能伪装成功。当前只支持该兼容schema。

本契约描述实现与待验证能力，不预先声称检索效果提升；仅开发集选参，独立测试结果不得用于调参。

MOCK模式不调用真实reranker，即使环境存在RERANK_API_KEY也一样；开启且有候选时显式error，usage.rerank=null。无候选不调用任何reranker，正常走证据不足。

实际核实的API资料：[Spring AI v1.1.8 OpenAiEmbeddingModel源码](https://github.com/spring-projects/spring-ai/blob/v1.1.8/models/spring-ai-openai/src/main/java/org/springframework/ai/openai/OpenAiEmbeddingModel.java)、[SiliconFlow官方Rerank协议](https://docs.siliconflow.cn/docs/api/rerank-post)。本地javap验证DefaultUsage会补0及推算total；因此读取其native OpenAiApi.Usage原字段，避免把SDK默认值当供应商真实用量。这里只参考接口定义，未复制供应商实现。
