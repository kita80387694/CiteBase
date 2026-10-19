# 运维 API 契约

实现待主线程集成测试，不代表完成运维验收。

`GET /api/operations/summary?windowMinutes=60` 使用既有 Bearer 登录；窗口 5–1440，非法值 400，未登录 401。`scope=SELF`，每个聚合 SQL 在聚合前按认证 user_id 过滤。返回 `generatedAt/windowMinutes/modelMode`，`kinds` 含三个 kind（INDEX/EVALUATION/AGENT），每项：`queued/retryWait/running/cancelRequested/activeLeases/oldestQueuedAgeMs`、`terminal:{succeeded,failed,cancelled}`、`queueLatency/endToEndLatency:{sampleCount,meanMs,p50Ms,p95Ms}`。无延迟样本时数值 null。积压为当前全部任务；窗口终态以 finished_at 筛选，queueLatency 是窗口内首次启动任务的 created_at→started_at，endToEndLatency 是窗口内已结束任务的 created_at→finished_at（含重试等待），分位数为 PostgreSQL percentile_cont。人工重试沿用原 created_at/started_at，故测量的是原始任务生命周期，而非最后一次重试。

`failures:[{code,count}]` 是窗口内 FAILED 的当前错误码计数。`calls:{started,returned,unknown,usageAvailable,usageUnavailable}` 按调用开始时间限定窗口，只包括持久任务调用账本，不包括同步基础问答。usageAvailable 仅表示至少一个实际 token 字段为数值，不表示用量完整；未知从不记为实际零 token。`events:[{event,count}]` 是 V10 后持久事务事件，无历史回填；EXTERNAL_OUTCOME_UNKNOWN 是转为未知的批次事件数，不是调用条数。FENCE_REJECTED 属失败尝试、事务回滚，只有实例 counter，不混入 SELF 持久事件。删除任务/知识库会级联撤回关联事件和账本，因此不是永久审计仓库。

`GET /api/operations/local` 使用独立 `X-Operations-Token`，匹配 `OPERATIONS_TOKEN`（至少32字符，未设置或错误统一404）。普通用户 Bearer 不授权该接口。运维 token 不写日志、报告或网页配置，应由本机受限运维客户端持有；具有该 token 可读取此实例跨租户汇总指标，不具备文档权限。返回 `scope=LOCAL_PROCESS`、generatedAt、uptimeMs、heapUsedBytes、heapMaxBytes、availableProcessors、processCpuLoad（不可用 null）及 metrics 数组：`{name,tags:[{key,value}],values:{统计名称:数值}}`。仅允许 citebase.tasks.* 与 hikaricp.connections* 指标，无用户/任务ID维度。数据是本 JVM 累积/瞬时数，不能当作多实例数据库汇总。

`/actuator/health/liveness` 仅进程状态；`/actuator/health/readiness` 含 DB SELECT 1，连接池获取上限2.5秒、查询上限2秒，不调用模型。故障不暴露异常详情。task DB claim 失败退避至少5秒；错误计数逐次累计，警告全实例每30秒至多一次，日志不带异常正文。任务计时标签 outcome 表示本次执行尝试结局，不冒充最终数据库状态。
