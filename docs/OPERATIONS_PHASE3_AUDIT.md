# 第三阶段运维与负载只读预检

状态：**保留的实施前静态审查（2026-09-30），不是当前功能状态**。下文“当前/尚未实现”均指预检时。2026-10-01已实现监控、探针、事件与退避，并通过专项及全量测试；第三次实际双进程故障与负载13项检查通过、794测量操作零失败。最新状态见OPERATIONS.md、LOAD_TESTING.md与PROGRESS.md。真人质量门槛仍独立存在。

## 当前可复用能力与具体缺陷

- `TaskWorker` 使用实例 UUID、Semaphore 并发上限、真实任务领取及独立心跳线程。`TaskSettings` 校验并发 1–8、租约至少三个心跳间隔、有限重试等参数。
- `TaskTelemetry` 已登记 active gauge、kind/state transition counter、execution timer，并输出固定字段日志。用户ID、问题正文没有成为指标标签。
- `application.yml` 当前只暴露 `/actuator/health`；Compose 用该端点探活。尚未显式定义 liveness/readiness 探针分组，亦未暴露 Prometheus 或自有监控页面，不能宣称已有可用监控看板。
- **计数缺口**：`FENCE_REJECTED`、`EXTERNAL_OUTCOME_UNKNOWN` 虽在枚举中声明，当前仓库调用点未实际触发；相应 fence counter 不能作为已覆盖指标。lease 回收与 provider 错误没有专用计数，transition 仅 kind/state 无 event，无法区分同状态下不同事件。
- **计时口径缺陷**：worker局部state默认FAILED，只有成功与defer会更新；取消、RETRY_WAIT、租约丢失等都会进入FAILED计时，不能把 execution timer 的 state 当成数据库最终任务状态。应改为执行尝试outcome或真实终态，且保留租约丢失/取消区别。
- 心跳 SQL 发生 RuntimeException 时只 interrupt，没有固定错误计数；claim异常从tick抛出可能由调度器连续记录。数据库故障时需验证日志频率与连接池恢复，不假定已具备背压。
- 当前没有数据库聚合的积压/最老等待、排队时延、待取消、活跃租约、未知供应商调用、连接池/CPU/内存的联合报告。worker semaphore限任务，不代表同步基础问答也受同一并发保护。

## 已有双进程工具覆盖边界

`scripts/phase4-process-harness.mjs` 创建隔离 PostgreSQL 容器及两个实际 Java 21 进程，检查编译源码/类路径摘要；`ProcessWorkerApplication` 仅test classpath、固定本机端口、mock模式和新测试DB命名。模型适配器显式 `mock/fault-test-only`，不可用于质量或真实供应商吞吐结论。

| 场景 | 历史脚本已有断言 | 第三阶段需补证据 |
| --- | --- | --- |
| 两worker竞争领取 | 启动B不抢A有效租约；两进程均实际领取 | 当前代码重跑并记录PID/workerID/任务代次 |
| worker崩溃 | kill A，B恢复评测未完成题，首题摘要不变，未知调用保留 | 当前代码重跑；补Agent不可安全续跑终态 |
| 租约失效/过期写入 | A活着但租约强制过期，B发布索引，A晚到不可覆盖 | 当前代码重跑；记录拒绝计数与原始证据 |
| 取消竞态 | 模型gate在途取消，晚到不成功、不调度下一题 | 增补Agent取消、并发队列取消与监控收敛 |
| 数据库短暂不可用 | **无实际场景** | 仅暂停/断连专用测试DB，恢复连接后核对检查点/fence/重复窗口 |
| 供应商限流/超时 | gate支持429/500/504、hold/delay，但当前5项主场景未覆盖限流矩阵 | 实际两进程触发有限429/504，检查重试间隔、上限、活跃数和无重试风暴 |
| 删除/撤权撤回 | **无双进程主场景** | 在途检索/评测/Agent期间删除测试文档，结果/引用/缓存/评审全部撤回；现有所有权模型不能虚构团队撤权能力 |
| 混合负载 | **无持续负载**，仅顺序故障小场景 | 索引+基础问答+Agent+评测同时进来，测饥饿、排队、吞吐、失败和资源 |

fault gate 可hold/delay/fail embedding、generation、planner，不含reranker；门控上限单规则1000次、delay≤30秒、hold自动180秒。当前模拟 planner 固定finish行为，不代表复杂Agent决策负载。固定端口25435/28083/28084/39555需先检查占用，不能停止未知服务。第二阶段遗留容器应明确识别归属，不删除用户数据或卷。

## 最小监控 API/UI 建议（尚未实现）

新增认证的 `GET /api/operations/summary?windowMinutes=60`：在SQL内按认证用户过滤自己的work_task/work_call，再按kind/status聚合；window限定例如5–1440分钟。不要通过全局Micrometer数据声称这是用户级结果。

建议返回：generatedAt、scope=SELF、window、modelMode；各kind的queued/running/retryWait/cancelRequested、oldestQueuedAgeMs；窗口终态计数与失败原因固定分类；排队和端到端延迟sampleCount/mean/P50/P95（明确创建到首次领取/最终完成定义）；供应商RETURNED/UNKNOWN与实际usage.available/unavailable。租约/重试事件如果没有持久记录只能报告“不可用”，不能回推为0。不得返回问题、凭据、原始provider响应或别人的任务ID。

实例级active、连接池、JVM/CPU/内存和Micrometer事件需要独立LOCAL_PROCESS作用域，与数据库跨worker汇总明确分离；若无管理权限模型，先由本机受限运维入口读取，不向普通用户开放跨租户统计。避免以taskId/userId/query作为指标标签；日志可使用任务ID定位但不得记录正文和密钥。

中文UI增加“运行状态”：任务积压/等待、最近错误原因、调用未知数和耗时卡片，标明统计窗口、样本量、作用域和mock模式。提供加载/空数据/失败重试；历史指标不存在则显示不可用，不能放静态图。任务详情链接沿用现有权限接口。

健康分开：liveness只代表进程存活，readiness检查DB且使用有界超时；真实供应商额度/延迟不放入每次健康检查，避免健康探测产生付费和故障放大。

## 最小负载登记建议（待实施，非结果）

在新隔离DB预登记机器/Java/PG/源码与镜像、worker=2、每worker并发、CPU内存限制、连接池、租约/心跳/重试设置。先小冒烟，再并发1/2/4/8阶梯；每阶固定预热及测量时长，并记录不足样本，不临时延长只为得到好结果。建议mock故障adapter小规模每阶60秒预热、120秒测量，真实模型另做有预算的小样本，不混算。

混合请求比例预登记，例如索引10%、基础问答40%、Agent20%、评测30%；评测题数、文档大小、payload和缓存冷/热策略固定。测量包含提交到终态的队列时间，异步202不算工作完成。开放环或闭环模型需明确，报告计划到达率、实际提交率、完成率、积压及被拒绝率，避免协调遗漏。

停止条件包括专用DB不可恢复、越权/引用撤回失败、无界重试、资源越过预登记上限、测试外服务受影响。只对本次创建的进程/容器注入故障，保存日志、每任务checkpoint hash和调用账本。故障恢复定义从恢复条件成立到任务恢复/可解释失败，不能只看HTTP恢复。

大负载结论只能称为受控适配器下的应用吞吐与恢复。真实模型的小规模结果单独报告延迟和用量，不能把gate吞吐包装为DeepSeek吞吐。保留失败、未知外部调用窗口和所有未测项。
