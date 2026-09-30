# Agent 第三阶段策略契约（探索性工程）

状态：代码实现，56项后端专项测试和2项UI/旧Agent回归通过；真人质量评审未完成。没有策略质量选择，没有真实对比收益结论；现有冻结真实基线镜像不随源码变化部署。

## 请求与兼容

`POST /api/agent-runs` 新增可选 `strategy`：

| 值 | 行为 |
|---|---|
| `original`（缺省） | 原planner接口、原工具声明、原预算与停止行为 |
| `inspection-free-v1` | planner仅见search/neighbors/finish；Java来源权限及最终引用校验不变 |
| `stop-aware-v1` | 按当前预算动态限制可用工具和handle；重复signature仍服务端拒绝；预留最终生成调用 |
| `combined-v1` | 上述两项组合，供单独消融后比较 |

未知值、null和非字符串由请求校验拒绝。原7参数Java Request构造器仍兼容，旧持久JSON缺strategy反序列化为original。original写库时继续省略strategy，保持旧序列化请求hash、幂等key重放与配置快照兼容；非默认持久到request.strategy、config.agentStrategy与agentStrategyProtocol。所有结果新增strategy。旧结果无字段时按original显示。

## 受限执行

每次planner之前创建独立不可变Constraints；不使用全局可变状态或跨请求共享工具表。新策略通过独立重载传递constraints，original仍走原5参数接口。真实Spring AI Gateway按本次allowedTools创建工具声明，提供可用handle枚举与remainingBudget。模型请求未声明工具仍由gateway和服务端再次拒绝，不能仅依赖提示词。

stop-aware在最后一个planner步骤或工具额度耗尽时只声明finish；达到search次数上限或剩余外部调用不能同时覆盖search、下一次planner和最终生成时隐藏search。仅剩一次外部调用时，neighbors/inspectCitation也隐藏，只允许finish。预算计算为本次planner后至少预留一次generation，rerank开启时search保守保留embedding+rerank两次调用。原始上限不增加。剩余预算不足以再调用planner并保留生成时进入BUDGET_EXCEEDED，不偷偷增加调用、不直接生成、不改为成功。

已检查handle从inspect候选移除；邻段handle在previous/next均已调用后移除；重复query或相同邻段参数在执行前以signature校验拒绝。服务端旧重复检测、无新增证据检测仍保留。部分已调用direction仍可能由模型返回，此时明确NO_PROGRESS，不能因此声称所有模型重复请求都消失。

finish只表示模型选择结束收集。之后仍由原模型根据当前证据生成并经过引用校验；不足应拒答。无证据时沿用原明确拒答。INVALID_ACTION、NO_PROGRESS、预算、工具故障、超时、取消及源变更均保持失败或取消终态，未增加catch失败转成功的回退。

## 轨迹与消融边界

新策略planner步骤output增加policy：strategy、allowedTools、remainingBudget；仅行动元数据，不保存隐藏思维链。实际用量沿用供应商值，未知仍null。inspection-free只限制引用检查动作；stop-aware可以单独使用，因此两因素可消融。所有检索参数、模型、预算和引用校验保持不变；不能将mock风险测试算作质量提升。

## 风险测试入口

`AgentStrategyUnitTest`：enum/默认兼容、动态工具、禁止伪造inspect、最后planner与工具预算、生成调用预留、重复签名、真实gateway schema、请求隔离与不可变性。

`AgentStrategyIntegrationTest`：继承全部原Agent风险测试，再验证旧请求hash和显式original幂等、三新策略持久/引用、禁用工具服务端拒绝、末步偷跑search、重复query终态、取消、源撤回、无证据拒答及超时。测试是MOCK与真实PostgreSQL的工程验收，不是模型效果结果。

## 未完成的质量条件
这些策略解决的是动作控制和预算分配，**没有实现或证明可靠的语义证据充分性判定**。现有系统提示要求模型针对问题所需事实判断finish，仅在缺少具体事实时search/neighbors；这一判断仍由模型作出，必须经真人答案与引用支持评分验证。没有新增gold驱动规则、隐藏思维链或未经消融的gap字段。本轮不执行新独立测试集，也不默认替换基础RAG或original Agent。
