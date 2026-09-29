# 阶段三 Agent API 合同

阶段三采用持久创建、同步 execute、独立 GET/cancel；尚非异步 worker。所有路由 Bearer 会话，非所属对象404。默认RAG接口不改变。

## 创建与执行

`POST /api/agent-runs` JSON：`{kbId,question,mode?,topK?,retrievalOptions?,budget?,idempotencyKey}`。question 1–4000字符，mode默认vector，topK默认5。检索选项沿阶段二。idempotencyKey 1–100字符；同用户同key同body返回同一运行，不再执行；异body409。未知字段、NUL及类型错误400。

budget各字段可省略，仅允许降低硬上限：`maxPlannerSteps:4,maxTools:4,maxSearch:2,maxEvidence:12,maxEvidenceChars:20000,deadlineSeconds:120,maxPlannerOutputTokens:256,maxFinalOutputTokens:1024,maxExternalCalls:10`。整数均>=1。并发上限2由服务端控制，不可请求修改。

创建返回运行视图。`POST /api/agent-runs/{id}/execute` 无body（兼容空对象），同步执行，已有执行/终态返回现状不会重复调用模型；容量不足429且仍可稍后execute。执行前比较当前公开模型/检索/planner/策略配置与创建快照，变化则FAILED/CONFIG_CHANGED且零外部调用。客户端先创建获取id，再execute，同时可轮询GET。`POST /api/agent-runs/{id}/cancel` 无body，幂等取消；当前有界调用可能结束后才停止，不承诺供应商未计费。

`GET /api/agent-runs/{id}`；`GET /api/agent-runs?kbId=...`（最多100条）；`GET /api/agent-runs/{id}/export`，均所有权校验。

## 运行视图

`{id,kbId,status,request,config,snapshot,createdAt,startedAt,finishedAt,cancelRequestedAt,errorCode,result,steps}`。

status：CREATED/RUNNING/CANCEL_REQUESTED/COMPLETED/FAILED/CANCELLED/INTERRUPTED。result未完成时null。失败含errorCode，不能当正常证据不足。request包含归一化options和budget；config记录模型/供应商/策略版本；snapshot保存active数据版本。步骤为已执行动作和证据，不包含思维链。

result：`{kind:"bounded-agent",question,answer,evidence,citations,citationValid,abstained,error,finishReason,modelMode,retrievalOptions,mode,retrievalMs,totalMs,budgetUsed,usage,answerCorrect:null}`。evidence使用原Evidence结构；citations为Evidence数组，其中id为真实UUID，可调用现有`/api/citations/{id}`。usage为逐外部调用记录数组，缺失字段null；budgetUsed含plannerSteps/tools/searches/externalCalls/evidenceCount/evidenceChars。外部调用数按实际开始调用记录，不用估算token代替预算。

steps：`{sequence,kind,action,status,input,output,usage,elapsedMs,createdAt}`。kind为tool/planner/generation；status为COMPLETED或FAILED。search input仅存querySha256/queryChars/固定动作说明，其他参数仅保留经白名单验证的handle/direction；planner只存工具名与callId，tool output仅存证据ID或失败原因，不存超预算正文或隐藏推理。删除文档时该知识库Agent记录一起撤回。

失败result保留已完成检查点的证据、计数与已知usage，但citationValid=false、citations=[]，不得显示为正常答案。取消或来源变化时清空answer/evidence/citations，保留已知usage、计数、耗时及未知标识；尚无检查点时result可为null。删除则彻底撤回运行及轨迹，禁止晚到写入。`inFlightUsageUnavailable`表示未得到在途调用的实际usage；不得补零估算。retrievalMs是累计search工具耗时，包含供应商和检索SQL，非单独向量SQL耗时；budgetUsed.externalCalls只计真实模式已开始的供应商调用，mock为0。

总deadline由外层执行控制，超时可及时返回FAILED/TIMEOUT。若供应商忽略中断，内部线程等待实际调用结束再释放并发容量；随后请求可能429，不能把future已取消当作供应商已停止或免费。阶段三仍仅单实例，启动时RUNNING/CANCEL_REQUESTED标记INTERRUPTED且不重放收费步骤；多实例恢复属于阶段四。

## 受限动作

服务端强制初始search计入工具/search预算；随后planner仅能：search `{query}`、neighbors `{evidenceHandle,direction:"previous"|"next"}`、inspectCitation `{evidenceHandle}`、finish `{}`。handle为本run服务端生成E1等，不能传owner/kb/document/version。未知动作/参数、重复toolCallId/重复无进展、预算超限明确失败。最终生成沿用RAG规则，对本run积累证据执行引用校验。

错误码示例：BUDGET_EXCEEDED、TIMEOUT、NO_PROGRESS、INVALID_ACTION、INVALID_EVIDENCE、TOOL_NOT_AVAILABLE、PROVIDER_ERROR、OUTPUT_LIMIT、INVALID_CITATION、SOURCE_CHANGED、CONFIG_CHANGED、INTERRUPTED。供应商报告输出截断即FAILED/OUTPUT_LIMIT，即使片段包含合法引用也不能当成功；返回实际usage照实保存。取消终态CANCELLED。扫描来源更新或删除后不发布旧快照；删除后GET404。mock明确modelMode=mock，不能当真实Agent效果。
