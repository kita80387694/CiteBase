# 核心工程实现

认证使用 BCrypt 密码及 256 位随机会话令牌；数据库仅存令牌 SHA-256，12 小时过期。所有资源端点检查所属用户，跨用户请求统一返回 404。演示账号仅适合本地演示。

上传在知识库行锁下做 SHA-256 去重；每个文档只允许一个待执行或运行中的版本。原始文件、版本、任务均持久化。UTF-8 Markdown/TXT 按空行分段，PDFBox 提取文本并保留页码及页内段落；900 字符窗口、200 字符重叠保留页内字符位置。未提取到文字的扫描 PDF 明确失败。

调度器使用 SKIP LOCKED 领取任务，事务外调用 embedding，按文档、内容哈希与 embedding 模型复用已有向量。全部分块准备完成后在同一事务中写入并切换 active_version_id，更新失败不会影响旧索引。最多自动尝试 3 次，重启恢复 PROCESSING；只可人工重试最新失败版本。当前恢复机制面向单应用实例，不能部署多个实例同时执行启动恢复。

删除文档级联删除版本、分块与任务，同时清除该知识库问答及评测快照，避免在历史结果中继续暴露已删除文本。这一 MVP 选择较保守，会连带移除该库其他文档的历史结果。

核心测试使用真实 pgvector PostgreSQL Testcontainers，验证会话、用户隔离、重复内容、更新失败保留索引、自动重试、重启恢复、版本切换及删除。无 Docker 时此集成类报告 skipped，不能计为通过。

## 已执行验证（2026-09-26）

在 PostgreSQL 17.6 + pgvector 0.8.5 的隔离测试库执行 ExternalCoreIntegrationTest：6 项通过、0 失败、0 跳过。包含空库 Flyway V1/V2 迁移、重复内容及并发去重、更新失败保留旧索引、瞬时模型异常重试、未修改分块向量复用、重启恢复与重试耗尽、索引运行中删除不复活内容、用户隔离。解析单测 3 项通过，覆盖文本位置、PDF 页码、扫描 PDF/无效 UTF-8 拒绝。日志保存于 .tools/external-core-test.log（本地忽略文件），JUnit 报告位于 backend/target/surefire-reports。随后Docker引擎恢复，最终Testcontainers CoreIntegrationTest 6/6通过，RagIntegrationTest 5/5通过；36项完整核心套件0失败0跳过，见results/backend-verification.json。
