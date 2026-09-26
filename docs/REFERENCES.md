# 实际参考记录

阅读日期：2026-09-26。固定参考提交：`1fdb7d0e4f1d3e731c8397332452715512f18667`。

| 实际阅读文件 | 采用思路 | 本项目实现与取舍 |
| --- | --- | --- |
| [README](https://github.com/langchain-ai/rag-from-scratch/blob/1fdb7d0e4f1d3e731c8397332452715512f18667/README.md) | 索引、检索、上下文生成三个阶段 | Java 模块化单体，无 Python 核心服务 |
| [rag_from_scratch_1_to_4.ipynb](https://github.com/langchain-ai/rag-from-scratch/blob/1fdb7d0e4f1d3e731c8397332452715512f18667/rag_from_scratch_1_to_4.ipynb) | 解析、分块、embedding、余弦检索、基于证据回答 | PostgreSQL pgvector、稳定段落位置、版本原子切换、Spring AI 适配；检索 SQL 内过滤用户 |
| [rag_from_scratch_5_to_9.ipynb](https://github.com/langchain-ai/rag-from-scratch/blob/1fdb7d0e4f1d3e731c8397332452715512f18667/rag_from_scratch_5_to_9.ipynb) | 比较多查询、去重、RRF、问题分解、step-back、HyDE | 仅借鉴 RRF 排名融合的数学思路；融合单个问题的向量与关键词列表，不实现教程的多查询 RAG Fusion；排名从1开始，分母60+rank。真实基线评测已完成（见EVALUATION.md），未发现增加查询改写的证据，不为覆盖教程而堆叠功能 |

## 许可边界
在上述提交的仓库根目录及 Git 跟踪文件中未发现 LICENSE 或明确代码许可文件。公开可读不等于可再分发：本项目**不复制、不翻译、不分发 notebook 代码及其下载的第三方文章**。仅记录阅读与算法思路，工程实现自行编写。`.tools/rag-from-scratch` 是本地阅读副本，已被 `.gitignore` 排除。自建演示语料与评测集见 `samples/LICENSE`。

权限、增量索引、持久任务、版本切换、引用校验、评测平台及测试均为本项目新增，不将参考教程能力算作本项目成果。

## 技术版本依据
- [Spring AI 官方仓库](https://github.com/spring-projects/spring-ai)：1.1.x 对应 Spring Boot 3.5.x。
- [Spring AI 发布记录](https://github.com/spring-projects/spring-ai/releases)：采用1.1.8维护版。
- Maven Central 元数据核实 `spring-ai-bom:1.1.8`、`spring-boot-starter-parent:3.5.16` 可用，Java目标21；锁定版本由 backend/pom.xml 管理。
