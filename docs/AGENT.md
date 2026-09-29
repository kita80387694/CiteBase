# 有边界的 Agent

基础 RAG 仍是默认入口。Agent 是独立、显式选择的按需补充证据模式，不保证比基础 RAG 更准确。工程验证、真实实验与阶段四任务治理状态见 PROGRESS.md；不要将本文件的机制说明当成尚未完成的真实实验结论。

## 执行与权限

服务端先执行一次授权检索，再让 Spring AI 返回单个工具请求，由 Java 白名单分派。关闭模型自动工具执行及并行工具调用。模型仅能选择 search、neighbors、inspectCitation、finish；没有 SQL、Shell、任意 URL、文件读取能力。

- search 只能提供 query；认证用户、知识库、检索参数由服务端绑定。
- neighbors 只能提供本次执行的 E1 等句柄及 previous/next；SQL 再次检查用户、知识库和当前文档版本。
- inspectCitation 仅接受本次句柄，并独立检查访问权限。
- finish 不能带参数，进入最终回答生成。

工具返回的每条证据都与数据库中的归属、活动版本、文本和位置复核，才可加入执行证据。文档和工具内容被视为不可信数据。权限由代码和 SQL 实现，不依赖提示词。最终回答只允许引用本次实际取得的证据，沿用基础 RAG 引用校验。删除撤回与版本变化检查覆盖步骤保存及最终结果提交。

## 预算与终态

默认硬上限：4 次 planner、4 次工具（含初始检索）、2 次 search、12 条证据、20,000 字符、120 秒、10 次实际外部调用。planner/final 输出上限分别 256/1024 tokens。请求可以降低预算，不能提高上限。并发执行上限为每进程 2；阶段四之前不宣称集群全局限额。

重复工具调用、无新增证据、越权参数、无效句柄、引用伪造、输出截断、预算耗尽、超时和供应商错误均有失败终态。输出截断即使留下合法引用也不能算成功。证据不足的正常拒答与执行失败分开展示。未知供应商用量保存 null；实际返回零才保存零。

外层超时及时终止用户等待，但不承诺中断供应商计费。忽略中断的实际请求在结束前继续占用容量，避免 Future 取消导致无界并发。取消后不调度新动作；返回的已知用量保留，晚到内容不能覆盖取消终态。来源变化/取消的结果清空正文、证据、引用，只保留安全的计数、实际用量与状态；删除运行后禁止复活。

## 审计与模型配置

轨迹保存动作、经过白名单的参数、证据 ID、状态、耗时、实际 token 用量；搜索词只保存 SHA256 和字符数。界面不展示、服务端不要求隐藏思维链。

AGENT_CHAT_BASE_URL、AGENT_CHAT_API_KEY、AGENT_CHAT_MODEL 为空时沿用 CHAT_*；embedding 保持原 BGE 配置。最终回答继续使用 CHAT_*，planner 可独立配置。创建时保存公开配置及数据版本；执行前配置漂移会进入 CONFIG_CHANGED，且不发生模型调用。公开配置不得包含 API Key。

## 阶段三恢复边界

当前 API 合同见 API-CONTRACT-PHASE3.md。阶段三先持久创建，再显式执行；客户端断线通过原运行 ID 查询，不重新提交收费执行。相同用户/幂等键/请求复用原运行，不同请求返回冲突。创建请求恢复不会自动执行。

阶段三只支持单实例执行，重启后的在途执行标记 INTERRUPTED，不自动重放。尚未实现的多实例租约、统一异步任务与检查点治理必须在阶段四替换此策略，不能把当前恢复机制当成多 worker 能力。

## 评测口径

保持与阶段二相同的模型、语料、检索配置和固定 52 题对比。该集合已用于阶段二，属于共同固定基准，不声称是阶段三全新未见数据。Agent 的前五条证据按取得顺序计算 Recall@5/MRR，另报全部累计证据指标；不把更多上下文的收益误称为相同 K 的排名提升。保留失败样本、工具调用数、延迟、实际用量，未发生人工评分的答案正确性与引用支持度仍为 null。只有开发集可以用于配置选择；真实冒烟通过、配置冻结后才运行固定测试比较。

基础RAG沿用原供应商输出设置，Agent最终生成额外设置1024输出上限，并增加planner/工具/总时间预算。对照衡量的是整个有界模式，不能把差异全部归因于补充检索；模型、语料、初始检索和生成提示保持相同也不意味着调用预算相同。基础结果复用阶段二冻结原始运行，不为这次比较重复收费；跨运行时段的延迟只作观察统计。

## 真实实验记录与复现

首版源码fc8367e的4条开发冒烟均因重复inspectCitation以NO_PROGRESS结束，原始记录保留于docs/results/phase3。工具说明v2提交8eb9a43后，4条开发冒烟全部完成；TopK1跨文档探针只命中一半必需证据，未主动补齐，不计入正式测试质量。实际planner模型、端点、temperature、工具协议与预算见docs/results/phase3-v2/registration.json，冻结提交6285836。

在已按EXPERIMENTS.md准备阶段二隔离知识库、启动真实模式且不改动语料后，先构建并记录新runtime，再使用**新目录**运行：

```sh
node scripts/capture-runtime.mjs <刚构建的backend镜像> .tools/new-agent-runtime.json
node scripts/phase3-experiment.mjs smoke --root docs/results/new-agent-run --runtime .tools/new-agent-runtime.json
node scripts/phase3-probe.mjs docs/results/new-agent-run
node scripts/phase3-experiment.mjs freeze --root docs/results/new-agent-run --runtime .tools/new-agent-runtime.json
node scripts/phase3-experiment.mjs test --root docs/results/new-agent-run --runtime .tools/new-agent-runtime.json
node scripts/phase3-report.mjs docs/results/new-agent-run
```

默认CITEBASE_URL为http://localhost:28080。采集器拒绝MOCK、模型/参数/数据版本漂移，意图与幂等键先落盘，再创建执行；进程中断后原命令优先查询原run，不因HTTP超时重建收费运行。原始文件不可覆盖。阶段二suite.json中的知识库ID属于原隔离数据库，不能直接套用到别的数据库；全新复现应先完成阶段二数据准备并生成对应suite。新增目录意味着新的真实调用费用，旧结果分析只运行report，不必重跑模型。
