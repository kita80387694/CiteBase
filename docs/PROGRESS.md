# 开发进度

当前状态：2026-09-26全部MVP验收通过。以下保留开发时的失败与修复过程；最新状态以末尾最终验收为准。

## 阶段 1：环境与设计（历史记录，已完成）
- 工作区为空，无 AGENTS.md，无需迁移既有代码；已 git init。
- Java 25、Node 22.14.0、npm 10.9.2、Docker CLI 29.7.2 可用；Maven 未发现，Docker 引擎初始未启动。
- 未发现聊天/embedding API Key 环境变量（仅检查变量名）。
- 已读参考 README、1_to_4、5_to_9 notebook；commit 1fdb7d0e4f1d3e731c8397332452715512f18667。
- 参考仓库无 LICENSE；不复用代码，只借鉴索引/检索/生成及 RRF 思路。
- 下一步：并行实现后端领域与 RAG、前端；主 Agent 集成验证与环境准备。

## 阶段 2–4：实现及独立验证（2026-09-26）
- 完成Core/RAG/React代码、Flyway V1/V2、Compose、固定依赖、5份原创文档与58题评测集（另有安全样例）。详情见CORE.md、RAG.md、ARCHITECTURE.md。
- Java21 Temurin21.0.12.1+1下载并核验SHA256，Maven3.9.9。SpringBoot3.5.16+AI1.1.8兼容已核实。
- Docker Desktop因 `sailor-ingest.sock` inaccessible 崩溃，正常stop/start及保留socket重命名均未解决；没有恢复出厂、没有删除Docker数据。Compose config验证成功，pgvector镜像manifest存在；实际compose启动仍待验。
- 备用本地PostgreSQL17.6在127.0.0.1:55432启动，pgvector0.8.5（EDB匹配Windows构建，发布SHA256核验）。第一次Cybertec DLL ABI不匹配，已更换匹配EDB版本。工具位于.tools，均未纳入源码。
- 空数据库迁移成功。6项ExternalCoreIntegrationTest、4项ExternalRagIntegrationTest通过；包含并发删除、自动重试、恢复上限、部分评测对其他连接可见等实证。
- 2026-09-26 14:24 最终合并验证：34 tests，0失败、0错误、0跳过（解析+引用/指标+真实SpringAI HTTP异常协议+外部DB核心/RAG）。日志.tools/final-backend-tests.log；XML在backend/target/surefire-reports。
- 50条真实HTTP API断言通过，记录docs/results/api-mock.json；跨用户文档/任务/检索/引用/历史/评测/导出均拒绝。
- 前端生产构建通过，npm audit 0；Playwright真实后端完整UI流程1项通过(19.3s)，无mock响应拦截。截图docs/screenshots/01–06由主Agent逐一视觉检查。
- 浏览器最初空白由PowerShell参数透传将127.0.0.1误作Vite根目录导致，纠正npm run dev后已正常。
- mock 58题×2配置原始结果已保存。仅验证管线，不用于真实模型结论。

## 阶段 5：真实供应商与收尾（历史记录，后续更新已完成）
- 用户指定硅基流动和DeepSeek，并明确同意embedding使用BAAI/bge-m3（DeepSeek无embedding服务）。通过已登录控制台复用现有Key，本地临时loopback表单保存.env，未输出Key、未新建Key、未购买额度。
- /v1/models HTTP200确认deepseek-ai/DeepSeek-V3.2与BAAI/bge-m3可用；Spring AI真实模式在8081/独立citebase_real数据库启动。
- 已启动5文档真实索引与58题双模式评测。待完成真实问答/引用/安全用例、结果分析、配置复现及最终文档。
- Docker实际Compose启动仍是宿主环境阻塞，目标保持active。

### 14:34 更新：阻塞解除与真实安全通过
- 通过保留备份方式重命名两个仅包含IPC socket的运行目录，Docker Engine 29.7.2已启动。备份为 `%LOCALAPPDATA%/Docker/run.citebase-backup-20260926142723`、`run.citebase-backup-20260926142849` 及 `%LOCALAPPDATA%/docker-secrets-engine.citebase-backup-20260926142849`；未删除镜像、容器、volume或恢复出厂。
- Compose正在实际构建，使用15173/18080/15432隔离端口与MODEL_MODE=mock，避免影响运行中的真实评测。容器验收不再受引擎阻塞。
- 真实5份文档索引SUCCESS。安全验证33/33断言通过，真实API全流程51条通过；记录security-real.json/api-real.json。
- 评测中发现独占读锁导致问答等待；已改共享读锁/独占写锁，并在独立DB验证读读并发、删除在pg_locks等待（RAG测试5/5）。在途真实评测不打断，完成后更新应用。
- .env受gitignore保护；可分发文件密钥扫描0命中。

### 14:44 更新：真实对比与最终回归
- 真实58题×2配置116行全部完成，无服务错误。原始文件 `docs/results/real-05cd747f-259c-499b-b372-01289b6d1546.json` 保留原样。向量Recall@5=1、MRR=.990；混合Recall@5=1、MRR=.9667；默认向量，未声称混合更好或耗时差异具有统计意义。
- 每种配置8/8不可回答题拒答，58/58引用格式有效（含规范拒答），短答字面匹配49/50；answerCorrect仍未人工评分。
- 修复q049合法引用中讨论拒答措辞的误判。单独真实回归通过并保留 `docs/results/real-abstention-quote-regression.json`，未改116行历史统计。
- Java21最终完整核心套件36/36通过，0失败/错误/跳过，含实际Docker Testcontainers PostgreSQL17/pgvector0.8.2（核心6、RAG5）；随后默认供应商配置调整的引用/供应商回归22/22通过。日志 `.tools/final-docker-tests.log`、`.tools/final-provider-tests.log`。
- 前端生产构建通过；真实Playwright smoke 1项通过（12.6s），显式等待本次POST回答再验证，引用可点击，既有116行结果可见。主Agent亲自查看真实截图real-chat/real-evaluation。
- 两个本地应用已使用修复后的jar重启，Flyway发现schema=2无需重复迁移。Docker基础镜像下载完成，当前在容器内首次下载Maven依赖；待Compose健康检查、容器HTTP/UI链路及数据持久性验证。

## 最终验收（2026-09-26 14:51）
- Docker Compose从首次下载基础镜像、容器内Maven/npm构建、空volume的Flyway迁移到三服务启动实际通过；backend/db健康，frontend页面与API代理可用。再次构建包含最终引用校验及默认向量配置。
- 容器mock流程：重复seed两次、数据库和后端重启后再次seed，同一KB `a0b21681-09bc-4f8b-bcc3-f6acf4e98a4c` 始终5文档。50条HTTP断言通过（api-compose-mock.json），完整Playwright业务流程1项通过（16.1s）。
- 停止测试Compose并保留其volume `citebase_citebase-db`。将已验证真实数据库通过pg_dump复制到全新独立volume `citebase-real_citebase-db`（先确认空库，原库未修改），数据库为PostgreSQL17/pgvector0.8.2。原始116行评测导出与保留JSON深比较完全一致；这是复制已有真实结果，不宣称重新跑过整套116条。
- 最终真实容器Compose已运行：前端 http://localhost:15173，API18080，数据库15432。未提交.env设置对应端口及COMPOSE_PROJECT_NAME=citebase-real，聊天DeepSeek-V3.2、embedding BGE-M3。直接docker compose up --build -d可恢复。
- 在最终容器重新执行真实上传/索引/问答/引用/评测小闭环/导出及权限验证：52条API断言通过（api-compose-real.json）；原生运行记录51条保留为api-native-real.json。动态引用逐条验证导致计数不同，不以计数推断覆盖率。
- 容器真实Playwright 1项通过（9.2s）：等待本次生成、验证9081答案、内联引用与来源面板、116条既有结果。主Agent亲自检查最终容器页面及截图。六页mock截图和真实截图位于docs/screenshots。
- 全部核心后端36项0失败0跳过，Maven打包通过；前端构建通过，npm audit 0。机器可读验证记录：results/backend-verification.json、compose-services.json；本地详细日志位于.tools。
- 58题/50证据标签核验通过；源码无TODO/FIXME/未实现异常占位；105份可分发文件密钥扫描0命中，.env/.data/.tools均被忽略。未购买、未公开部署、未推送远程。
- 交付README、PLAN、ARCHITECTURE、REFERENCES、EVALUATION、PROGRESS、DEMO、RESUME及完整源代码。验收清单已逐项完成。无剩余MVP阻塞；保留明确产品边界：无OCR、单实例、精确检索适合小语料、真实效果仅自建小样本、答案语义未人工全量评分。
- 后续建议（非本次验收缺口）：更大且更贴近使用场景的人工标注语料、生产账号管理/速率限制、按质量需求决定ANN索引和任务租约；不把这些建议写作已有能力。
- 14:53最终文案修正：评测导入提示改为真实路径samples/evaluation.json。第一次重建因宿主CoreCLR内存分配失败未执行；停止已不用的本地mock Java/Vite后重建成功，三服务运行正常，实时浏览器确认修正已生效。最终入口以Docker 15173为准。
