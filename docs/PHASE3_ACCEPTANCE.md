# 第三阶段验收证据（2026-10-10，未完成）

用户后续授权“改为依据辅助评审继续开发”。下表按该调整核对原第三阶段请求；HUMAN覆盖仍为0，不能由AI分配数或一致性推断真人质量。上次目标轮次产生实现、测试和本地提交15d3b5a，属于实际进展。

| 最终要求 | 当前证据 | 状态/限制 |
|---|---|---|
| 专用分支、保留原改动、不推送合并 | feat/citebase-phase3，基线f4508e2770d2e9340d13f7a7181d82b19a8c3304；本地最新15d3b5a89d9b3c23b76ef96bb5eb3e2e7a9b9cf0 | 当前未推送/合并；用户assisted-review-20261001目录不修改、不自动提交 |
| 原权限、版本切换、引用撤回和任务不回归 | admission-engineering/backend-full-279.txt 与 backend-external-11.txt | 279项均实际执行通过；268+11补跑，不把初始skip计通过 |
| 数据划分、标签、许可、评审 | QUALITY_BASELINE、REVIEW_PROTOCOL、ASSISTED_REVIEW_PROTOCOL、samples/phase3-quality | 120题/12原创文档/24不可回答，dev/validation/test各40；已改辅助口径，真人0 |
| Agent真实基线、消融、冻结独立比较 | ASSISTED_EXPERIMENTS，assisted-agent-exploration-v1及assisted-independent-v1 | 32消融+160独立回答、192匿名辅助评分；候选失败10/40高于原6/40，默认不改，负面结果不删 |
| 检索成本真实消融与独立比较 | QUALITY_COST_REPORT、ASSISTED_COST_PROTOCOL、assisted-cost-dev-review-v1 | 开发64行/77评分，冻结conditional5；独立240行分段续采与最终辅助评分尚未完成 |
| 区分AI、真人、mock和未评分 | 所有辅助包source=ASSISTED、人类界面评分0；失败原始行和UNKNOWN账本保留 | 辅助质量不当真人非劣，未评分null；独立成本结果未完成不称通过 |
| 工具/预算/缓存隔离/任务恢复 | 后端279实际通过；既有operations真实双worker矩阵，新增Admission专项8项 | 新增同步背压为每JVM，并非全局供应商QPS限制 |
| 两实际worker/真实PG负载与故障 | operations/two-process-1790834245097；admission/two-process-1791637121457 | 原13故障检查/794闭环mock操作；新增5组开放环容量/拒绝恢复检查，首失败保留 |
| 构建与关键E2E | frontend-build-passed、frontend-429-e2e、历史主要流程截图/实测 | 最新前端构建、429交互1/1通过；旧6关键流程与真实只读导出已验证。新Compose构建阻塞需补验 |
| Compose启动/旧数据兼容/幂等 | 历史V9→V10真实导出deepEqual与现库保留；本次compose-network-failure-1/2 | 新源码Docker构建两次Docker Hub超时，官方ECR副本也超时；不以旧镜像启动替代 |
| 界面亲查与截图 | docs/screenshots/quality-phase3-grounded-real-*、quality-assisted-real-*、quality-admission-429-20261010.png及既有盲评/运维截图 | 429新界面主线程已查看；临时25187新前端连旧mock用于交互测试，实际限流由双JVM验证 |
| 无占位与安全绕过、文档一致 | 核心TODO/FIXME检查与风险测试；文档持续同步 | 最终成本结论与当前启动限制待统一收尾，不提前盖章 |
| 阶段提交/实验代码身份/工作区 | 27219a0、3751e2、e4314c8、6709b23、6eb684d、15d3b5a；注册sourceSha/image/collector hash | 正在写入实验产物，不是干净最终工作区；最终需逐项核对后归档 |

恢复边界：2026-10-01停机前48已保存行，另一个评测停机后FAILED但保留一条成功checkpoint和一条ATTEMPTS_EXHAUSTED，调用3 RETURNED+1 UNKNOWN。新recover工具禁止缓存实验跨重启复用，只允许本实验同容器/镜像/模型/源码/配置、StartedAt前移，记录两时段原始文件hash与逐行runtime。跨9天延迟仅描述观察，不解释为连续或因果性能证据。旧state原字节与原注册保持，恢复状态单独保存。

镜像故障诊断未改系统DNS/代理。Docker官方说明其公共镜像同时发布在ECR：[Docker Official Images on Amazon ECR Public](https://www.docker.com/blog/news-from-aws-reinvent-docker-official-images-on-amazon-ecr-public/)。本次同版本node:22.14.0-alpine从该官方副本尝试也因匿名token请求超时失败，原日志保留。已请求用户恢复镜像网络，仍继续其他可推进工作。
