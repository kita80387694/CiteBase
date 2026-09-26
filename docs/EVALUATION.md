# 评测方法与实测记录

## 语料与样例

`samples/documents` 为5份自建虚构技术服务手册，CC0分发；共50条事实。`samples/evaluation.json` 含58题：50个可回答题、8个不可回答题。安全测试单独存放在 `samples/security/`，不混入检索平均指标。`scripts/generate-samples.mjs` 可确定性重新生成。

证据标注为文档名、原文页码、段落、quote，而非chunk UUID。PDF页码从1开始，文本文件记第1页；段落从1开始，独立标题也算段落。quote必须被候选内容完整包含，并且文件/可选页段一致；因此可跨分块策略复用，但过长quote跨多个块时需要调整为独立短证据，不声称具有跨块证据拼接评分。

## 指标定义

每题、每种检索配置构成一条结果，58×2=116条。

| 指标 | 定义 | 统计范围 |
| --- | --- | --- |
| Recall@K | TopK中命中的标注证据项数 / 该题全部标注证据项数；同一证据多次出现只算一次 | 50个可回答题宏平均；无答案题null不进分母 |
| MRR | 第一个相关结果的1/rank，rank从1开始；没有命中为0 | 50个可回答题宏平均 |
| 检索延迟ms | 从检索调用开始到获得最终候选，包括query embedding、SQL、RRF | 全部58题算术平均 |
| 端到端延迟ms | 从问答服务开始到生成与引用检查完成 | 全部58题算术平均；不含浏览器网络、持久历史与外层锁等待 |
| citationValid | 引用格式完整且所有ID属于当前检索集合；无引用事实回答判无效，规范拒答可有效 | 逐题呈现，不等同事实正确 |
| evidenceHit | 至少一个预标注证据命中 | 逐题；不是引用是否存在 |
| referenceAnswerMatch | 规范化空白和大小写后参考短答案是否包含于生成文本 | 机械辅助信号，不代替语义正确性 |
| answerCorrect | 人工语义正确性未评审，不做自动语义正确性断言 | null，界面明确未评分 |
| abstentionCorrect | 对无答案题，是否触发规范拒答 | 仅无答案题 |

服务失败保留error和该行，不能从指标中静默排除失败样本。检索失败时有答案题Recall/MRR=0；生成失败但检索已成功时仍按实际检索结果计算检索指标，错误另计。一个题可有多个相关证据，样例每题一个；多证据分母与多命中已由单元测试验证。

## 固定配置与复现

向量检索为pgvector精确余弦距离排序。混合为同一query的向量候选与关键词候选等权RRF，constant=60、候选max(20,4K)、K=5。关键词Latin词+中文bigram，PostgreSQL simple analyzer，不等同BM25或中文语义分词。没有多query改写、reranker或RAG Fusion，防止未验证功能影响对比。

模型配置：硅基流动 `deepseek-ai/DeepSeek-V3.2` + `BAAI/bge-m3`；温度0。`.env`中API Base URL不带SDK自动追加的/v1。模型服务即使temperature=0仍可能非确定；精确候选平分时按chunk UUID排序，重新索引后UUID变化可能改变并列项顺序。

```sh
docker compose up --build -d
node scripts/seed-demo.mjs --evaluate
node scripts/verify-api.mjs
node scripts/verify-security.mjs
```

真实双模式评测涉及 116 次问答，可持续数分钟。脚本使用 30 分钟 socket deadline，不会自动重试创建评测的 POST。如果客户端超时或连接中断，先在界面查看已有任务状态；服务端逐题保存结果，不能为了客户端超时立即再跑一份。已有任务完成后导出：

```sh
node scripts/seed-demo.mjs --export-latest
```

此命令按当前模型模式寻找最近的“自建手册对比”记录，导出已有结果，不创建新评测；尚未完成时也会写出部分 JSON 并以非零退出码提醒。进程重启中断的评测标为 FAILED，应保留部分结果，修复后另建评测。

连接非默认后端可设置 `CITEBASE_URL=http://localhost:8081`。raw JSON包含完整题集、原始回答、检索候选、引用、供应商实际token、配置、每份文档版本ID/内容哈希及逐题失败。不要修改原始JSON来改善结果。模型目录、服务器负载、网络缓存及模型权重更新都会影响重跑。

## 已执行验证

- Mock 58题双配置结果：`results/mock-39cbcffa-6e1c-48e4-b662-c0ceecc104db.json`。哈希向量与摘录只验证业务管线，不得用其Recall/MRR/耗时作真实RAG或简历性能指标。
- HTTP mock权限/生命周期：`results/api-mock.json`。
- 真实安全原始记录：`results/security-real.json`，33条断言通过，包括恶意文档、跨用户检索/引用及证据不足。
- 真实 HTTP 完整闭环：[api-native-real.json](results/api-native-real.json)，本地51 条断言通过；[api-compose-real.json](results/api-compose-real.json)，Docker中52 条断言通过（生成引用数量不同，逐引用访问断言计数随之变化）；真实安全测试 [security-real.json](results/security-real.json)，33 条断言通过。主要界面的真实浏览器流程亦已完成。

## 真实向量与混合检索对比

2026-09-26 完成 [未经筛选的完整原始结果](results/real-05cd747f-259c-499b-b372-01289b6d1546.json)，状态 COMPLETED，共 116 行。数据集版本为 `citebase-original-handbooks-v1`，5 份文档的 SHA-256 和活动版本 ID 均保存在 `config.dataVersions`。真实聊天模型为 `deepseek-ai/DeepSeek-V3.2`，embedding 为 `BAAI/bge-m3`，供应商为硅基流动；Spring AI 1.1.8，temperature=0，timeout=60 秒。每模式使用相同 50 个可回答题和 8 个不可回答题。

| 配置 | Recall@5（50题） | MRR（50题） | 平均检索 ms（58题） | 平均端到端 ms（58题） | 错误数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 向量 | 1.0000 | 0.9900 | 501.741 | 4723.621 | 0 |
| 关键词 + 向量 RRF | 1.0000 | 0.9667 | 492.362 | 4471.431 | 0 |

两种配置的引用格式有效率均为 58/58（包含规范拒答），不可回答题拒答均为 8/8；参考短答案字面匹配均为 49/50。所有 `answerCorrect` 仍为 null，没有将字面匹配或引用有效算作语义正确。

本次混合检索没有提高 Recall@5，MRR 反而低于纯向量，因此默认使用向量检索，并保留混合配置供实验。混合的观测平均耗时稍低，但这是一次顺序运行，包含供应商网络、负载与缓存差异，不足以声称性能提升或统计显著优势。未据此增加多查询、查询改写或 RAG Fusion。

原始结果还暴露了 q049 的拒答判断边界：该题询问“无证据时应该怎样回答”，合法回答会引用文档中的拒答措辞。原实现把含有该措辞的已引用说明误当作本轮拒答。随后修正为区分有合法引用的说明与开头明确拒答；此变更不影响检索排名及上述 Recall/MRR。原始 116 行结果保持不变，不以修改结果文件冒充重跑；修正后的[真实定点回归](results/real-abstention-quote-regression.json)已通过，合法引用中讨论拒答措辞不再误判；独立记录，不合并进本次统计。

## 正确性与偏差

自建短手册和直接问法难度有限，不能代表生产长文档、噪声PDF、跨文档多跳和开放域问题。当前评测未使用LLM裁判，未把存在引用算作正确，也没有人工全量标注模型答案。因此检索指标仅说明已标注证据的排名表现；回答的真实语义正确性需要独立人工复核。

复现保留的是输入、参数及供应商返回值，而非冻结的供应商模型权重。首次下载依赖、索引时生成的 UUID、并列候选顺序、供应商模型更新及网络状态均可能造成差异。正文中文词法方案只实现相邻双字匹配；本次小样本通过不代表对中文同义词、长句改写或复杂分词已验证。
