# 简历表述（仅已实现且有证据的成果）

1. 基于Java 21、Spring Boot、Spring AI及PostgreSQL/pgvector开发CiteBase知识库问答与评测平台；参考rag-from-scratch索引/检索/生成思路，自行实现用户SQL隔离、文档版本原子切换、内容哈希与分块向量复用、引用来源验证及React管理界面。
2. 自建12份可分发语料与156题扩展评测集，冻结主题级开发/测试划分、稳定原文证据标签及24个独立安全用例；保存312条真实基线和664条切分/候选/权重/专用重排实验，在固定52题双模式测试中记录Recall@5/MRR与延迟、失败和实际用量，明确检索改善的延迟/成本代价，未将引用格式或自动辅助信号当成人工答案正确性。
3. 实现有预算与白名单工具边界的证据补充Agent，以及PostgreSQL租约/fencing驱动的异步索引、逐题评测检查点与Agent安全恢复边界；真实Agent原104次及46次恢复补测完整保留，组合结果37/104次预算或无进展失败、均值约28秒，未显示优于基础RAG的收益，因此保持基础RAG默认。真实数据库风险测试覆盖取消、过期写入与断点恢复；双进程验收状态见PROGRESS，未通过前不得宣称已验证多实例故障恢复。

证据入口：docs/REFERENCES.md、docs/DATASET.md、docs/EXPERIMENTS.md、docs/AGENT.md、docs/TASKS.md、docs/PROGRESS.md及docs/results/。本项目没有将教程能力算作新增工程实现，也不声称生产吞吐、线上用户、商业部署或形式化消除提示注入。未发生的人工评分仍为null。
