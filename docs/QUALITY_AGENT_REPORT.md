# Agent 探索结果报告与调用审计

本工具只对第三阶段开发/验证探索作工程描述，不选择策略、不改变默认、不生成真人评分，不访问独立测试集结果。冻结采集器和原始文件保持不变。

```powershell
# 纯本地读取，输出必须为尚不存在的新文件；进行中也可报告，但明确 pending。
node scripts/quality-agent-report.mjs report docs/results/quality-phase3/agent-exploration .tools/agent-exploration-report.json

# 由主执行者设置探索环境 CITEBASE_URL 后运行；仅登录及 GET 已知任务，不创建 Agent/model 工作。
$env:CITEBASE_URL='http://localhost:<探索后端端口>'
node scripts/quality-agent-report.mjs audit docs/results/quality-phase3/agent-exploration

node --test scripts/quality-agent-report.test.mjs
```

报告从 registration 的 8 题 × 4 策略全部 32 个意图出发。每策略分母 8 不变，终态失败保留。尚有 pending 时总体 failureRate=null，仅另列 observedTerminalFailureRate，不能将未结束项算成功。均值与 P50/P95 基于可用终态耗时，缺失数量明确；百分位采用 nearest-rank。检索 Recall/MRR 为自动辅助指标，不等于答案正确，Agent 前五证据为获取顺序而非重排结果。

counts 为每次执行 budgetUsed 中的 tools/searches/plannerSteps/externalCalls 分布。returnedResultUsage 只汇总运行结果保存的供应商实际字段；实际总 token 缺失不通过加法估算。独立 taskAudit 汇总持久调用账本及未知调用，不能与 returnedResultUsage 相加重复计费。尚缺任何对应任务审计时，该策略的总调用数和未知调用总数保持 null，另列已观测数量。索引开销不在32次Agent执行的审计范围内。

审计从已有 raw 或持久 journal 读取 runId，不因为缺原始结果重新提交。活动任务只列 pending，不冻结快照；终态任务以不可覆盖文件保存在探索目录 tasks/。再次执行复用并检查已有记录的ID、终态与调用账本。这里验证的是任务/调用记录，不能证明账号操作者为真人。

humanCorrectness、humanCitationSupport、qualityConclusion、selectedStrategy 始终为 null，defaultChange=false。没有人工评审时，不得把工程完成率作为质量收益或正式参数选择依据。
