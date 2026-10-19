# 第三阶段验收证据（2026-10-19）

按用户“改为依据辅助评审继续开发”的调整验收，真人覆盖0。辅助评分不能证明真人非劣；实验允许负面或不确定结论，不要求人为制造提升。所有路径相对docs/results/quality-phase3，除另有说明。

| 最终要求 | 证据 | 结果与边界 |
|---|---|---|
| 专用分支、保留改动、不推送合并 | feat/citebase-phase3；基线f4508e2770d2e9340d13f7a7181d82b19a8c3304 | 本地阶段提交，用户assisted-review-20261001目录原样保留且不提交；最终归档见PROGRESS/Git |
| 原权限、版本、引用、删除和任务回归 | admission-engineering/backend-full-279.txt及backend-external-11.txt | 268全量通过+原11跳过项专用PG实际补跑通过，共279；不是Docker构建中的跳过测试 |
| 数据、许可、稳定标签和评审 | QUALITY_BASELINE/REVIEW_PROTOCOL/ASSISTED_REVIEW_PROTOCOL、samples/phase3-quality | 12原创文档/120题/24不可回答，dev/validation/test各40；真人前置已由用户替换，HUMAN仍0 |
| Agent基线/消融/冻结独立比较 | ASSISTED_EXPERIMENTS、assisted-agent-exploration-v1、assisted-independent-v1及review | 新32消融+160独立回答/192评分；候选失败10/40高于原6/40，默认不改 |
| 成本真实消融/独立比较 | QUALITY_COST_REPORT、COST_INDEPENDENT_RESULTS、assisted-cost-independent-v1及review | 开发64行/77评分，独立240行/288评分；调用−33.33%，辅助正确下降，质量门槛不支持替换默认 |
| 辅助/真人/mock、失败与缺失区分 | report.json/comparison-initial.json/summary.json及两个recovery目录 | 240行完整，两臂各6失败；NA不强填、2 UNKNOWN不计零，真人0；候选支持证据不足不是未采完 |
| Agent/缓存/撤回/任务风险 | 后端279风险测试、operations与admission证据 | 关闭开关和原路径保留；每JVM同步背压不是全局供应商QPS限流 |
| 两实际worker/真实PG | operations/two-process-1790834245097、admission/two-process-1791637121457 | 13故障检查/794闭环mock测量，新增5组开放环容量验证；首跑失败保留，mock不作DeepSeek吞吐 |
| 长评测与混合负载 | long-evaluation/two-process-1792396487112 | 40题×2模式长任务RUNNING期间12混合操作全部完成，14检查点取消后哈希一致；不称80项全部完成/长期容量 |
| 前端与E2E | admission-engineering/frontend-build-passed、frontend-429-e2e、compose-platform-e2e-20261019.txt及历史真实只读导出 | 新构建和429手动重试通过，最新Compose平台1/1通过32.4秒；历史各流程不冒充本轮重跑 |
| Compose/数据兼容/样例幂等 | admission-engineering/compose-passed-20261019.txt、compose-data-preserved-20261019.json、seed-idempotence-20261019.json | 新源码up --build --wait通过；5张旧核心表哈希一致，5文档重复准备身份一致；早期网络失败不删 |
| 主要界面亲查截图 | docs/screenshots下quality-phase3-grounded-real-*、quality-assisted-real-*、quality-admission-429-*、compose-20261019-*及原盲评/监控截图 | 评分/问答/Agent/诊断/任务/监控已检查；最新mock截图非模型质量证据 |
| 无占位/文档一致 | 当前核心风险测试及最终源码扫描；README、架构、DEMO、RESUME与结果入口 | 无以mock冒充真实；已知Agent/质量限制明确保留，不声称生产效果 |
| 阶段提交/实验源码身份 | PROGRESS及各freeze/registration/sourceSha/image/collector-provenance/continuation-provenance | 运行源码身份独立于结果归档提交，分段恢复不错误关联新HEAD；最终Git检查记录于PROGRESS |

## 网络修复与恢复限制

用户授权后复用本机已有7890代理，Docker Desktop主机代理改Manual；BuildKit需要仅当前进程HTTP_PROXY/HTTPS_PROXY和本地NO_PROXY。未改系统DNS、未重建真实评测容器，原配置备份保留在忽略目录.tools。固定node镜像实际拉取成功、新Compose实际构建启动成功。早期Docker Hub及官方ECR失败日志完整保留。

真实成本分三个StartedAt段；两次中断均保留已完成检查点与ATTEMPTS_EXHAUSTED，存在2次UNKNOWN调用。一次供应商超时经哈希绑定调查后继续未完成任务，不重提旧结果。网络修复在212行之后，末28行环境变化；全量延迟是描述性观察，不能证明连续或因果加速。原state.json保持不变，完成标记位于20261019恢复目录。

当前工程归档3ce1d8d789d5945e5949f7b620c38a78c2d995f8已包含Compose和长评测补验；最终成本/评分/文档归档为6bbeda05ee186bd7ac5159d96db26069fa27a547；其后仅验收状态记录提交，运行源码身份不变。无未满足的外部条件；候选质量不通过导致保留默认，不将不确定性抹去来标记优化成功。
