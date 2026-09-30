# 第三阶段 Agent 失败机制预分析

日期：2026-09-30。状态：**等待真人质量评审期间的只读预分析**。本文件没有实施新策略、运行模型、查看本阶段新独立测试集结果，亦未选择最终配置或宣称质量提升。只使用上一阶段已经观察的历史结果和当前源码；该旧集不能继续称为未见测试集。

## 证据范围和复现口径

历史执行版本：`8eb9a43bc41ce3e5a4efb2ff8b2bd26fece307e4`。当前源码审查版本：`a0d501ebcd1291c2c7f5466fd9f5d08c9ae42274`。当前模型调用与评审基线镜像保持冻结，不随本分析改动。

主输入：[供应商恢复组合报告](results/phase3-v2/provider-recovery/report.json)、[报告说明](results/phase3-v2/provider-recovery/report.md)。有效组合是58份原记录加46份独立登记的供应商恢复记录，合计104份；不是一次不中断运行。原始104次与46次恢复尝试全部保留。旧供应商失败没有混入下表中的预算/无进展机制归因；完整150次调用成本仍按原报告单独统计。

复核方法：遍历组合报告104行，以 `caseId-mode` 找恢复 `runs/*.raw.json`，不存在时找原 `test/*.raw.json`；按 `steps.kind == tool` 统计工具序列，并核对终态、budgetUsed和generation步骤。没有读取新测试集。

| 历史终态 | 实际已完成的工具序列 | 数量 |
|---|---|---:|
| COMPLETED | search | 21 |
| COMPLETED | search → inspectCitation | 36 |
| COMPLETED | search → inspectCitation × 2 | 6 |
| COMPLETED | search → inspectCitation × 3 | 4 |
| FAILED/BUDGET_EXCEEDED | search → inspectCitation × 3 | 25 |
| FAILED/NO_PROGRESS | search → inspectCitation | 12 |

合计104次初始search、147次inspectCitation；**没有一次已执行的补充search或neighbors**。37次失败全部尚未进入generation。67次COMPLETED只表示流程完成，不表示答案正确。人工正确性和引用支持评审仍为空。每次累计证据数为5，累计召回为1也不能推导语义充分性。

## 可确认的触发机制

### 1. 元数据检查消耗了事实收集预算

`AgentToolService.inspectCitation` 重新验证handle和来源权限，返回已存在的证据，不能添加事实或判定结论正确。`perform` 已对每份新证据调用 `tools.verify`；最终引用还有代码验证。因此147次inspectCitation是可确认的重复来源检查工作，不是147次语义证据核验。

`AgentPolicy.DEFAULT` 为4个planner步骤、4个工具、2次search、10次外部调用。服务端初始search已经消费一个工具名额。3次inspectCitation后工具计数达到4；第4次planner仍可请求inspectCitation，但 `c.tool` 在实际执行前拒绝，整次回答终止。

具体例：[tide-005/vector原始记录](results/phase3-v2/test/tide-005-vector.raw.json)，run `dab3a97c-b349-4d0a-8384-4d5220dfe1a4`。步骤1检索、3/5/7检查E1/E2/E3、步骤8再次请求inspectCitation，之后BUDGET_EXCEEDED。budgetUsed为tools=4、plannerSteps=4、searches=1、externalCalls=6、evidenceCount=5。故该例不是外部调用总数、证据数或超时上限耗尽。

该例首个证据ID为 `1a667e90-8861-4eeb-a0ce-55c6e135639d`，其余证据ID及原文留在原始文件；这里不把“已召回”写成“答案足够”。25个预算失败均有同一工具序列。

### 2. 重复检查触发保护；保护本身应保留

`perform` 使用 `action + new TreeMap(args)` 建立签名，重复签名在工具执行前抛NO_PROGRESS。这是正确的服务端循环边界。现有planner仍可能重复请求已检查的handle，导致没有最终回答。

例：[tide-012/hybrid原始记录](results/phase3-v2/test/tide-012-hybrid.raw.json)，run `f5503c61-3819-4d90-b874-93191a42ae4e`。初始检索后检查E1（证据 `fcd3a807-0cb9-438e-a015-b726e31ba1c4`），步骤4再次请求inspectCitation，随即NO_PROGRESS。计数tools=2、plannerSteps=2、externalCalls=4。历史轨迹没有保存被拒绝planner参数，所以“同handle”是由代码分支与终态共同推断，不是假装在日志中直接看见了被拒绝参数。

12个NO_PROGRESS失败均是这类序列。不能删除保护或把失败改为COMPLETED来提高成功率。

### 3. 提示词已经提醒过，单纯重复提示没有验证依据

当前及历史v2提示明确写有“已有证据已验证”“无需逐一inspectCitation”“立即finish”和“禁止重复同handle”。忽略换行差异比较历史与当前planner源码，主要变化是供应商错误分类，而非这套策略。

因此“再增加一句不要循环”不是已验证修复。可以将模型可选动作空间、预算状态和服务器状态机作为更可检验的干预变量。

### 4. 预算和进展信息未作为明确状态输入

planner收到question、untrustedEvidence、validatedActions，没有明确的remainingPlannerSteps、remainingTools、reservedGenerationCalls或可用动作集合。模型需要自行推算已用额度，且不知道未来生成需要保留调用机会。

当前拒绝调用发生在planner返回后，拒绝的动作只留下planner action/callId，没有独立 `REJECTED_TOOL` 事件及脱敏参数。这不构成权限绕过，但妨碍精确区分工具预算、重复动作和候选预算失败。新增审计字段是可独立验证的工程改进，不能据此声称质量收益。

### 5. 无进展和证据容量限制有额外待测边界

源码中search/neighbors只要没有新增chunk就终止；inspectCitation例外。如果邻段已在初始结果内，可能本次查询有效但没有新ID，随后NO_PROGRESS。证据数或字符数达到上限时，整次执行失败而非显式返回截断结果。这两点是源码确认的边界，**不是上述37份历史失败已发生的归因**。需定向测试和人工质量证据决定是否调整。

## 待验证策略与独立消融

以下名称只是建议的配置草案，尚未实现、启用或选优。基础RAG、原 `bounded-agent-v1` 和原预算必须保留。

| 建议开关 | 单独改变的机制 | 不允许改变的边界 | 需要验证的风险 |
|---|---|---|---|
| `plannerInspection=server-only` | 常规planner动作不展示冗余inspectCitation；Java来源与最终引用检查仍强制执行，审计仍可展示检查 | 不能取消tools.verify/最终引用校验，不能开放新权限 | 隐藏工具是否减少无谓动作，是否影响模型选择；恶意handle仍拒绝 |
| `plannerBudgetContext=true` | 传入实际剩余额度与允许动作元数据，避免模型猜测预算 | 不增加预算、不透出userId/KB权限参数 | 额度临界值、未知token、取消后无新调用 |
| `progressAwareActions=true` | 在请求前用确定性历史屏蔽已完成的相同动作，记录被屏蔽原因 | 后端重复调用防线保留；不把所有失败转换为finish | 大小写/空白变化的重复query、未知handle、伪造输出、所有动作耗尽 |
| `evidenceGate=v1` | 初检后显式选择“可回答/有具体缺失事实/不足且无法补充”，缺失分支才允许补检 | 判定不能使用gold/test标签；模型判断只是辅助，不等同真实性 | 近似事实、跨文档、多跳、表格、恶意文档、应拒答问题 |
| `collectionStop=explicit` | 收集正常停止、无进展失败、预算失败使用不同原因；仅正常停止后生成 | 不捕获BUDGET_EXCEEDED/NO_PROGRESS再悄悄改成功 | 失败分母不变、停止后回答仍需引用和人工审查 |

优先实验应把“动作集合限制”和“新增充分性判定”分开；同时改变两者无法判断收益来源。若证据门控新增模型调用，必须计入延迟与实际用量。按相同基础模型、检索配置、文档版本、输出长度与预算作对照；若比较完整路径导致不可避免差异，逐项披露。

## 必须保留的回归与验收门槛

- 原始失败记录、原Agent路径、基础RAG默认入口保持不变。
- 重复签名、超时、调用预算、取消、源文档变更、租约失效不能被新策略绕过。
- 所有工具继续绑定认证用户和知识库；query/handle参数不得注入userId、KB、SQL、URL、文件路径。
- 新轨迹只保存动作、脱敏参数、证据ID、状态和实际用量，不请求或持久化隐藏思维链。
- 生成前重新验证来源，生成后校验引用；未知token保持null。
- 用可控planner测试：第一步finish；反复检查同handle；不同handle检查耗尽；无可用补充动作；邻段已存在；候选过大；在途取消；最后一次调用失败；返回未授权工具/证据。
- 对每个策略单独做开发/验证集实验和消融，先完成正式人工基线再选择方案。选择后冻结新独立测试集评估；未发生的人工评分不能补写。
- 报告失败率、人工正确性/完整性/引用支持/拒答、调用次数、P50/P95延迟和实际用量。降低失败率但降低正确性不算已证明收益。

## 输入校验摘要

| 文件 | SHA-256 |
|---|---|
| provider-recovery/report.json | `97de6237688f0e5c2da9228ba4cba38b3ad232a2cc8f6692b8af433f227385fd` |
| test/tide-005-vector.raw.json | `0d0a6e2cf1a1a5f422bebf9f6fd45b4378e1d750b7013993b692182f0d8371aa` |
| test/tide-012-hybrid.raw.json | `c9d0469d798570cd238c76207a103af75ac5d49bbac995968eb2d629c8bf3f1d` |
| AgentPolicy.java（当前） | `1b16e61d97e7801d5344f371f615be33a97eb5c6121f08f2ed32fd1da3af32ae` |
| AgentService.java（当前） | `2b2faaf4a4e634c2d098022e9ded77289271d779842c21e861c5f978234942cc` |
| SpringAiAgentPlannerGateway.java（当前） | `03aefdf5d08ce26bff738488449f877137e86e9b313cb9b0242953d4061bcc43` |

结论范围：历史37次失败集中于冗余inspectCitation序列，可以确认执行机制和提出消融候选；不能据此断言任何新策略更准确、更快或已经通过第三阶段验收。
