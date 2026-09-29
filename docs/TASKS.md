# 统一持久任务（阶段四）

阶段四新增 `work_task` 调度事实源；INDEX、EVALUATION、AGENT 共用认领、租约、心跳、取消、重试和 fencing。索引旧 `index_task` 与文档状态保留为同事务业务投影，旧 `/api/tasks/{id}/retry` 继续可用。任务 ID 就是业务资源 ID，不引入第二套映射。此文记录已落地代码；跨 JVM 故障实验和前端整体验收由主流程另行记录，不能据下面的单 JVM/多连接测试宣称它们已通过。

## 调度与租约

`TaskWorker` 每进程生成 UUID，先取得本地并发许可，再通过 `FOR UPDATE SKIP LOCKED` 认领。所有租约判断和可运行时间来自 PostgreSQL `clock_timestamp()`。每次认领递增 fencing token；启动新进程不会把其他进程的有效 RUNNING 租约改成失败或重试。worker 只在真实处理线程结束后释放本地许可。

默认配置：`WORKER_ENABLED=true`、`TASK_WORKER_CONCURRENCY=2`、`TASK_LEASE_SECONDS=30`、`TASK_HEARTBEAT_SECONDS=5`、`TASK_MAX_ATTEMPTS=3`、`TASK_POLL_MILLIS=500`、`TASK_RETRY_DELAY_SECONDS=3`。并发上限是**每进程**；两个进程最多为各自上限之和，不是全局并发 2。创建时保存每个任务的最大尝试预算；评测另有逐题尝试预算。心跳只能延长尚未过期且 owner/token 一致的租约，不能复活过期持有者。

普通首次、故障重试、失联接管计入 attempts。`TaskContext.defer(Duration)` 将任务放回 QUEUED 并置一次性的 resume 标志，下次认领只递增 token、不消耗新的任务尝试；标志在认领时消费，所以该次续跑若又崩溃，下次过期接管仍消耗尝试。已耗尽或已经取消的过期任务可被认领为仅收尾租约，禁止执行模型，原子落终态及业务投影。

## 发布、取消与删除

短事务锁序统一为 KB advisory 锁 → work_task 行 → 业务行 → checkpoint/call/stage。索引发布和文档删除取 KB 排他锁；一般执行检查/评测/Agent 发布取共享锁。网络调用不放在这些短事务中。`guarded` 在回调前后检查 owner、token、状态与数据库时钟租约，旧持有者不能写 checkpoint、业务终态或晚到响应。

QUEUED/RETRY_WAIT 取消立即变成 CANCELLED，文档/评测/Agent 投影在同一事务更新。RUNNING 先变 CANCEL_REQUESTED，后续正常 checkpoint 和成功发布被拒绝。仍持有有效租约的相同调用可仅保存已经收到的实际 usage，清除 response；已删除或失去租约的调用完全拒绝写入。取消不是供应商退款，也不能保证外部供应商已停止执行。

手动重试只允许 FAILED/CANCELLED，经所有权与各 handler 的 `validateRetry` 检查后递增 retryGeneration/token、重置本轮 attempts 并原子更新待处理投影。历史 call/checkpoint 不删除。Agent 有调用/步骤历史时禁止同 run 重放，需显式新建。文档删除沿用 MVP 撤回策略：移除该知识库相关问答、评测、Agent 记录及对应任务；该文档 INDEX 任务和 stage/call/checkpoint 一并删除，晚到 worker 不得重建。

## 索引阶段恢复与外部调用审计

INDEX 保存原始内容哈希、切分 profile 与公开模型配置快照。解析后按 profile/页/段落/offset/正文哈希生成稳定 part key。完成 embedding 的分块写入 `index_chunk_stage`，尚未发布的 stage 不参与检索。恢复先复用已完成 stage，或复用同文档、同 embedding 模型、同内容的现有向量，只计算缺少部分。全部分块齐备才在受 fence 保护的事务里插入新版本 chunk 并切换 active version；失败不破坏上一份可用索引。新配置/源快照漂移显式失败，不把新向量标成旧配置。

`work_call` 在发起外部调用前保存 STARTED 意图；校验过的响应与供应商实际 usage 一同记 RETURNED。失联接管把旧 STARTED 标成 UNKNOWN，保留未知调用而不是假定没有计费。INDEX 可有限重算未完成部分，EVALUATION 以逐题 checkpoint 为事实源仅续跑未完成项，AGENT 不自动重放未知执行。供应商没有返回 usage 时数据库保留 NULL；不根据文本长度估算实际 token。返回已保存但 stage 尚未写入时，INDEX 可使用已返回向量完成 stage，避免再次收费。

## API 和可观测性

- `GET /api/tasks?kbId=...&kind=INDEX`、`GET /api/tasks/{id}` 返回当前用户任务；跨用户返回 404。
- `POST /api/tasks/{id}/cancel` 与 `/retry` 执行服务端状态检查和原子投影。
- 任务详情额外提供 externalCalls 安全审计（状态、实际 usage 或 null、时间、调用 ID），不提供 response 正文。DTO 包含 id/workTaskId、kind、status、kbId、attempts/maxAttempts、retryGeneration、progress、errorCode/errorSummary、ISO 时间和 canCancel/canRetry/retryBlockedReason。INDEX 额外保留 documentId/documentName/versionId/legacyStatus。尚无进度时为 null；total 未知不能制造百分比。
- 结构日志使用固定事件及 kind/state、服务端 task/worker ID、token、attempt，不记录正文、查询、文件名、API Key 或原始异常。Micrometer 提供活动任务 gauge、kind/state 转移计数及执行耗时，标签不使用 taskId 或用户输入。

## 升级与验证

V6 保留并回填既有索引任务，不删除文档、向量或已完成原始评测；旧 PROCESSING 索引按剩余预算恢复，并明确升级前在途用量未知。V7 由评测适配增加逐题与尝试记录。**升级前必须停止全部 V5 应用进程**：旧程序不支持 fencing，不能与 V6 运行滚动混用。先备份数据库，再迁移到新隔离环境；不得清库代替迁移。

2026-09-29 实际执行：

```powershell
$env:JAVA_HOME='F:\CiteBase\.tools\jdk-21.0.12.1+1'
& .tools/apache-maven-3.9.9/bin/mvn.cmd -f backend/pom.xml '-Dtest=CoreIntegrationTest,TaskIntegrationTest,TaskMigrationIntegrationTest' test
```

真实 Docker PostgreSQL/pgvector Testcontainers：Core 6 + Task 13 + Migration 1，共20项通过，0 failure、0 error、0 skipped（`.tools/phase4-core-tests-final.log`）。随后补齐 kind 严格校验/SQL过滤与伪造租约身份测试，Task 15项再次全部通过（`.tools/phase4-task-final.log`）；当前核心三个测试类合计22项。覆盖两连接并发认领不重复、有效租约不抢、过期 token 的 heartbeat/checkpoint/call/publish 拒绝、取消与重试投影、取消后的用量保留与正文清除、defer 与崩溃尝试计数、耗尽仅收尾、分块断点复用、模型/切分配置漂移、删除与晚到响应、去重及失败保旧索引、租约在发布事务期间到期导致全部回滚、402不自动重试且不误记未知调用、无效向量保留实际usage、V5→V6保留源文件/已发布向量/历史完成评测及Agent结果和迁移重复执行。这里的供应商故障由受控 mock 注入，是业务风险验证，不是实际供应商效果或计费恰好一次证明。

尚需主流程完成：两个独立 JVM 的 kill/pause 故障实验、最终整套回归、实际前端检查及真实模型闭环。租约只能约束本平台写入，无法在无供应商幂等接口的情况下保证外部调用恰好一次。

