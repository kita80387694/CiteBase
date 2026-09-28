# 切分策略与原文定位

`legacy` 是默认策略，保持此前按空行分段、900 UTF-16 单元窗口、200 单元重叠的行为。旧 `parse(source,type)` 不变，评测标签仍通过它重建原始段落，不依赖索引策略。

`structure-v1` 先识别 Markdown ATX 标题层级、空行分隔段落及首尾带管道符的表格行，再按目标长度贪心组织连续原文单元。同一块不跨标题分节或 PDF 页面；只有完整尾部单元在重叠预算内才重复，实际重叠可能小于配置。长段落按窗口回退，避免在 UTF-16 代理对中间截断；超出目标长度的表格行保持完整，单行超过 8000 单元则明确失败。不会重复合成表头，PDF 表格只保留提取出的文本，并不宣称识别版面表格。

标题层级保存为 `chunk.heading_path` 元数据，不拼到正文或 embedding 输入。块正文始终是规范化页面文本的精确子串，CRLF/CR 统一为 LF。位置为页内 UTF-16 `[startOffset,endOffset)`；`paragraph` 指块起始原始段落。PDF 页文本使用同一 PDFBox 提取器。结构方案不是完整 Markdown AST，当前仅识别 ATX 标题和带首尾管道符的行。

有精确 offset 的标签按文件名、可选原始文件 SHA256、页、范围及 quote 精确匹配，不再要求块起始 paragraph 等于标签 paragraph，因此跨段合并仍可评测。无 offset 的旧标签继续要求 paragraph 一致。未更改任何语料或原始评测结果。

## 上传 API

`POST /api/knowledge-bases/{kbId}/documents` multipart 除原有 `file`、可选 `documentId` 外，支持：

| 字段 | 默认 | 范围 |
|---|---|---|
| chunkStrategy | legacy | legacy / structure-v1 |
| chunkSize | 900 | 200–4000 UTF-16 单元 |
| chunkOverlap | 200 | 0–min(chunkSize/2,1000) |

默认值逐字段独立应用；size 小于 400 时应明确传入较小 overlap，否则校验失败，服务不静默改配置。更新已有文档仍须传 documentId；仅切换 profile 也会建立新版本。

`DocumentService.upload(user,kb,documentId,name,source,ChunkProfile)` 为新入口，旧入口使用默认配置。列表及单文档返回 `activeProfile: {strategy,size,overlap}`，尚无成功索引为 null。版本列表返回 `chunkStrategy`、`chunkSize`、`chunkOverlap`。配置属于每个版本，更新失败不会改变 activeProfile。

## 持久化与索引一致性

Flyway V4 为历史版本补 `legacy/900/200`，并增加数据库约束。重复上传判定使用原文件内容哈希和完整 profile；不同 profile 不能被误判为重复。新版本仍经过既有持久任务、有限重试和重启恢复路径，全部块成功后在知识库写锁下原子切换；旧可用索引在失败时保留。

向量复用要求同一文档、相同模型标识、相同内容哈希且实际正文完全相同。不同 profile 产生相同正文时可以复用，heading_path 不参与 embedding 输入。不把仅哈希相等视为文本相等。

## 验证与实验边界

`StructureChunkingTest` 检查精确原文、标题层级、表格行、整单元重叠、代理对安全、旧策略兼容、跨段标签与来源哈希。`ChunkingIntegrationTest` 在 Testcontainers PostgreSQL + pgvector 运行已有全部核心回归，并检查 profile 更新失败保旧、成功切换、配置去重和真实输入相同的向量复用。模型为明确 mock，仅验证工程行为，不能用于效果结论。

实验应创建独立知识库，以相同原文分别索引两种 profile；不得覆盖冻结基线知识库。结构策略是否改善召回，需要之后的开发集控制变量实验确认，此实现本身不证明质量收益。

2026-09-28 验证记录：首次运行 `DocumentParserTest,StructureChunkingTest,ChunkingIntegrationTest,Phase2EvaluationUnitTest,Phase2EvaluationIntegrationTest` 共 25 项通过、0 跳过。随后增加原文标签解析到跨段索引的实际数据库用例，重跑 `ChunkingIntegrationTest,StructureChunkingTest` 11 项通过、0 跳过，其中集成测试 8 项含原有 6 项核心回归。使用 Docker Testcontainers pgvector/pgvector:0.8.2-pg17，实际 PostgreSQL 17.10；全部 V1–V4 迁移成功。最后结果见 backend/target/surefire-reports（本地构建产物，不作为真实模型效果数据）。
