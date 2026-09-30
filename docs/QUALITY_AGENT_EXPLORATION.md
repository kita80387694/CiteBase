# Agent 策略探索采集器

状态：探索性工程对照工具，**没有运行真实模型、没有完成真人质量选择、没有执行独立测试集**。Node测试使用合成内存数据与可控HTTP替身，不计真实质量结果。

## 预登记规则

从本阶段已经预登记的40题中固定抽8题：dev和validation各4题；各组对题号SHA256升序取3道可回答题和1道不可回答题。每组顺序固定为可回答、不可回答、可回答、可回答。选择仅使用ID、split和answerable标签，不读取历史生成答案、分数、失败或本阶段test结果。

比较original、inspection-free-v1、stop-aware-v1、combined-v1。按题顺序运行，每道题将策略顺序循环移位，避免某策略始终最后执行。总计32次Agent；smoke是前2题×4策略，共8次，包含可回答和不可回答，collect复用其原始结果。单并发、同预算（每次最多10次外部调用）、同模型、检索参数和语料。索引调用单独计量；供应商未知完成窗口仍可能产生额外计费，不能把320次上限称作完整账单上限。

## 准备

主线程先部署独立真实lab，保持原40题配对基线镜像不变。使用现有capture-runtime.mjs记录刚构建的源码摘要和imageId，并补充真实运行containerName与containerImageId，两者镜像ID必须相同。只记录公开模型配置，不读取或打印密钥。

传入原40题registration路径；其同目录必须已有rag-config.json（仅读取配置，不读取结果）。API地址必须对应捕获容器的本机8080映射端口。每次新Agent调用前重新核验实际Docker镜像与端口；不接受远程URL或其他容器端口。

```powershell
$env:CITEBASE_URL='http://localhost:<lab-api-port>'
node scripts/quality-agent-explore.mjs seed <output-root> <baseline-root>/registration.json .tools/quality-agent-lab-runtime.json
node scripts/quality-agent-explore.mjs smoke <output-root> <baseline-root>/registration.json .tools/quality-agent-lab-runtime.json
node scripts/quality-agent-explore.mjs collect <output-root> <baseline-root>/registration.json .tools/quality-agent-lab-runtime.json
```

seed首次写入不可覆盖的探索registration（包含原registration SHA、数据SHA、运行镜像/源码身份、采集器代码SHA、固定题号/顺序/预算/模型）。它只上传dev/validation文档，验证本地文档hash并等待索引。随后幂等创建第一个original Agent但不执行，用该请求获取服务端真实snapshot/config并核对原基线模型和检索配置。

## 持久化与失败语义

- bootstrap-intent.json在创建前保存。创建响应丢失可重复同key/body取得原run；不重新生成key。
- 每次Agent复用phase3-experiment的INTENT/state/raw流程。执行响应丢失先GET原run，已排队不再POST execute；终态失败保留且不静默重试。
- `.raw.json`、逐题`.derived.json`、各策略config、snapshot及registration不可覆盖；复跑校验相等并复用。
- dataVersion、model、provider、策略、镜像或脚本变更会阻止继续；如需新实验，应另作登记，不能改旧raw或关联到新代码。
- PROVIDER、认证、余额、SOURCE_CHANGED和CONFIG_CHANGED先保存raw再停止，人工定位后决定新的登记。NO_PROGRESS/BUDGET_EXCEEDED等策略失败保留在探索分母，不删题。
- 成功回答须通过引用格式校验，并实际访问每个引用来源；不将这些辅助信号当作答案正确。
- `smoke-rows.json`/`collect-rows.json`保存逐题指标、延迟、实际用量与缺失值；humanScores、qualityConclusion保持null，defaultChange=false。

本工具不评估新独立测试集，不选择获胜策略、不修改默认，不替代真人评审。8题仅适合机制冒烟与探索性消融，不支持稳定效果或性能提升结论。

## 已执行脚本验证

`node --test scripts/phase3-experiment.test.mjs scripts/quality-agent-explore.test.mjs`：15项通过、0失败、0跳过。覆盖历史original兼容、strategy漂移、创建/执行响应丢失恢复、冻结语料、固定选题、不依赖输出、拒绝test题、32次平衡顺序及真实容器身份/端口校验。
