# 浏览器端到端验证

此测试连接真实运行的前后端和数据库，不拦截或伪造任何 API 响应。测试要求后端使用明确标识的 `mock` 模式；它验证业务闭环，不证明真实模型质量。

先按照项目 README 启动数据库、后端 `localhost:8080` 和前端 `localhost:5173`，然后在 `frontend/` 执行：

```powershell
npm ci
npx playwright install chromium
npm run test:e2e
```

可通过 `E2E_BASE_URL` 指向另一个本地前端地址。首次浏览器下载需要联网。测试使用 Alice 演示账号，新建唯一名称知识库，成功结束时仅删除该测试自建的知识库；已有演示数据不会被删除。失败时保留自建数据便于排查。

测试覆盖错误登录、空状态、文件上传和后台索引、任务状态、问答和证据面板、导入两题评测、向量与混合两种配置、逐题详情、导出 JSON 内容与浏览器运行时异常检查。六张真实界面截图保存至 `docs/screenshots/`；失败追踪保存在 `frontend/test-results/`。

## 真实模型界面验证

Vite 可通过环境变量 `API_TARGET` 代理另一个后端（默认 `http://localhost:8080`）。例如在 PowerShell 中：

```powershell
$env:API_TARGET='http://localhost:8081'
node node_modules/vite/bin/vite.js --port 5175
```

真实模型 smoke 默认跳过。先为真实后端准备自建手册演示知识库，并等待正在运行的评测结束，再显式执行（会新增一次真实问答，使用已配置的供应商）：

```powershell
$env:E2E_BASE_URL='http://localhost:5175'
$env:E2E_REAL='1'
node node_modules/@playwright/test/cli.js test tests/real-smoke.spec.ts
```

真实 smoke 不创建新评测，检查真实模式、已就绪的索引、本次问答响应和答案中的可点击来源引用，并读取既有的 `real 自建手册对比` 评测（58 题、116 条结果）。运行前须先完成该评测。截图保存为 `docs/screenshots/real-chat.png` 与 `real-evaluation.png`。请勿与长时间占用同一知识库的评测并行执行。
