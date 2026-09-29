# CiteBase · 知据

面向个人与小团队技术资料的知识库问答与检索评测平台。Java 21 / Spring Boot 3.5.16 / Spring AI 1.1.8 / PostgreSQL 17 + pgvector / React + TypeScript。

默认 **MOCK 流程演示**：可验证登录、权限、上传、索引任务、引用与评测页面，不代表真实语义检索或模型回答能力。真实模式通过 Spring AI 调用兼容接口；已完成硅基流动 DeepSeek-V3.2 + BGE 的58题双配置真实评测，原始结果及局限见 [评测报告](docs/EVALUATION.md)。

## 快速启动

前提：Docker Engine 已启动，Docker Compose v2；首次构建需要网络下载 Maven、npm 和容器镜像。首次约需数分钟，取决于网络。端口 5173、8080、5432 不被占用。不要将带固定演示账号的默认配置暴露公网。

```sh
cp .env.example .env
docker compose up --build
```

PowerShell 复制文件可用 `Copy-Item .env.example .env`（已有配置时保留，不要覆盖）。打开 http://localhost:5173 。端口冲突可在.env设置 WEB_PORT、API_PORT、DB_PORT。

| 账号 | 密码 |
| --- | --- |
| alice | Alice-demo-123! |
| bob | Bob-demo-123! |

Flyway 自动执行迁移，演示账号按用户名幂等创建，重启不会重置密码。持久数据保存在 Compose volume。`docker compose down` 停止容器且保留数据；不要加 `-v`，除非明确要删除所有本地数据。

安装 Node.js 22 后，在项目根目录执行以下命令创建知识库并幂等上传5份自建文档：

```sh
node scripts/seed-demo.mjs
node scripts/seed-demo.mjs --evaluate
```

第二条运行58题×2种配置，并把原始 JSON 保存在 `docs/results/`。也可直接在界面上传 `samples/documents/`，在评测页导入 `samples/evaluation.json`。这是自建虚构服务规范，内容与 CiteBase 本身配置不同。

本次已配置的工作区保留真实Docker演示：**http://localhost:15173**，API为18080，数据库15432；未提交的.env已设置端口、模型与项目名 `citebase-real`。直接 `docker compose up --build -d` 可恢复，无需覆盖.env或重新评测。全新下载仍按上方默认端口启动；已有真实116行结果可直接在评测页查看。

## 第二阶段开发入口与当前状态

第二阶段在专用分支 `feat/citebase-phase2` 开发，使用独立 Compose 项目 `citebase-phase2`：前端 **http://localhost:25173**、API **http://localhost:28080**、数据库端口25432。独立项目使用独立数据卷，不影响原演示15173及其数据；不要更改或覆盖原 `.env`。在当前分支的项目根目录，通过 PowerShell 临时覆盖端口即可启动，模型配置仍读取已有 `.env`：

```powershell
$phase2Ports = @{ WEB_PORT='25173'; API_PORT='28080'; DB_PORT='25432' }
$priorPorts = @{}
foreach ($name in $phase2Ports.Keys) {
  $priorPorts[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  [Environment]::SetEnvironmentVariable($name, $phase2Ports[$name], 'Process')
}
try {
  docker compose -p citebase-phase2 up --build -d
} finally {
  foreach ($name in $phase2Ports.Keys) {
    [Environment]::SetEnvironmentVariable($name, $priorPorts[$name], 'Process')
  }
}
```

阶段一已新增12份原创文档、156题评测集（按主题冻结dev/test）和24个独立安全用例，入口在 `samples/phase2/`。已实现严格标签导入、sourceHash与原文位置校验、同组可替代/跨组必需证据指标，以及逐题人工答案、引用支持和错误分类评分。评分追加保存依据、规则版本、用户与时间，未评分保持null，不覆盖自动原始结果。

**新增语料的真实双配置基线已完成312行，第二阶段整体尚未验收完成。** 后续检索优化、受控Agent、异步任务与多worker治理三项均未完成，须按 [阶段计划](docs/PHASE2_PLAN.md) 顺序推进。当前安全基线为 **20/24通过、4例失败**，四例均为有正确证据时过度拒答；不能改算全部通过。查看 [安全原始结果](docs/results/phase2/security-rag.json) 与 [失败分析](docs/results/phase2/security-analysis.md)。无工具RAG的安全结果不等于尚未实现的Agent工具边界已经通过。

检索优化的工程入口已接通：上传/更新可选择结构切分与长度、重叠参数；问答及评测可设置候选数、关键词权重、独立重排开关和引用格式。版本页保留实际切分配置，问答诊断展示检索阶段耗时及供应商实际用量。重排使用独立 `RERANK_BASE_URL`、`RERANK_API_KEY`、`RERANK_MODEL`、`RERANK_TIMEOUT_SECONDS`，不会更换 BGE embedding 或旧索引。协议及限制见 [检索接口](docs/API-CONTRACT-PHASE2-RETRIEVAL.md) 与 [切分说明](docs/CHUNKING.md)。开发子集消融已保存384条真实结果，全开发集确认及独立测试仍在进行；不能把这些子集结果当成最终效果结论。

真实实验需已配置有效模型密钥。以下为新实验的复现入口，会产生真实供应商调用；已有运行应恢复原label及部署清单，不重新生成运行时清单或重复创建收费评测：

```powershell
$env:CITEBASE_URL = 'http://localhost:28080'
# 仅首次：完成构建并冻结后端源码后，记录实际部署镜像与源码。
node scripts/capture-runtime.mjs citebase-phase2-backend .tools/phase2-runtime.json
node scripts/phase2-experiment.mjs --label stage1-reproduce --seed --run --split dev --runtime-manifest .tools/phase2-runtime.json
node scripts/summarize-phase2.mjs stage1-reproduce dev
```

脚本以每批8题保存提交状态和原始结果，重跑同一命令会核对既有服务端记录；断线后优先恢复已有评测，不能直接更换label重提。独立test需显式 `--split test`；本轮基线已封存，优化配置须先在dev冻结后再运行test，不用于选参。已完成的基线原始记录位于 [baseline](docs/results/phase2/baseline/) 和 [baseline-holdout](docs/results/phase2/baseline-holdout/)，运行状态与复现约束见 [实验记录](docs/EXPERIMENTS.md)。

## 真实模型

将 `.env` 的 `MODEL_MODE=real`，填写 `CHAT_API_KEY`、`CHAT_MODEL`、`CHAT_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`、`EMBEDDING_BASE_URL`。两个供应商可不同。Base URL 不带 `/v1`，SDK会追加 `/v1/chat/completions`、`/v1/embeddings`。`MODEL_TIMEOUT_SECONDS` 默认60。真实接口需有效密钥及可用额度，调用按供应商规则计费；项目不购买额度。

`.env.example` 预置硅基流动：`https://api.siliconflow.cn`、聊天 `deepseek-ai/DeepSeek-V3.2`、向量 `BAAI/bge-m3`。DeepSeek聊天模型不能调用embedding接口，因此经用户确认采用BGE；聊天仍全部使用DeepSeek。也可运行 `node scripts/configure-local.mjs`，通过一次性本地表单写入未存在的.env（仅127.0.0.1监听，完成自动关闭，不覆盖已有配置）。

```sh
docker compose up --build -d
node scripts/seed-demo.mjs --evaluate
```

切换模型后应新建知识库并重新上传文档（旧 embedding 按模型标识过滤，不会混用）。seed 默认复用同名知识库，切换模式时请在界面删除该演示知识库后重新运行，或使用不同账号。不存在自动将 mock 向量当作真实向量的路径。Key仅使用环境变量，不能写入源码、评测集或提交到 Git。

## 本地开发与验证

准备 Java 21、Maven 3.9.9、Node 22 和带 vector 扩展的 PostgreSQL；设置 `DB_URL`（默认 `jdbc:postgresql://localhost:5432/citebase`）、`DB_USER`、`DB_PASSWORD`。Shell 启动后端不会自动读取 `.env`，应通过系统环境注入。

```sh
docker compose up db -d
cd backend
mvn test
mvn spring-boot:run
```

另一个终端：

```sh
cd frontend
npm ci
npm run dev
npm run build
```

Testcontainers自动启动隔离 PostgreSQL。没有Docker时数据库测试标记为跳过，不能将其计为通过。可设置 `TEST_DB_URL`、`TEST_DB_USER`、`TEST_DB_PASSWORD` 后运行 `mvn -Dtest=ExternalCoreIntegrationTest test`；**仅使用专用测试数据库，该套测试会清空测试库知识库数据**。

完整核心测试命令为 `mvn "-Dtest=DocumentParserTest,RagUnitTest,ProviderContractTest,CoreIntegrationTest,RagIntegrationTest" test`。HTTP验证在项目根目录运行 `node scripts/verify-api.mjs`、`node scripts/verify-security.mjs`；通过 `CITEBASE_URL` 可选择后端地址。后者保留独立安全演示知识库。

端到端测试：前端目录执行 `npx playwright install chromium`，在应用已启动时执行 `npm run test:e2e -- tests/platform.spec.ts`。真实模型UI入口为设置 `E2E_REAL=1` 后运行 `npm run test:e2e -- tests/real-smoke.spec.ts`；`E2E_BASE_URL`选择前端地址，需先准备真实演示数据和已完成评测。测试使用实际后端，没有拦截为静态响应。

Windows本地启动可运行 `scripts/start-local.ps1` 自动读取.env（需先构建backend并准备数据库），支持 `-Mock`、`-Port`、`-DatabaseUrl`。Vite可通过 `API_TARGET` 指向另一后端；默认8080。

## 功能与边界

- 文本型PDF、Markdown、UTF-8 TXT，10MB以内；不做OCR。扫描PDF明确失败。
- 内容哈希去重、段落位置、版本记录、未变分块embedding复用、成功后原子切换；更新失败仍检索旧版本。
- 持久任务，总尝试最多3次；重启恢复中断任务，失败可手动重试最新版本。
- 用户在检索SQL内隔离；删除文档撤回引用，并清除所属知识库的问答/评测快照，避免历史内容泄露。
- 单查询向量检索、关键词+向量等权RRF（常数60），中文关键词为双字bigram，非语义分词；未实现多查询RAG Fusion。
- 引用编号必须来自本次检索，不将引用格式有效等同答案正确。无模型工具调用能力；文档作为不可信证据。
- 评测保存模型、数据版本、配置和逐题结果；支持追加人工答案正确性与引用支持评分，未人工评分保持null，不用LLM分数或引用存在替代正确性。
- 单实例模块化单体：恢复逻辑面向一个后端实例，不支持横向多实例worker。精确向量扫描适合MVP小规模语料，不宣称海量性能。

## 常见故障

- Docker API pipe不存在：先确认 Docker Desktop/Engine 可运行。Windows stale socket错误属于宿主Docker问题，不能靠更改应用解决；勿执行恢复出厂设置来保留已有数据。
- 数据库连接失败：检查端口、DB_URL、用户权限；须允许创建 vector 扩展。
- 文件FAILED：查看任务原因；验证UTF-8文本、PDF含文本、模型服务可达，再重试。
- 真实模型401/429/超时：检查Key、额度、模型名与Base URL；错误持久记录，token不可用显示不可用。
- 问答无结果：确认文档SUCCESS、当前embedding模型与索引模型一致。
- 评测长连接超时：先在界面查看运行状态；服务器逐题持久化，完成后 `node scripts/seed-demo.mjs --export-latest` 导出，不要直接重复提交评测。脚本评测超时30分钟，浏览器/Nginx同样支持长请求。

## 文档与参考

[架构](docs/ARCHITECTURE.md) · [计划](docs/PLAN.md) · [进度](docs/PROGRESS.md) · [评测](docs/EVALUATION.md) · [五分钟演示](docs/DEMO.md) · [简历素材](docs/RESUME.md)

设计参考 [langchain-ai/rag-from-scratch](https://github.com/langchain-ai/rag-from-scratch) 的索引、检索、生成及排名融合思路。保持Java核心实现，未复制其代码；参考提交、实际阅读文件及许可边界见 [REFERENCES](docs/REFERENCES.md)。样例语料为本项目原创，按CC0分发。

## 第二阶段：可选检索实验

保留默认legacy分块与向量问答。文档上传/更新的分块选项可选择`structure-v1`，查看版本可核对实际策略、长度与重叠。问答和评测的“检索设置”支持候选数量、关键词权重、专用重排和简短引用编号；设置会随结果保存。诊断面板展示检索阶段及实际用量，null表示供应商未提供。

专用重排需独立设置`RERANK_BASE_URL`（硅基流动为`https://api.siliconflow.cn`，不带`/v1`）、`RERANK_API_KEY`、`RERANK_MODEL=BAAI/bge-reranker-v2-m3`及`RERANK_TIMEOUT_SECONDS=10`。密钥放未跟踪的`.env`，不提交。关闭rerank不要求这些凭据；mock打开rerank会返回明确错误，以免误用真实服务。DeepSeek聊天和BGE-M3向量配置保持不变。

实验过程见docs/EXPERIMENTS.md与预登记plan.json。`scripts/phase2-optimize.mjs`仅用于专用测试库，依次执行seed、a、b1、b2、c、d、dev、freeze、test；须先保存刚构建镜像的runtime清单到`.tools/phase2-stage2-runtime.json`。它拒绝mock、保留原始失败结果并核对已提交批次，不盲目重复提交。真实调用会产生供应商计费，当前实验上限为700条新增生成结果、最多两个并发评测请求；这不是生产服务的全局配额。尚未执行或未通过的实验不能从此启动说明推断为已完成。
