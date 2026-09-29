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

## 第二阶段开始（2026-09-28）
- 当前工作区干净，基线1559a144e6a978a107e4584ddd6e773c4777d862；已创建feat/citebase-phase2，本地Git不支持switch，使用兼容checkout -b，未合并或推送。
- 重新运行当前基线：36项后端测试0失败0跳过（真实Testcontainers），前端生产构建通过。日志.tools/phase2-baseline-tests.log及phase2-baseline-frontend.log；历史结果未当成本次验证。
- 阶段一并行工作：原创扩充语料/稳定分组标签；严格导入与可审计评分；前端真实评分流程。主Agent负责集成、隔离运行环境和真实基线。
- 现有演示保持15173/18080/15432；第二阶段使用独立Compose项目citebase-phase2、端口25173/28080/25432，不清空现有数据。

### 阶段一实现冻结（2026-09-28 15:00）
- 新增12份CC0原创语料、156题（132可答/24不可答）、24独立安全用例；主题分组dev104/test52，200个精确证据标签，生产解析器220块。node scripts/check-phase2.mjs --regenerate通过，manifest 6273a8d9c172df402faa5dbfe1049dd11091bdb9d1aef57f0d6441a3c94fee14。
- 严格JSON/活动原文定位/证据组指标/可审计人工评分落地。后端46项0失败0错误0跳过，含真实Testcontainers；汇总防漏批2项通过。证据results/phase2/stage1-verification.json。
- 前端构建与扩展Mock API E2E通过（1 passed,15.2s）；评分追加两次、持久化、筛选空态、导出null未评分均验证。主Agent亲自查看评分及审计截图，路径screenshots/phase2-stage1-*.png；自动E2E评分明确不计真实人工评审。
- 原有演示未改动，独立数据库V3迁移成功。162份非忽略文件检查未发现当前配置密钥。真实新增语料基线与安全调用尚未执行，阶段一未验收完成。下一步冻结本地实现提交、独立服务切real、先冒烟再批量评测。

### 真实基线启动（2026-09-28 15:06）
- 实现提交90145a5dacd9aab40b9f484681e16cc67cdab9c5；运行镜像sha256:0d48f21551b50ac1c2a57abbaea2d90c091cecfe36e97d930301bfd50ad1ef52，运行清单保存源码摘要，独立Compose已健康启动real。12份文档真实BGE索引全部成功。
- 两题×两配置smoke四行保留于results/phase2/smoke：3行无错误，1行模型未知引用被代码拦截并拒答（COMPLETED_WITH_ERRORS），不是全通过。
- 冻结开发集与独立测试基线分别在baseline、baseline-holdout运行；测试集仅留原始输出，选参前不分析其错题。每8题落盘；安全24用例独立运行，已有过度拒答失败，保留原始断言不放宽。
- Git差异检查出现的PDF尾空格属于合法xref格式；新增.gitattributes标记二进制并固定数据字节，避免跨平台换行损坏PDF及manifest。源码与数据不改动。

- 验证记录采集修正：surefire目录存在上一阶段External*历史XML，首次收集误纳入两项历史suite；stage1-verification现仅保留本次命令指定7suite/46tests，日志原样，未删测试或排除失败。
- 第二阶段真实UI一次执行通过（1 passed,8.9s）：12文档、真实Harbor回答与点击引用、四行smoke含失败详情及导出。主Agent亲自查看phase2-real-citation/error-detail截图；未重试筛选成功。

- 阶段一发现指标缺陷：旧abstentionCorrect把错误导致拒答也记true。冻结真实运行不改，原始结果保留；派生摘要升级phase2-derived-v2，要求无error且引用有效的真实拒答才计正确，失败仍留分母并单列。新增风险单测通过，汇总共3项；后端字段口径待基线结束后修正。

- 拒答指标与NUL导入修复已通过25项实际JUnit/Testcontainers测试（0失败/跳过，.tools/phase2-metric-fix-test.log）。新结果标记metricDefinitionVersion，旧payload不重算；仍未部署到运行中的基线镜像。证明记录results/phase2/metric-fix-verification.json。

### 阶段一真实基线完成（2026-09-28）
- 全156题×2配置312行、20个唯一批次，SQL确认无重复创建。dev104题208行已汇总，test52题104行仅做完整性检查封存，不用于选参。所有错误与原始JSON保留。
- 开发集vector Recall@5=.901515/MRR=.853598，hybrid=.740530/.754735；错误9/104与11/104；聊天实际usage全覆盖，embedding usage不可用。未评分正确性仍null。详见EXPERIMENTS及results/phase2/baseline/summary-dev.json。
- 真实安全20/24通过，4次过度拒答失败未放宽断言；真实UI一次通过。阶段一实施与真实基线已具备验收证据，待最终分析入库后提交记录，下一步检索优化。

### 阶段二开始
- 阶段一全量结果与失败分析提交27ed749。独立test已封存，不用于选参。
- 根据dev分析并行实现结构切分/检索参数与专用reranker/可关闭短引用别名/对应UI；保持默认旧策略和模型。
- 已核实硅基流动官方rerank协议并用BAAI/bge-reranker-v2-m3真实调用一次，HTTP200，122 input tokens为供应商实际返回，output_tokens=0也如实保留；不是聊天模型评分。独立本地RERANK变量配置在忽略.env，未改原embedding。

### 2026-09-28 阶段二工程集成验证（未提交工作区）

- `.tools/phase2-stage2-integrated-tests.log`：指定 11 类 JUnit 共 71 次测试执行，失败 0、错误 0、跳过 0，15:51:46 +08:00 BUILD SUCCESS。仅收集本次指定 XML，排除旧 External 报告；继承核心用例的执行次数不等同独立风险数量。
- 重新运行三个 Node 测试文件：8 项通过，失败/跳过 0，日志 `.tools/phase2-stage2-node-tests.log`。
- 主 Agent 已执行真实数据库只读保留检查：baseline 20 批、20 个唯一名称、312 行；Flyway V1–V4 全部成功，文档版本任一切分参数为 NULL 的计数为 0。此项为主 Agent 实测报告，整理者未重复执行。
- 机器记录 `docs/results/phase2/stage2-verification.json` 含指定类计数、用例名、报告 SHA256、当前 HEAD、未提交 diff/status 与变更源码哈希。当前 HEAD 为 fb7fddaa1c72119444230d4b3d01f2adf000f6f3，但实际运行的是含未提交改动的工作区，不能把这些测试归因于该提交本身。
- 尚待主流程继续：阶段二真实控制变量实验、开发集选择与冻结后的独立集验证。上述工程测试不构成真实模型质量提升结论。本整理任务未部署、提交、切换分支或修改原始评测数据，完成后冻结本任务改动。

- 阶段二UI首轮暴露登录初始化期间新建按钮可点击的竞态，已加loading禁用并让E2E等待真实ready；失败日志保留。后续完整mock流程通过，最终再次通过1项（25.0s），覆盖配置/版本/引用/评测/导出/重排错误。主Agent亲自查看四张截图，纠正把执行错误标成普通证据不足的徽标，最终失败明确显示“执行失败·已停止回答”。mock结果不作为检索质量结论。
- V4迁移后逐行比对数据库存储与20批原始结果/配置，312行一致。GET导出额外附加的manualScore=null与POST原始结果表示不同；仅在比较副本中移除已验证为空的附加字段，原文件未改；过程记录results/phase2/stage2-migration-preservation.json，不读取holdout质量。

### 阶段二运行冻结与真实冒烟
- 实现本地提交da20d5193a5862d37ad03d3f39ddd51005d0a7f2，未推送；真实隔离Compose镜像ce29871312627ee4763dc0aa9ce0f403eb1c0db6351d705f7deb4dcce5063a70，运行摘要.tools/phase2-stage2-runtime.json。后端源码冻结，后续实验输出单独提交。
- 真实hybrid+独立BGE reranker+compact引用+引用访问通过，原始问答/usage见stage2-real-smoke.json。首次脚本把引用对象当ID访问而HTTP400；修复为cited.id，从问答历史按问题/模式/配置字段取回唯一结果（JSON对象顺序不能当配置差异），未重复模型调用。保留checkpoint和失败日志。
- 已开始6个隔离知识库的真实索引，原baseline知识库不修改。之后按A→B1→B2→C→D→全dev确认→冻结→独立test执行，最大2并发/700生成行。15项脚本风险测试通过，日志.tools/phase2-stage2-runner-tests.log。
- 已只读验证真实历史问答UI并亲自查看两张截图，展示reranker输入2730/输出0/总量null、embedding12/12、PDF第8页实际证据。浏览器拦截所有非登录写请求，未追加模型调用，证明记录stage2-real-readonly-ui.json。
- 首个A控制批次a-legacy900已完成32行，其中8行被引用校验拦截，完整rawAnswer保留。初看部分为供应商输出[id:UUID]而非约定[UUID]，另有实际ID不一致；不放宽校验、不重写原始结果。16题子集结果不能替代全dev结论，后续compact单变量对照将检验证据保持不变时格式错误是否减少。

### 阶段二 A：分块消融完成
- 六种配置各16题双模式，共192行真实结果；所有异常原样保留，报告逐variant摘要与raw逐题一致性校验通过。原文件optimization/a-*.raw.json，报告optimization/reports/optimization-report-2026-09-28T08-26-44-739Z.*。
- 按预登记Recall优先选择structure-v1 900/200。子集向量Recall均1.0；hybrid Recall按legacy900/structure900/600/1200/900-o0/900-o100分别为.714286/.928571/.892857/.892857/.857143/.892857。1200的MRR较高但Recall较低，未为追求好看的MRR改变规则。
- 结构900双模式聊天输入62056 tokens，legacy31871；更大上下文有明显代价，不称整体成本优化。未人工评分，生成错误和正常拒答分开。独立test仍未读取。
- 下一步B1候选10/20/40，再B2关键词权重.25/.5/1；自动顺序runner继续，后端冻结da20d51。

### 阶段二 B1：候选数量对比完成
- 新增k10/k40各32行，均完整保存。固定structure900/200，其余参数不变；k10的hybrid Recall=.964286，k40=1.0，控制k20=.928571，vector均1.0。
- 按预登记Recall优先选择k40，hybrid MRR=.811905（k10=.815476），没有为了略高MRR牺牲Recall。两组均无执行错误，但未人工判定语义正确性。
- B2继续只改变关键词权重；全部实验仍在开发集。

### 阶段二 B2：关键词权重对比完成
- .25与.5各32行真实结果完整、均无执行错误；固定structure900/200、candidate40。两种mode Recall均1.0，hybrid MRR分别.797619/.785714，控制权重1为.811905，故保留1。
- 结果没有支持降低关键词权重，原样保留，不通过选择别的样本制造收益。下一项仅开关专用reranker，仍使用同一开发子集。

### 2026-09-29 中断恢复（阶段二 C）
- 会话恢复时已确认原实验进程不存在，Docker Desktop 因遗留零字节 socket 重解析点无法启动。停止已退出的 Docker 后端后，仅将两个精确核实的 socket 目录可逆重命名备份并重建；未重置 Docker、删除容器/卷或清理演示数据。Docker 恢复后先启动隔离数据库，再封存持久结果。
- c-rerank 原运行 ff2cc8b1-9655-4712-a295-4669b081f3bf 保存25/32行；原始 RUNNING 快照见 optimization/c-rerank.interrupted.raw.json。随后启动冻结镜像 ce29871312627ee4763dc0aa9ce0f403eb1c0db6351d705f7deb4dcce5063a70，真实模式健康。旧服务启动恢复会将原运行标记失败，不改写其结果。
- 补齐脚本只对缺失7个题目/模式调用问答API，每次先持久化意图及历史ID，保存原始响应；中断后仅接受唯一新增历史记录，无法判定则停止。原25行不变，最终输出明确标为 composite-recovered-evaluation，不伪称单次服务端评测完成。
- 原第26条在途调用是否已计费不可知，用量记null并单列中断风险；不能视为0或普通答案错误。补齐前验证冻结源码、数据版本与参数。恢复/报告风险测试9项通过，真实补齐已启动；尚未完成C选择、D消融及独立测试。

### 阶段二 C：恢复与重排单变量对照完成
- 原25行+缺失7行真实调用构成32行显式恢复集合，c-rerank.raw.json引用8份原始来源及SHA；服务器原失败批次未改写。恢复风险测试6项、报告测试3项通过，352条累计结果逐字段指标重算全部通过。
- Recall均1，vector MRR从.892857升至.916667，hybrid从.811905升至.916667，满足预登记平均MRR阈值，选择开启重排。检索均值由359/325ms升至1089/1292ms；额外专用reranker输入分别91051/118362 tokens，返回completion为真实0、total不可用。中断时未知在途调用的用量不包含在上述已观察总量。
- 当前只是开发子集结果，没有人工正确性评分，不将端到端时延波动或0格式错误当成语义正确率。D引用别名单变量真实对照已启动。

### 阶段二 D：引用别名消融完成
- 32条真实配对完整。证据ID、顺序、正文、坐标、Recall/MRR均一致；24条供应商重排浮点分数变化单独列入compactComparison，没有隐去。两组执行错误均0，按预登记“错误减少才采纳”保留UUID引用，不把观察到的时延波动当别名收益。
- 剩余88道开发题的双模式确认已启动，复用所选16题的32行，最大2批并发；完整开发集确认后才冻结并解封独立测试。
- 报告新增显式组合恢复说明及测试；原服务器FAILED/25行的重启后快照也已封存。已扫描308个待交付文件，未发现本机API Key匹配。阶段二仍未最终验收。

- 消融及恢复证据本地提交：78491d6b8e44b339035b12fd5338161a29244786（384条、12配置）；后端实际运行仍冻结da20d51，未因报告提交更换镜像。全dev确认状态为运行中，未计作完成。

- 发现跨平台复现隐患：此前只冻结语料字节，其他机器若启用autocrlf，原始结果及后端源码SHA可能变化。现为backend、脚本与docs/results显式设置-text（保留文本diff，仅禁换行转换）；未改任何原始结果。逐一验证39份冻结后端源文件与da20d51 Git对象的SHA一致，恢复raw与已提交Git对象字节一致。该修复不改变运行后端或实验参数。

### 阶段二 E/F：完整开发集确认与冻结
- 所选16题复用32行，其余88题新增176行，完整104题双模式208行配对无遗漏。累计优化实验560行指标重算通过；模型/语料hash/runtime校验通过。完整开发集报告：optimization/reports/final-report-2026-09-29T05-36-01-417Z.json/md。
- 开发集vector/hybrid Recall均1，MRR均.965909；执行错误分别0/104、4/104。检索mean/P50/P95分别1088.62/988/1557ms、1094.30/1010/1513ms。全部人工答案/引用支持仍null。相较原基线聊天输入约翻倍并增加reranker调用；不宣称整体成本或生产性能优化。
- 2026-09-29T05:36:15.129Z 冻结structure900/200、candidate40、keywordWeight1、rerank=true、UUID引用。eligibleForRecommendation=true，但adoptAsDefault=false：小型自建语料与额外凭据不足以更改通用默认。final-configuration.json在读取独立测试效果前保存。
- 独立52题双模式测试已启动，参数不可因其结果调整。阶段二待完整测试及最终报告后验收；阶段三/四仍未实现。

- 完整开发集与最终配置已本地提交3a51d0a（独立测试尚运行，未因其结果修改配置）。未加入查询改写/多查询RAG Fusion：当前开发集选定检索已召回全部必需证据，没有依据继续叠加查询环节。现有hybrid只是单查询关键词+向量的加权RRF；后续Agent的受控补证据是单独模式，不能混称已实现多查询融合。

### 阶段二验收完成（2026-09-29）
- 30个配置/批次共664条真实优化实验结果完整，所有Recall/MRR等六字段重算通过。完整dev/test配对、模型标识/参数/内容hash/代码来源校验通过；没有使用test改参数。最终完整报告optimization/reports/final-report-2026-09-29T05-45-23-139Z.*，逐配置消融报告optimization-report-2026-09-29T05-45-24-495Z.*。
- 独立52题（44可答/8不可答）×2模式：原vector Recall=.965909/MRR=.892803、错误5；原hybrid Recall=.814394/MRR=.807576、错误3。优化两模式Recall/MRR均1、错误均0、正确拒答8/8；人工答案与引用支持未评分，不能称答案正确率100%。
- 优化检索mean/P50/P95 vector=1063.54/958/1635ms、hybrid=1147.27/1066/1568ms；端到端9262.23/6825/22888ms、9679.48/6646/22736ms。聊天输入85773/86319 tokens，另有reranker299675/365073输入；原基线聊天输入45456/47816，旧embedding用量未采集。额外成本与检索延迟明确增加，端到端波动不作因果提速结论。
- 工程验证沿用冻结源码的71次JUnit/Testcontainers、前端构建及mock/真实只读UI证据；新增恢复/指标/报告25+5脚本风险测试全部通过。源码39文件与冻结commit字节一致，autocrlf=true代表文件验证通过；恢复仍非产品异步治理，原FAILED批次保留。
- 阶段三现开始：core负责授权状态机/持久轨迹，task_audit负责Spring AI工具协议及有界生成，frontend_phase3负责真实接线UI。保持基础RAG，所有Agent能力待实现验证；阶段四仍未开始。
