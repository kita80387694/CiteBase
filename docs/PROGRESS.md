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

### 阶段三实现与风险审查（进行中）
- 阶段二最终独立测试与报告本地提交761fc4c；之后才解除后端冻结并实现Agent。新增独立planner环境变量空值复用DeepSeek聊天配置，embedding保持原模型。
- Spring AI工具协议、禁止自动工具执行、有界生成及供应商异常测试已通过26项；实验采集脚本先支持dev冒烟，再显式冻结同一52题比较，真实Agent尚未调用。前端已实现真实接口接线并构建，尚待部署E2E，不宣称界面验收完成。
- 审查修复在途provider线程超时后过早释放执行额度的风险：外层及时返回超时，实际调用结束前保留执行容量。还补充失败partial checkpoint、审计query哈希脱敏、工具证据再次SQL鉴权与预算前验证。
- 核心最终17项数据库测试发现1例超时/中断竞态（EXECUTION_ERROR抢先覆盖TIMEOUT）；未弱化断言，正在修复重跑。首次独立MOCK构建可能包含修复前代码，明确不用于最终验收，修复后重建。

### 阶段三风险修复与界面验证
- 超时竞态已修复。创建/执行配置漂移、被截断输出、恶意文档诱导工具扩权、跨用户伪造引用、取消/来源变化安全用量和删除后晚到保护均加入测试。旧引用404不再令任务挂在RUNNING；同版本工具失效明确失败，版本变化优先SOURCE_CHANGED。最终核心23次执行全部通过（含继承旧RAG测试），日志 `.tools/phase3-core-tests-404.log`。
- 实际HTTP协议测试发现Spring AI将finish_reason规范化为大写，原小写比较失效；改为大小写兼容匹配后28项全部通过，保持严格OUTPUT_LIMIT与实际usage断言，未改变基础RAG路径。日志 `.tools/phase3-provider-outputlimit-fixed-tests.log`。
- 隔离citebase-phase3-mock环境Compose构建启动通过；前端build通过。实际后端Playwright场景1项通过，覆盖上传索引、持久创建/重载、显式执行、引用/导出、取消、预算失败、丢失创建响应后的同key恢复。主Agent与前端Agent均亲自查看成功/预算失败截图：`docs/screenshots/phase2-agent-mock-completed.png`、`phase2-agent-budget-failed.png`。MOCK显著标识，不用于真实效果结论。
- 实验脚本要求从实际服务响应封存完整planner/generation/检索公开配置，冻结前核验完整冒烟与runtime。采集/报告10项脚本测试通过。真实Agent尚未调用；整套后端回归进行中，阶段三仍未验收。

### 阶段三首轮真实冒烟（未通过，保留原始结果）
- 实现本地提交 `fc8367ef3aae34af1c3955120a25feb315d099ad`。整套JUnit执行119项，其中108通过、11个可选外部数据库入口因未设TEST_DB_URL跳过，不能计作通过；对应Testcontainers真实PG测试已执行。验证清单含每个类及源码hash：`docs/results/phase3/engineering-verification.json`。采集/报告新增严格题目/时间/config校验后13项Node测试通过。
- 真实隔离环境升级V5，52份评测payload、31份问答历史的数据库摘要以及109文档/1079分块数量完全一致；证据 `docs/results/phase3/migration-v5.json`。运行镜像与完整源码摘要见该文件runtime。
- 2道开发题×向量/混合共4次真实调用链均FAILED/NO_PROGRESS：DeepSeek连续要求inspectCitation同一句柄，循环保护按预期终止。保留完整步骤、证据、实际用量与失败原始文件于 `docs/results/phase3/smoke/`，分析见smoke-analysis.json。这批不是成功闭环，也不纳入最终测试对比。
- 仅针对开发观察改进工具说明：初始证据已验证、足够即finish、重复检查不会新增信息。下一版采用独立目录phase3-v2，不覆盖旧运行，不改循环断言；测试集尚未开始。

### 阶段三 v2 冒烟、真实界面与配置冻结
- v2提交 `8eb9a43bc41ce3e5a4efb2ff8b2bd26fece307e4`，受影响供应商测试29/29通过。4条真实开发冒烟全部COMPLETED，引用格式有效；单条耗时21–65秒，仍有不必要的inspectCitation额外成本，不称更快或语义准确率100%。完整原始记录位于 `docs/results/phase3-v2/smoke/`。
- 一条独立开发TopK1跨文档探针已保存：只取得一半必需证据，模型选择检查后结束，没有主动补齐另一份文档；不得宣传此案例证明补证据收益。原始回答和轨迹保留于development-probe，不计入正式测试指标。保持预算/策略，不为制造收益继续调参。
- 真实只读UI最终1项通过（5.4秒），核对答案、引用原文、配置、轨迹、实际用量及JSON导出；没有新增模型调用。主Agent亲自检查 `phase2-agent-real-{trace,citation,config}.png`，未发现遮挡/错误状态。未人工评审的答案正确性仍null。
- 已在读取Agent测试效果前冻结 `docs/results/phase3-v2/registration.json`，记录实际planner公开配置、模型、语料、源码、预算。随后执行相同固定52题×2模式；该集合此前用于阶段二，明确不是阶段三新未见测试集。阶段三尚待完整对照，阶段四未实施。

- 完整对照已启动（单进程采集、最大并发2，原始意图和run ID逐条持久化）。另以两个演示账号在真实后端执行9项Agent权限断言全部通过：跨用户读取/导出/列表/取消/执行/创建拒绝，伪造owner与预算升级拒绝，原结果保持不变；未触发额外模型调用。证据 `docs/results/phase3-v2/access-verification.json`，可复现脚本verify-agent-access.mjs。

### 阶段三工程封存与真实供应商阻塞
- 104/104原始执行记录已完整保存。vector完成19/52，hybrid完成18/52；共17预算耗尽、4无进展、46供应商错误。全部失败计入统计，未筛除或替换。全104轨迹审计0问题、44条用量不可用警告（不是超预算警告）。报告：`docs/results/phase3-v2/reports/comparison-1790664762368.json/md`。
- 单次8输出token健康诊断得到HTTP402/code30001，明确余额不足。历史PROVIDER_ERROR没有细分HTTP状态，不能逐条断言46条全是402；诊断与后半程集中失败一致。原始缺失证据导致两模式Recall/MRR=.590909，不能归因于Agent检索能力下降。人工正确性和引用支持仍null。
- 供应商可用前已经观察到不必要引用检查、预算/循环失败；没有补证据收益证据，基础RAG继续默认。工具约束与真实成功闭环已验证，但完整真实效果验收仍未完成，不能勾选阶段三最终验收。
- 已请求用户在平台恢复额度或本机配置可用同模型凭据，不购买、不无限重试。external-blocker.json列明46条外部故障待补测；原104与17+4条模型/策略失败必须保留，恢复后只另建受影响样本采集，不调参、不重跑成功样本。
- 已备份V5隔离实验数据库到忽略目录.tools，SHA及大小见backup-manifest.json；原phase2环境与冻结镜像保留，后续异步开发使用独立克隆数据库，避免旧worker与新租约代码共享运行。
- 按用户工作方式第8条，在额度阻塞期间开始可独立推进的阶段四工程与MOCK/真实PG治理验收；这不等于跳过或完成受阻的真实模型验收。共享核心/评测/UI接口已只读对齐，后端实验冻结现解除用于新阶段开发，原运行镜像不变。

### 阶段四实施中：异步适配与供应商恢复（2026-09-29）
- 用户恢复模型额度后，最小真实诊断返回HTTP 200，实际用量见 `docs/results/phase3-v2/provider-restored.json`。冻结的V5镜像保持不变；补测仅原46条PROVIDER_ERROR，注册和逐条结果保存在 `provider-recovery/`，原104条结果及预算/循环失败不改写。补测进行中，尚无最终结论。
- Task核心、INDEX staging、异步评测检查点、Agent异步入口和前端任务页第一轮代码已落，尚未集成验收。Agent移除启动全量恢复，执行必须绑定任务租约，结束结果通过fenced checkpoint与handler发布；未知中断不能重放。
- 评测适配方已运行真实Testcontainers PostgreSQL的7项异步评测风险测试，7通过/0跳过，日志 `.tools/phase4-eval-tests-2.log`：幂等、固定版本快照、取消、检查点恢复、旧fence拒绝、评分digest及有限供应商重试。完整回归与双进程证明仍待完成。
- 前端构建通过（index-CWg7XkW8.js），尚未对新后端执行E2E或视觉验收。
- 新增供应商固定错误码以区分余额/权限/限流/超时/不可用/异常响应；仅限流、超时和临时不可用允许重试。新增真实本地HTTP协议测试，尚待运行。
- 下一步：串行运行核心任务、供应商和Agent风险测试，修复集成问题；在独立V5数据库克隆上验证迁移；运行两个实际JVM+PostgreSQL故障harness，再完成新UI和真实闭环。

### 阶段三真实补测已完成；阶段四继续（2026-09-29）
- 46条冻结配置补测完整落盘，无供应商错误，轨迹静态审计46/46、0问题/0警告。组合52题×2配置有37次预算/无进展失败，未筛除；Agent无收益，不改基础RAG默认。详细结论和全部150次尝试成本覆盖见EXPERIMENTS及provider-recovery/report.json。
- 阶段四Agent/供应商风险回归53项通过、0跳过：`.tools/phase4-agent-provider-tests.log`。Task核心15项通过、0跳过：`.tools/phase4-core-tests.log`。这些是单测试进程的真实数据库验证，不等同双JVM崩溃恢复验收。
- 当前源码正在阶段四集成，不将恢复实验误关联为当前未提交代码；补测只使用注册内旧镜像和源码哈希。

### 阶段四集成审查与修复（2026-09-29）
- 独立V5克隆已成功升级V8。全部52个评测payload摘要、113个Agent结果/配置/快照摘要、109份文档active版本及1079个块计数保持一致；证据 `docs/results/phase4/migration-before.json` / `migration-after.json`。
- 首轮全量后端148次执行：137通过、11个外部数据库入口因TEST_DB_URL未设置跳过、0失败，日志phase4-full-tests.log；不将跳过计为通过。已另建专用25436测试库，准备补跑这些入口。
- 后续审查发现并修复Agent执行写未核对租约run/user/kb/kind、遗留无fence写路径、CREATED取消/入队竞态、崩溃恢复遗漏已返回usage四类问题。新增7项风险测试，最终Agent相关31项全部通过0跳过，日志phase4-agent-final-tests.log；此前含异步评测/迁移的39项回归也通过。
- 核心任务最终15项、核心业务6项及迁移1项通过；Node脚本51项通过0跳过。各轮测试源码时点不同，未伪称单一最终快照全量通过，工程摘要见engineering-checkpoint.json。
- 首次真实后端浏览器异步流程在最后kind筛选处失败，原因是部署缺最新kind过滤；原失败日志保留，源码已修，待重建复测。主要流程此前已执行但不将整条E2E计通过。
- 下一步：构建冻结阶段四源码、双JVM故障证明、最终浏览器流程/截图、独立真实异步闭环（包括取消后显式恢复），再核对交付。

### 最终验收汇总（2026-09-29；覆盖前述历史待办状态）
- 后端最终逐类矩阵为165项、0失败/0错误/0跳过，证据 docs/results/phase4/backend-verification.json。该矩阵合并全量与后续各类最近一次专项执行，不宣称一次 Maven 全量通过；早期11个环境跳过记录保留，随后以专用数据库实际补跑。配置收尾44项全部通过0跳过（.tools/phase4-config-final-tests.log），包括真实PG持久化Agent/Evaluation/item尝试预算以及旧任务预算不变。新增配置默认值未改变，未将旧真实闭环宣称为新配置再次实测。
- V5→V8迁移保留52份评测payload、113份Agent配置/结果、109份文档及1079块，前后摘要见 migration-before.json / migration-after.json。遗留RUNNING明确迁移中断，不假装自动成功。
- 两个实际JVM和真实PostgreSQL已通过有效租约不被新实例抢占、双实例独立领取、kill owner后仅恢复未完成题、过期活worker晚到结果拒绝、运行取消阻止下一题与晚到成功五项检查。原始状态、网关回执、日志与部分导出见 docs/results/phase4/two-process-1790667194773/report.json。模型为固定本地故障适配器并明确mock，只证明治理能力，不用于模型质量。
- 真实上传→索引→基础RAG→Agent→引用→异步评测→取消/恢复→导出完成，原始数据在 docs/results/phase4/real-smoke/，运行源码为 c3087c2 及记录内摘要。复查已有运行前后12条调用及各业务记录数量不变，replay-verification.json证明没有盲目重提付费运行。
- 最终界面验证5项mock、1项受控真实Java/PG故障流程、2项真实结果只读流程全部通过；真实只读检查新增供应商调用为0。前端构建通过，修复刷新竞态，已亲自检查登录、文档、问答引用、评分、任务、取消恢复、真实Agent与评测主要截图；清单和源码摘要见 docs/results/phase4/ui/verification.json。初次界面失败日志保留，不覆盖。
- 真实实验结论不变：阶段一312行、阶段二664行、阶段三原104+补测46条全部保留。检索优化改善冻结测试集召回但增加用量；Agent组合37/104预算或循环失败、耗时更高，保持基础RAG默认。未人工评审仍null，历史安全基线20/24不改写为全部通过。
- README、PLAN、架构、Agent、评测与演示当前状态已对齐；历史“进行中/未完成”段落保留为过程快照。最终本地提交、构建摘要、密钥扫描与工作区核验由主线程交付登记，不合并、不推送。

- 最终默认兼容配置已重新执行 Docker Compose build/up，服务健康；部署后真实保存结果只读浏览器2/2通过（8.3秒），没有重新创建模型任务。交付镜像、源码摘要、构建日志、44项配置回归日志与只读日志见 docs/results/phase4/delivery-verification.json 及 delivery-runtime.json。

- 最终实现与证据已本地提交 `ffb369cc06051917f7286b895c8860f5a22e4567`，其后工作区干净。相对原基线包含评测语料/原始实验、检索配置、Agent工具状态机、任务租约及完整界面；大量新增行来自原始JSON结果。后续只登记交付文档，无源码变化；未推送、未合并。

## 第三阶段启动（2026-09-30）
- 已读取完整用户附件，从干净 f4508e2 创建 feat/citebase-phase3；目标管理已建立新活动目标。
- 当前Docker仅见其他项目数据库；不会操作其他项目或沿用历史“服务正在运行”的结论。
- 基线 Maven test、前端 build 正在重新执行；盲评后端、界面、新数据集边界分工并行。当前没有真人评分，不能完成质量验收。

- 本阶段重新基线：Maven全量165执行154通过/11环境跳过；隔离git archive基线源码与专用PG25441补跑11全部通过，前端build通过。首次补跑被并行新增ReviewController尚未完成影响编译，原日志保留，隔离重跑成功；不删除失败证据。见docs/results/quality-phase3/baseline/。
- 代码审查发现ARCHITECTURE仍有MVP“启动恢复PROCESSING/单实例”现行描述，与现有V8实现矛盾，已更正为租约fencing，保留旧V5升级边界。

- 盲评工程首轮：17项JUnit/Testcontainers通过0跳过，12项数据/注册Node测试通过；MOCK双账号E2E2项通过，自动评分明确TEST_ONLY，真人计数仍0。发现并修复测试夹具历史任务选择问题；原失败日志保留。进一步静态审查正在补Agent来源去重、参考证据来源撤回和导出锁一致性。隔离服务quality-mock端口25181/28091/25442；真实新环境准备中，尚未付费采集或解封test。

- 盲评工程最终专项20项通过0跳过；后端补齐来源唯一、关联参考撤回、事务导出及按题主键复验。前端最终2/2通过10.6秒，构建bundle index-LBOxk-Q9.js；此处HUMAN接口由自动E2E填写的mock测试事件不计真人覆盖。正式quality-real库已建立两位独立reviewer账户，仅本机ignored凭据文件保存密码，尚未分配真实材料或提交评分。

### 真人依赖确认（2026-09-30）
用户明确回复“暂时无法安排，保留真人验收未完成”。正式真人覆盖仍0，不得将任何自动评分替代。继续完成真实配对材料以及不依赖真人结论的策略开关/风险测试/探索性实验和运维工程；不解封独立测试用于参数选择，不修改默认，不标记目标完成。工程提交a0d501e已本地保存，真实a0d501e镜像冻结采集，后续源码修改不能误标为基线运行版本。

- 真实基线注册已冻结 docs/results/quality-phase3/registration.json，运行a0d501e，独立quality-real25182/28092/25443。开发/验证8份文档索引成功；只选20+20题，其中8不可回答，40题×vectorRAG/原Agent为主配对；API产生的hybrid辅助行保留。两题冒烟完成（Agent一成功一BUDGET失败），引用实际GET校验通过，失败保留后继续同日志40题采集。任务调用审计另存tasks/，不重复收费。独立test未上传、未运行。
- Agent历史只读分析定位37次失败均发生于inspectCitation循环，0追加search/neighbors；详见AGENT_PHASE3_ANALYSIS。新显式策略工程实施中，原默认和冻结镜像不变，首次Java编译lambda捕获错误保留待修。当前未作真人质量选择。

2026-09-30 Agent 策略工程验证：修复 lambda 捕获编译错误和外部调用预算前瞻后，AgentStrategyUnitTest、AgentStrategyIntegrationTest、AgentInputTest、AgentTaskIntegrationTest、ProviderFailuresTest 共56项通过，0失败/0跳过。首次编译失败与第二次完整日志均保留于 docs/results/quality-phase3/engineering/agent-strategy-*.txt。隔离 quality-mock 已重建并健康，正在进行策略界面E2E；quality-real 保持a0d501e冻结运行。真人评审仍为未完成，未改变默认策略。

2026-09-30 策略UI专项和旧Agent关键回归2/2通过（33.6秒，无跳过），主线程查看组合策略截图，实验提示、预算、轨迹及MOCK标记清晰。验证记录：docs/results/quality-phase3/ui/agent-strategy-verification.json。独立真实探索环境quality-lab(API28093/UI25183/DB25444)已构建健康，尚未执行探索调用；当前未提交源码摘要与镜像保存在.tools/quality-agent-runtime.json，基线real环境未改变。

2026-09-30 40/40真实配对采集完成，80任务审计保存，完整工程报告和80回答/96任务的未评分评审包准备完成。真实项目ID22befaa8-e4b3-48d8-aa69-3e014dc5733b，真人0/80，复核0/16。修复报告缺少pair时遗漏单臂结果/用量、未审计误记0、同名项目来源未核对、旧裁决覆盖新评分等脚本缺陷，20Node测试通过。Agent工程提交4cbd61b49b423fb51d4e16e6e59b5061a8452fd8；原始UI日志因*.log忽略未入前提交，现保留等字节txt副本并修正验证清单链接，随下一提交纳入。

2026-09-30 基线包与采集/报告脚本提交e3540ae。评审并发修复：KB→item→assignment统一加锁，裁决记录reviewedScoreIds，撤销与批量导入使用相同有序锁。ReviewUnitTest+ReviewIntegrationTest 22/22通过（0失败/跳过，39秒），包括真实PG并发评分/裁决与撤销回归，日志engineering/review-race-tests.txt。冻结真实基线暂未部署此修复，待工程新环境集成；当前真人未评分。

2026-09-30 Agent32运行真实探索全部完成及32任务审计保存；四策略每8题失败1/2/0/1，stop-aware延迟增加，未选择默认。报告/脚本8项测试通过。成本实现专项实际执行AgentStrategyIntegration29+Unit9、AsyncEvaluation8、RetrievalCostIntegration15+Unit5=66，0失败/跳过。quality-mock构建健康，成本/Review UI回归进行中。独立quality-cost正在构建(API28094/UI25184/DB25445)，评测task/item重试均设1，以限制探索重复调用；原baseline/lab未重建。真人质量门槛和独立测试继续待办。

2026-10-01 恢复核验：昨日模型采集进程已终止（exec93516不存在），所有CiteBase容器停止。原cost实验fixed20/candidate5各8行成功，conditional5全部8行CONFIG_CHANGED，任务账本外部调用0；原始失败与部分报告保留。定位为retrievalCost.cache.ttlSeconds Long/Integer JSONB等价比较缺陷，修复并新增真漂移拒绝回归。当前50项集成验证49通过1失败（新增测试的调用计数断言0/2，定位中），不计整组通过。cost+Review UI历史3/3通过、26.8秒，证据由前端agent保存并披露源码摘要采集时间。下一步修复测试、建立新运行注册（旧容器重启导致缓存连续性已失效，不冒充续跑），执行真实成本对照和双worker负载。

2026-10-01 配置漂移回归修正：失败断言并非调用计数，而是误以为拒绝后应无结果；实际应保留两模式失败行。现严格验证2条CONFIG_CHANGED/attempts0、evaluation_attempt0及零模型调用，专项重跑1/1通过。运维首组其余49项通过。旧成本conditional任务账本0调用，已只读补齐。新cost-v2运行注册精确绑定新镜像/容器/StartedAt，fixed20/candidate5/conditional5/dedup各8行已成功，重复缓存对照继续。双worker首跑前9项通过，Agent崩溃处脚本预期错误；实际FAILED/UNSAFE_TO_RESUME、空答案与UNKNOWN generation符合既定恢复契约。修正为更完整的既定契约断言，第二次运行继续，原失败保留。运维UI2/2+有样本1/1通过，主线程已查看运行状态与缓存HIT截图；STARTED文案修正待最终部署复验。

2026-10-01 cost-v2全部64条真实探索结果完成，0执行失败；完整报告cost-v2-engineering-report.json，6份任务账本调用数24/24/16/24/48/32。重复缓存组8MISS+8HIT，每种embedding/rerank调用16→8，答案生成仍逐次执行。未进行真人质量判断，不更改默认。第二次双进程运行通过前11项，在删除文档后任务API404处停止；保留原始证据，正在核对撤回契约。启动全量后端回归，不能把进行中测试计作通过。

2026-10-01 最终回归：完整Maven267项中256通过/11环境条件跳过；专用旧PG补跑ExternalCore+ExternalRag 11/11通过、0跳过，合计267项实际通过。首次全量发现继承Testcontainers按类重启而Spring缓存旧连接；Stage2RetrievalIntegrationTest与TaskIntegrationTest加入AFTER_CLASS上下文关闭后全量通过，原失败日志保留。Node质量脚本46/46通过。前端构建及关键E2E6/6通过59.7秒，最终截图主线程检查运维/盲评/成本，明确MOCK流程测试不计真人评分。第三次双JVM实际故障矩阵前12项通过（含双worker删除后task/eval/export/citation404、缓存为空和DB无残留）；混合负载正在执行，尚不计运维全验收。密钥扫描1506文件零命中。

2026-10-01 本地提交：deea84e1909715a2202dcf586edff32851126440保存32次真实Agent探索；f93f2b90f30bad8238cfe1a479f61c950084cf76提交检索成本服务、配置兼容修复、风险测试及64条真实对照（含旧失败）。实验仍以注册中的源码摘要/镜像为准，提交只负责归档，不追溯修改原注册。尚有运维、前端、最终文档与证据未提交，未推送或合并。

2026-10-01 运维最终证据：two-process-1790834245097通过13项检查，4档闭环混合负载794测量操作、0失败；源码清单a9eb0ae89b552faf4b784af6c2f52e73de170a6e9a298e96fed386448f6ddc62。报告operations-engineering-report.json。并发1/2/4/8吞吐约1.67/3.51/4.97/5.07次每秒，P95 1053/993/1545/2904ms，4/8触及240操作上限，非满60秒。两JVM采样active max各1、PG连接max13，采样不等于严格峰值证明。完整raw日志/失败首两次保留。新增报告测试后Node全组51/51通过。

2026-10-01 完成实验后的真实评审环境升级：原V9库先保存本机忽略备份，无待执行任务（83SUCCEEDED/5FAILED）。docker compose up --build --wait完成V10，后台任务计数未改变；升级前后整个评审导出deepEqual，80答案/96分配/0评分完全一致。final-review-runtime.json记录新镜像/未提交源码摘要；原baseline注册/输出不改，不把新部署追溯作为原模型调用版本。入口http://localhost:25182可用，实际评分审计修复已部署。真人0/80、独立复核0/16，正式独立测试与非劣判断仍未完成。

2026-10-01 工程交接核验：324dfbe33157959a38d007ca5d3eea5e76da0c3b归档运维/前端/真实PG验证/最终文档，提交后git status为空；开发分支feat/citebase-phase3，基线f4508e2770d2e9340d13f7a7181d82b19a8c3304。相对基线733文件，主要新增体积为完整原始实验/故障输出。未合并、未推送；忽略区保留依赖、私有凭据与升级备份。扫描1558文件密钥0命中，源码diff-check通过；原始Maven/Compose输出自带尾空格，保留字节不篡改日志。第三次专用故障DB已停止但容器/卷保留，其余演示环境不删除。

所有当前不依赖真人的工程工作已完成，目标不能标记完成。剩余：80份实际真人初评、16份独立复核及争议处理；据此冻结策略/成本配置并运行新独立测试与真人质量非劣审查。用户已明确暂时无法安排，不再次请求同一输入、不提交自动评分替代、不消耗封存测试集。当前首次在工程完成后的交接中确认这一外部依赖是唯一推进阻塞，后续恢复先检查用户是否提供新的真人评审条件。

2026-10-01 用户调整要求：“改为依据辅助评审继续开发”。按ASSISTED_CONTINUATION.md恢复开发，真人门槛由明确标识的辅助评分替代，真人覆盖仍为0。原始用户新增辅助资料保持不改/不自动提交。辅助来源校验及唯一回答分析4项测试通过；RAG14错误拒答、Agent13错误拒答+5执行失败，错误拒答标注证据均已召回。新增2×2生成/工具策略实验预登记（8道固定开发验证题、32运行、先8次冒烟），不读独立测试输出、不放宽预算；新增collector与注册测试合计10项通过。后端与前端新策略实现进行中。

2026-10-01 两种独立生成策略工程完成：grounded-answer-v1（原工具）与combined-grounded-v1（组合工具）只追加生成提示，不改planner、预算及引用/权限校验；原4策略保留。后端专项46/46通过、provider契约16项运行通过，初次沙箱依赖失败日志保留；前端build通过；辅助实验脚本17/17通过。独立真实项目citebase-quality-assisted（API28096/UI25186/DB25447）健康，8份开发验证文档真实索引完成，32运行消融先执行8次冒烟。当前已出现2个组合策略NO_PROGRESS失败，完整保留，不因失败换题或放宽预算。源码/镜像/配置已注册，原评审环境和用户辅助资料未改动。

2026-10-01 生成策略工程提交27219a03eb78ed370256581be1476cae43cc3a5b，真实实验继续绑定登记时未提交源码摘要efe3b4cebd9bbf8f59eb3a60529d9f149aa17801aa594bfd9e767cf76becab33与镜像81e4ac41faac06963a6fea0c341edce525e19c30c99f0d5c8f4418aa900eb872，不追溯更改登记。8次冒烟已完成并复用，完整32次采集中（session37197，日志.tools/quality-assisted-agent-collect.log）。匿名评分汇总新增6测试通过，NA与执行失败/未评分别处理。UI旧回归2项通过，新测试修正CREATED阶段没有恢复按钮的测试契约后1项通过，原失败保留，历史截图哈希恢复；主线程已看新策略界面。未向HUMAN接口提交评分。

2026-10-01 辅助策略消融32/32真实运行结束，任务账本32/32保存；原策略2/8失败、grounded-answer-v1 1/8失败（INVALID_CITATION）、combined-v1 3/8失败、combined-grounded-v1 5/8失败（组合失败均NO_PROGRESS）。调用账本分别33/31/21/21次；不能把失败早退造成的低耗时当质量提升。匿名32回答分配39次AI辅助评分（7份双评），仅提供匿名材料，不读策略映射；未计作真人。独立采集入口fixture测试7项、评分汇总9项通过，正式独立题尚未读取。下一步完成辅助评审/分歧处理、按预登记选择并冻结配置。

2026-10-01 辅助评分量表澄清：correctness按端到端正确处理定义，正常完成的不可回答题正确拒答可为CORRECT；执行失败始终在端到端指标中计0，citationSupport在无引用时可NA。首次两名AI对该口径不一致（包括5份双评分歧和1份未双评正常拒答NA），初始评分与报告保留；要求相关评审生成版本化修订，不覆盖旧文件，不按策略身份修正分数。独立题仍封存，待口径一致和门槛通过再冻结。

2026-10-01 辅助消融与冻结配置本地提交3751e2868c597f1fd9a791de9115a0b7f50a745e，原用户assisted-review-20261001保持未跟踪且未改。候选grounded-answer-v1：辅助5/8对原4/8，失败1对2；小样本不能证实稳定提升，默认不变。独立新KB12文档已真实索引，2题冒烟4RAG+4Agent完成，剩余38题session91200采集中。独立采集脚本/依赖hash单独冻结，不再修改。完整Maven回归session98215并行执行隔离容器。主线程在25186亲自验证新策略说明、真实Brass回答和引用原文，截图grounded-real与grounded-real-citation已保存。辅助评分协议补充端到端正确拒答口径，未来独立评分使用同一规则。

2026-10-01 当前生产代码完整回归：Maven271项，260通过/11条件跳过；同一代码在专用PG25441补跑11/11通过、0跳过，271项均实际执行成功。辅助/独立Node脚本44/44通过。证据assisted-engineering/continuation-verification.json及完整输出，不用旧测试冒充。独立剩余RAG批次进度57/76、0失败（读取检查点，不重新提交）；完成后继续两Agent共80次。截图验证真实旧运行不增加模型调用。

2026-10-01 独立真实评测UI补验：IAB下载事件未返回，改用项目Playwright只读流程定位，不重提模型任务。首轮复用阶段四“恢复代次1”夹具失败；本次任务未恢复，服务端retryGeneration=0，新增场景改为同时断言API=0和UI=0。保留初次日志，修正后1/1通过（10.6秒）：真实JSON下载内容与API逐行deepEqual、无pending、快照引用原文可见、除登录外无写请求。截图quality-assisted-real-*保存。Agent独立对照43/80采集中，当前冻结参数不改。

2026-10-01 会话续执行时原工具session91200丢失；通过CIM确认node collector不在运行，服务器q030-selected/3e5c8ed1-b7f6-442c-bcf7-2456eee7e775已SUCCEEDED。未直接重提：使用原collect参数和冻结journal恢复（session39005，.tools/assisted-independent-resume.txt），既有raw/citations/audits验证后取回已完成项并继续。已保存66/80 Agent运行，collector-provenance与当前脚本逐字哈希一致。成本独立collector仅工程准备，5fixture测试通过，80任务/240行/40题聚类；未开始真实成本调用。冷热重复保留同evaluationId以遵守缓存授权边界，不改生产隔离键。

2026-10-01 Agent独立阶段完成：160/160真实回答、94任务审计、475返回调用/0UNKNOWN。两名隔离AI完成192辅助评分（160初评+32复核），五维无分歧；HUMAN仍0。向量/混合/原Agent/生成候选辅助正确23/21/19/21（各40），失败0/0/6/10。候选对原正确差+5个百分点、配对区间[-5,+15]，失败门槛不通过，默认不改；16失败均发生最终生成前，不归因生成提示。完整报告comparison-initial.json与ASSISTED_EXPERIMENTS保留负面结果及负载混杂。按顺序转成本阶段：复用原64开发行，匿名77次辅助评分开始；独立成本240行仅工程准备，尚未调用。

2026-10-01 成本阶段冻结：开发64回答77次AI评分完成且无双评分歧；独立选择者仅看开发材料，选conditional5（辅助6/8与固定及candidate5相同，外部调用3→2；与缓存归一化节约打平按检索延迟选）。没有启用缓存，独立重复流量不冒充HIT。冻结08:14:19Z、selection SHA c864edce…，独立KB12文档真实索引完成。collector新增容器身份/StartedAt连续性保护6测试通过。后台PowerShell PID35764运行smoke→collect，日志.tools/assisted-cost-*.txt与process.json；80任务/240行/40聚类有限预算，未完成不计通过。阶段本地提交6709b23归档Agent独立负面结论，用户assisted-review-20261001仍不改/不提交。

2026-10-10 恢复执行：上轮有实际进展（6709b23 Agent独立归档、6eb684d成本冻结与48条已采集），非仅等待。原采集PID35764不存在；Docker停机，现恢复原隔离库与同镜像后端。保留24任务48行，另ci-12-candidate任务5189ed55…恢复为FAILED，2行中vector成功/hybrid ATTEMPTS_EXHAUSTED，调用3RETURNED+1UNKNOWN。不把UNKNOWN当零成本、不重跑旧题；新增严格分段恢复脚本6fixture通过，尚未实际续采，跨9天耗时不当连续实验。原用户辅助目录仍不改。

背压验收补齐：非终态任务全局/用户PG事务准入、enqueue与手动retry共用容量；幂等重放不被满额阻止；同步问答/诊断每JVM semaphore快速429带Retry-After，前端手动重试提示不自动重提。真实PG专项8/8无跳过通过；两个实际Java进程开放环24到达、8请求/秒的5组检查通过，证据admission/two-process-1791637121457。首跑B文档与A内容相同触发正确哈希去重导致夹具未改变源、409断言失败，修复唯一内容及实际snapshot变化断言后通过；另保留专用端口占用失败，不删除容器/数据掩盖。前端build通过（初次沙箱EPERM保留）；完整JUnit和Compose旧mock库升级正在进行，不提前计通过。

2026-10-10 回归结果：完整JUnit279项268通过/11环境条件跳过，专用PG补跑11/11通过0跳过，279项均实际执行。前端构建通过，新429 UI E2E1/1通过8.7s（mock API场景验证交互，不替代真实PG限流测试），主线程亲自查看quality-admission-429-20261010.png。恢复/分段报告/过载fixture共20通过。新Compose up --build两次均因Docker Hub auth.docker.io IPv6连接超时失败；未改依赖、网络设置或伪称新镜像验证完成。已有真实/旧mock容器可启动，最新前端临时25187连旧mock后端验证，区别新Compose未通过。

独立成本分段续采已启动PID77068，日志.tools/assisted-cost-recover-20261010.txt及exit.json；原始48行与中断2行保留，当前runtime只允许StartedAt变动，源/镜像/模型/端口及非缓存配置冻结。旧state原字节保留，恢复状态另存manifest/recovery-state。采集仍未完成，不计质量或成本验收通过。

2026-10-10 后续审计：分段成本报告增加run.taskId到账本的控制/候选归属、索引单列、mode/phase计划与缺失分母、rerank模型冻结来源；10合成测试通过。阶段审计矩阵PHASE3_ACCEPTANCE.md新增，PHASE3_PLAN统一为当前授权口径，未将历史真人阻塞或旧测试冒充当前完成。官方ECR同版本node镜像拉取也匿名token超时；原日志保留且已请求恢复镜像网络，无系统DNS/代理修改。成本PID77068已核实活跃并推进至ci-20-candidate（至少84/240行），尚未形成最终质量/成本结论。

2026-10-19 恢复检查：上一轮新增summary实现与测试、README/简历验证口径更新，属于实际进展；本轮确认原PID77068已不存在，Docker引擎可用但原真实容器已退出。只启动原容器，未重建、未更改模型或冻结配置。152条原始结果已保存；ci-29-candidate任务99f3c0ce-804f-41b6-a475-fd382687c2fa在恢复后FAILED，导出保留4行（3成功检查点、1 ATTEMPTS_EXHAUSTED）及7 RETURNED+1 UNKNOWN调用。新导出在assisted-cost-recovery-20261019，旧恢复manifest及原始结果不覆盖。需要追加第三运行时段并验证恢复链后才能续采，不能直接重复运行旧恢复脚本。

成本总结脚本主线程重跑7/7通过，正常正确拒答的citationSupport=NA按已登记协议视为不适用，其他不可评估情况仍保持未知；按预登记比较总失败，同时披露逐对新增/恢复失败，不隐藏抵消。新版Compose在原隔离mock项目重新构建验证中；真实评测容器保持原镜像。尚未完成成本独立采集和辅助评分，不标记目标完成。
