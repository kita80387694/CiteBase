# 阶段四异步评测 API

`POST /api/evaluations` 在原请求上增加必填 `idempotencyKey`（1–100 字符），校验与持久化后返回 HTTP 202。`id`、`taskId` 相同。创建不调用模型。同用户、同 key、同归一化请求返回原任务；异请求返回 409。文档在标签校验期间更新时返回 409，可由用户重新提交新请求。

`GET /api/evaluations/{id}` 与 `/export` 可读取部分结果；所有接口校验当前用户。任务状态为 QUEUED、RUNNING、RETRY_WAIT、CANCEL_REQUESTED、SUCCEEDED、FAILED、CANCELLED。旧历史记录保留原状态与原始 payload，不迁移成新任务重新执行。

新增视图字段：

- `taskStatus`、`taskId`；`status` 对新记录同任务状态。
- `progress: {unit:"question_modes", total, completed, failed}`。一题 vector/hybrid 各计一个模式项。
- `partial`；`pendingItems: [{caseId,mode,status}]`。取消后的未完成项保留，不混入已完成质量均值。
- `results` 沿用原逐题格式；永久失败项作为有 error 的零召回结果保留，耗时和实际用量未知为 null。
- `attempts` 保存每项尝试，包括 UNKNOWN 与已返回失败；`externalCalls` 保存供应商调用意图、返回状态和实际用量。operation_key 的前缀为 evaluation_attempt.id；未知调用可能已由供应商执行，不承诺 exactly-once。
- `canScore` 仅在任务终态为 true；评分仍要求目标项已终态且存在不可变结果。新增评分的 `resultDigest` 将审阅绑定到具体结果；未评分仍为 null。

`SUCCEEDED` 表示所有模式项已遍历，不代表全部答案正确，也不保证没有供应商失败；查看 `summary.errorCount` 和逐题 error。部分结果的 summary 同时提供 plannedCount/count，不能当成完整评测结论。

取消和重试使用 `/api/tasks/{taskId}/cancel`、`/retry`。取消排队任务即时生效；取消运行任务阻止下一步与晚到成功写入。重试保留已完成模式项；已全部终态的评测需创建新 key 重新评测。每个模式项自动尝试上限由 `citebase.evaluation-item-max-attempts` 配置，默认 2、允许 1–5，仅明确的 RATE_LIMIT/TIMEOUT/UNAVAILABLE 可自动重试。认证与额度不足不自动重试。

评测固定创建时的文档版本。索引更新可并行发布新版本；新基础问答读取活动版本，已有评测继续读取快照版本。评测引用使用 `/api/evaluations/{evaluationId}/citations/{chunkId}`，要求用户归属、快照成员和该运行真实已保存结果证据成员。删除文档按项目现有策略撤回该知识库所有历史问答、评测和 Agent 副本，引用与导出不可继续访问；晚到 worker 无法重建记录。

实现使用短事务与 TaskRepository 的 lease/fencing 校验，不在模型请求期间持有知识库读锁。模型已经收到的在途请求无法保证撤销计费，已知用量与未知窗口分别保留。

测试故障适配器可以保持 modelMode=mock，同时公开 configuration.externalNetwork=true，使固定本地故障服务的 embedding/generation 请求进入同一外调意图审计。该标记不使 mock 结果成为真实模型质量结果。纯内存 mock 不登记不存在的网络调用。

从 V5 升级前必须停止旧应用进程。V7 将没有统一 task_id 的旧 RUNNING 评测标为 FAILED/UPGRADE_INTERRUPTED，保留原始 payload 字节语义和已保存部分结果；GET 额外显示 historicalPayloadStatus 与迁移说明，绝不自动重新执行未知的旧模型请求。旧 COMPLETED 数据不变。
