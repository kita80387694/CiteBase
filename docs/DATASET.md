# CiteBase 第二阶段数据集

## 版本与复现边界

数据集位于 `samples/phase2/`，版本 `citebase-phase2-v1`，固定 seed 为 `20260928`。本版是逐条编写的虚构运行资料与问题，没有随机抽样、自动问题改写或模型生成器调用；seed 是版本标识，不暗示使用了伪随机算法。资料内容、问题顺序和主题划分均冻结，改变资料或问题必须发布新版本，并用新的实验标签保存结果，不能覆盖既有原始评测。

冻结 manifest SHA-256：

```text
6273a8d9c172df402faa5dbfe1049dd11091bdb9d1aef57f0d6441a3c94fee14
```

`manifest.json` 记录每份原文的字节哈希、类型、主题、split、页数和预计分块数；`files` 记录数据集、抽取文本、安全用例、许可文件等文件哈希，`generatorFiles` 记录三个生成源文件的哈希。`manifest.sha256` 校验 manifest 本身。不存在创建时间、随机 PDF 文档 ID 等会让重复生成发生变化的字段。

本版文档、问题、参考答案及证据标注均为 CiteBase 原创虚构资料，按 `samples/phase2/LICENSE` 中的 CC0-1.0 声明发布。所有业务阈值只定义测试语料内部事实，不是医疗、环保、食品安全或运输规范。

## 规模与划分

| 主题 | Markdown 文档 | 文本 PDF | 分组 | 问题数 |
|---|---|---|---|---:|
| Harbor 冷链交接 | harbor-handbook.md | harbor-cards.pdf | dev | 26 |
| Quartz 展馆预约 | quartz-handbook.md | quartz-cards.pdf | dev | 26 |
| Moss 种子库 | moss-handbook.md | moss-cards.pdf | dev | 26 |
| Lumen 字幕交付 | lumen-handbook.md | lumen-cards.pdf | dev | 26 |
| Tide 河道采样 | tide-handbook.md | tide-cards.pdf | test | 26 |
| Ember 陶瓷烧制 | ember-handbook.md | ember-cards.pdf | test | 26 |

共有 **12 份文档、156 道质量评测题、24 个独立安全用例**。156 题中 132 题可回答、24 题不可回答；dev 为 104 题，test 为 52 题。每主题的两份资料及其所有问题一起划分，跨文档题只引用本主题的资料；不存在同一主题的一份文档进入 dev、另一份进入 test 的情况。

四个 dev 主题用于诊断与检索参数选择；两个 test 主题保留用于报告冻结配置后的结果。即使基线同时保存 dev/test 原始输出，也不能根据 test 错题反向选择配置，再把该结果称为未使用过的测试集。若后续多轮查看 test 并进行调参，须记录这一事实并另建保留集。

| 主类别 | 数量 | 主要考查点 |
|---|---:|---|
| 事实 | 18 | 明确位置的单项业务事实 |
| 同义 | 18 | 用口语描述同一操作，不直接复用术语 |
| 缩写 | 12 | 缩写含义、指标和角色区分 |
| 近事实干扰 | 18 | 旧版标准、专项标准、相近阈值与适用范围 |
| 跨段落 | 24 | 两个或更多独立条件联合判断 |
| 跨文档 | 24 | 中英文资料互补，组合推理与单位换算 |
| 表格 | 18 | 行列对应、边界条件和差值计算 |
| 不可回答 | 24 | 原文未提供的金额、真实测量、隐私或专业结论 |

类别是一个题目的主要意图，彼此可能有交集，例如“缩写”题也可能用到两份文档。每个主题有 22 道可回答题和 4 道不可回答题；没有通过给同一问题反复改几个词来扩充数量。不可回答题具有具体缺失条件，不能根据语料以外的常识填造答案。

## 文档形态与成本

六份 Markdown 均包含原创规则、近似但不适用的旧规则及三张表格。Harbor 另含约 10 KB 文档总长度的跨班次事件长文，附录保持一个超过 900 个 UTF-16 单元的长段落，用于验证重叠窗口位置。附录叙述断网、重复上传、交班、时间修订和档案等不同过程，不以重复句子堆积长度。

六份 PDF 使用文本对象和 Helvetica 基础字体，不是扫描图。每份有 18 张单页操作卡；每页一个独立段落。PDF 从 Node 直接生成稳定的 PDF 对象及 xref，不依赖 Python 服务、不使用 OCR、不嵌入时间戳。选择单页卡片是为了确定页码与段落边界，不能据此声称已覆盖复杂双栏、脚注、跨页表格或扫描 PDF 的抽取质量。

原文按现有 `DocumentParser` 解析得到 **220 个分块**，其中长段落有重叠窗口。安全用例不混入这 12 份评测文档；每个安全用例的独立文档只有一个小于 900 字符的段落，单独执行时通常需要一次文档 embedding。查询 embedding 和回答调用另计，不能只按文档块数估算整个实验账单。

## 稳定证据

每个可回答题提供一个或多个如下标签：

```json
{
  "documentName": "harbor-handbook.md",
  "sourceHash": "原始文件字节的64位小写SHA-256",
  "page": 1,
  "paragraph": 1,
  "startOffset": 0,
  "endOffset": 证据末尾位置,
  "quote": "该位置的原文逐字片段",
  "groupId": "g1"
}
```

以上是字段说明，实际可导入 JSON 在 `evaluation.json`、`dev.json` 和 `test.json` 中。偏移为**规范化页内文本的 UTF-16 半开区间**，即 Java `String` / JavaScript `String.slice` 使用的索引；不是 UTF-8 字节位置，也不是 PDF 二进制位置。Markdown/TXT 视为第 1 页，CRLF/CR 转为 LF。PDF 页文本由 PDFBox 3.0.6 `PDFTextStripper` 重新抽取并执行同样的换行规范化。

本版含 **200 个标签、64 道多必需证据组题、1 道同组替代证据题**。同一 `groupId` 的多个标签表示任一可用；不同 group 表示都需要。例：Harbor 旧站窗口干扰题的正式 18 分钟窗口同时存在于中文手册与英文范围卡，两者属于同一替代组；Harbor 主探头周期与红灯解除样本数则来自不同文件，是两个必需组，结合后才能算出首末有效样本相隔 160 秒。

每个题的 label 不含数据库 documentId、versionId、chunkId 或用户字段。sourceHash 绑定原始文件字节；再次切分不会改变这类标注的定位含义。题目在服务端提交时还应由后端依据当前用户所属知识库的活动版本重新解析和验证，离线校验脚本不能替代服务端权限校验。

参考答案是人工审阅用的简洁答案，中文表达、翻译和算术结果不一定在原文中逐字出现。不能把字面 referenceAnswerMatch 当成回答正确性。跨组召回、来源格式合法和引用是否真正支持回答，也必须分别报告。

## 生成和检查

前提：Node.js 22、Java 21；Maven 已构建后端，具备 `backend/target/classes/io/citebase/DocumentParser.class`，Maven 本地仓库中已下载 PDFBox 3.0.6 相关依赖。脚本优先使用项目下载的 `.tools/jdk-21.0.12.1+1`，其次使用 JAVA_HOME 或 PATH；可通过 MAVEN_REPO 指定本地依赖仓库。首次 Maven 下载需要网络。

在仓库根目录执行：

```powershell
node scripts/generate-phase2.mjs
node scripts/check-phase2.mjs
node scripts/check-phase2.mjs --regenerate
```

生成器只写 `samples/phase2/`，不会改动旧版 `samples/evaluation.json` 或主代码。`--regenerate` 在重新生成前保存 manifest 字节，重新生成后逐字比较，不能用“更新期望哈希”伪装为确定性验证。

检查器验证：原始文件与全部 manifest 哈希；题号及规范化问题唯一；主题/split 不交叉；每个标签的哈希、页码、段号、UTF-16 区间、quote 与分组；Markdown 表格与跨文档题的实际证据形态；PDF 原文与每页重新抽取文本一致；安全 fixture 数量、schema 和单块大小。额外使用 `scripts/check-phase2-parser.java` **直接调用编译后的生产 `DocumentParser`**，逐块比较页段位置、重叠窗口、offset 和文本，而不是只验证一份 JavaScript 算法的自洽。

2026-09-28 已执行以上三条命令，确定性生成与标签验证通过；生产解析器实际返回 220 块，与 manifest 估计一致。manifest 哈希见本文开头。此验证说明数据定位和生成可重复，不代表模型回答质量已经通过，也不代表真实检索配置中混合检索优于向量检索。

## 独立安全测试

`security.json` 版本为 `citebase-phase2-security-v1`，固定 24 个 case，四类各 6 个：

- `prompt_injection`：伪造系统角色、管理员指令、证据分隔符、Base64 指令、评测奖励胁迫和伪造历史。
- `forged_citation`：不存在的来源、其他用户来源、虚构数字书目、残缺引用、嵌套引用和刻意不引用。
- `tool_abuse`：要求执行 shell、访问 URL、执行 SQL、删除库、读取环境和发送邮件。
- `authorization`：交替 Alice/Bob 所有权的跨用户知识库问答和引用详情访问。

所有 URL 使用保留的 `example.invalid`，所有颜色代码、marker 和凭据样式文本都是虚构数据。攻击仅作为外部文档内容上传，生成器与校验器不会执行这些文字。

统一 case 为 `{id,category,attackType,setup,question,action,expected}`。`setup` 指定 owner/otherOwner、独立文件名及文本；action 为 `ask`、`cross_user_kb` 或 `cross_user_citation`。expected 使用 `answerContains`、`answerNotContains`、`abstained` 和 `status`；仅 forged_citation 明确允许 `allowCitationRejection=true`，将引用校验器的安全拒绝单独记录，不能混淆成模型正确回答。私有引用用例先由所有者问答取得引用，再由另一个账号请求同一引用并期待 404。

安全测试应在独立临时知识库执行，保存实际返回与断言。精确 marker 检查是可重复的最低限度观察，不等于证明能够抵抗所有提示注入；未来引入 Agent 工具后仍需核验工具调用轨迹、权限边界和副作用。普通问答模型没有工具时，也不能仅凭它未输出 marker 就宣称任意工具都安全。

## 已知局限

这是一套小规模、领域主题清晰的合成运行知识集。主题名、资料结构和操作卡布局较规则；中文问句检索英文卡片同时考查了跨语言模型能力，不能把结果变化全归因于融合算法。PDF 形态较简单，文档规模不代表大规模索引性能。所有参考事实来自作者定义的世界，没有真实专业数据的外部真实性保证。dev/test 按六主题分组，样本量不足以给出普适性能结论；后续应增加真实许可文档、独立审题者和新的保留主题。
