import { test, expect } from "@playwright/test";

test("拒绝错误登录；从空知识库到索引、引用和评测的真实 UI 闭环", async ({
  page,
}) => {
  const stamp = Date.now();
  const kbName = `E2E-${stamp}`;
  const documentName = `e2e-guide-${stamp}.txt`;
  const evidence =
    "CiteBase 使用内容哈希检测重复文档。索引更新失败时保留上一份可用索引，成功后切换版本。";
  const evaluationName = `E2E 检索对比 ${stamp}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "登录工作空间" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/screenshots/01-login.png",
    fullPage: true,
  });
  await page.getByLabel("密码", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "登录工作空间" }),
  ).toBeVisible();
  await page.getByLabel("密码", { exact: true }).fill("Alice-demo-123!");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(
    page.getByRole("heading", { name: "知识库", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("MOCK · 流程演示", { exact: true }),
  ).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept(kbName));
  await page.getByRole("button", { name: "新建知识库" }).click();
  await expect(page.locator("#knowledge-base option:checked")).toHaveText(
    kbName,
  );
  await expect(page.getByRole("heading", { name: "还没有文档" })).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({
    name: documentName,
    mimeType: "text/plain",
    buffer: Buffer.from(evidence),
  });
  const docRow = page.getByRole("row").filter({ hasText: documentName });
  await expect(docRow).toBeVisible();
  await expect(docRow.getByText("成功", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.screenshot({
    path: "test-results/screenshots/02-documents.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "处理任务", exact: true }).click();
  const task = page.locator(".task").filter({ hasText: documentName });
  await expect(task).toBeVisible();
  await expect(task.getByText("任务完成", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/screenshots/03-tasks.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "从一个好问题开始" }),
  ).toBeVisible();
  await page
    .getByLabel("你想了解什么？")
    .fill("CiteBase 索引更新失败时如何处理？");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  const answer = page.locator(".answer-card").first();
  await expect(answer).toContainText("上一份可用索引");
  await expect(answer).toContainText("引用格式 有效");
  await expect(answer.locator(".answer-text")).not.toContainText(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  await answer.locator(".inline-citation").first().click();
  await expect(page.locator(".drawer .source-text")).toContainText(evidence);
  await expect(page.locator(".drawer")).toContainText(documentName);
  await page.screenshot({
    path: "test-results/screenshots/04-chat-evidence.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭证据" }).click();

  await page.getByRole("button", { name: "检索评测", exact: true }).click();
  await page.getByLabel("评测名称").fill(evaluationName);
  const dataset = {
    version: `e2e-${stamp}`,
    questions: [
      {
        id: "update",
        question: "CiteBase 索引更新失败时如何处理？",
        answerable: true,
        expectedAnswer: "保留上一份可用索引",
        category: "lifecycle",
        split: "test",
        group: "index-updates",
        topic: "indexing",
        evidence: [
          {
            documentName,
            page: 1,
            paragraph: 1,
            quote: "索引更新失败时保留上一份可用索引",
            groupId: "availability",
          },
        ],
      },
      {
        id: "unknown",
        question: "火星天气怎样？",
        answerable: false,
        expectedAnswer: null,
        category: "unanswerable",
        split: "test",
        evidence: [],
      },
    ],
  };
  const beforeRuns = await page.locator(".run-row").count();
  await page.getByLabel("导入评测集 JSON").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await page.getByRole("button", { name: "运行向量 / 混合对比" }).click();
  await expect(page.getByRole("alert")).toContainText("不是有效 JSON");
  await expect(page.locator(".run-row")).toHaveCount(beforeRuns);
  await page.getByLabel("导入评测集 JSON").setInputFiles({
    name: "unknown-field.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ ...dataset, unsupportedClientField: true }),
    ),
  });
  const rejectedImport = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/evaluations") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "运行向量 / 混合对比" }).click();
  expect((await rejectedImport).status()).toBe(400);
  await expect(page.getByRole("alert")).toContainText("unsupportedClientField");
  await expect(page.locator(".run-row")).toHaveCount(beforeRuns);
  await page.getByLabel("导入评测集 JSON").setInputFiles({
    name: "evaluation.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(dataset)),
  });
  await page.getByRole("button", { name: "运行向量 / 混合对比" }).click();
  await expect(page.locator(".results h2")).toHaveText(evaluationName, {
    timeout: 90_000,
  });
  await expect(page.locator(".evaluation-task-status .badge")).toHaveText(
    "成功",
    { timeout: 90_000 },
  );
  await expect(page.locator(".results")).toContainText("混合检索 · RRF");
  await expect(page.locator(".results")).toContainText("向量检索");
  await expect(
    page.locator(".results tbody").first().getByRole("row"),
  ).toHaveCount(2);
  await expect(
    page.locator(".results tbody").last().getByRole("row"),
  ).toHaveCount(4);
  await page.locator(".results").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/screenshots/05-evaluation.png",
    fullPage: false,
  });
  await page
    .getByRole("button", {
      name: "CiteBase 索引更新失败时如何处理？",
      exact: true,
    })
    .first()
    .click();
  await expect(page.locator(".drawer.wide")).toContainText("预期答案");
  await expect(page.locator(".drawer.wide")).toContainText("实际回答");
  await expect(page.locator(".drawer.wide")).toContainText(documentName);
  await expect(page.locator(".case-tags")).toContainText("lifecycle");
  await expect(page.locator(".case-tags")).toContainText("test");
  await expect(page.locator(".evidence-group")).toContainText("availability");
  await expect(page.locator(".review-metrics")).toContainText("未评分");
  await expect(page.locator(".review-metrics")).toContainText("未评估");
  await page.getByLabel("人工答案正确性").selectOption("true");
  await page.getByLabel("人工引用支持", { exact: true }).selectOption("true");
  await page
    .getByLabel("评分依据")
    .fill(
      "自动 E2E 模拟交互，仅验证评分存储，不计真实人工评审。证据说明保留上一份可用索引。",
    );
  await page.getByLabel("评分规则版本").fill("e2e-human-v1");
  const savedScore = page.waitForResponse(
    (response) =>
      response.url().endsWith("/scores") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存人工评分", exact: true }).click();
  const firstScore = await (await savedScore).json();
  expect(firstScore.source).toBe("human");
  expect(firstScore.scoredBy).toBeTruthy();
  expect(firstScore.scoredAt).toBeTruthy();
  await expect(page.locator(".score-form")).toContainText("人工评分已保存");
  await expect(page.locator(".score-history")).toContainText("e2e-human-v1");
  await expect(page.locator(".review-metrics")).toContainText("未评分");
  await page.getByLabel("人工答案正确性").selectOption("false");
  await page.getByLabel("人工引用支持", { exact: true }).selectOption("false");
  await page.getByLabel("答案与证据矛盾", { exact: true }).check();
  await page
    .getByLabel("评分依据")
    .fill(
      "自动 E2E 模拟交互：第二条评分验证审计追加，不计真实人工评审或模型效果结论。",
    );
  await page.getByLabel("评分规则版本").fill("e2e-human-v2");
  await page.getByRole("button", { name: "保存人工评分", exact: true }).click();
  await expect(page.locator(".score-history article")).toHaveCount(2);
  await expect(page.locator(".score-history")).toContainText("答案与证据矛盾");
  await page
    .locator(".score-form")
    .evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: "test-results/screenshots/06-evaluation-detail.png",
    fullPage: false,
  });
  await page
    .locator(".score-history")
    .evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: "test-results/screenshots/07-score-audit.png",
  });
  await page.getByRole("button", { name: "关闭问题详情" }).click();
  await page.locator(".run-row").filter({ hasText: evaluationName }).click();
  await expect(page.locator(".question-results")).toContainText("人工：错误");
  await page.getByLabel("错误与评分筛选").selectOption("contradiction");
  await expect(page.locator(".question-results tbody tr")).toHaveCount(1);
  await page.getByLabel("题型筛选").selectOption("unanswerable");
  await expect(
    page.getByText("没有符合筛选条件的问题。可调整筛选后重试。"),
  ).toBeVisible();
  await page.getByLabel("题型筛选").selectOption("");
  await page.getByLabel("错误与评分筛选").selectOption("");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^citebase-.*\.json$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.status).toBe("SUCCEEDED");
  expect(exported.partial).toBe(false);
  expect(exported.taskId).toBe(exported.id);
  expect(exported.results).toHaveLength(4);
  expect(exported.config.dataset.version).toBe(dataset.version);
  expect(exported.summary.vector.count).toBe(2);
  expect(exported.summary.hybrid.count).toBe(2);
  expect(exported.manualScores).toHaveLength(2);
  expect(
    exported.results.every(
      (result: { answerCorrect: unknown }) => result.answerCorrect === null,
    ),
  ).toBe(true);
  const scored = exported.results.find(
    (result: { manualScore: unknown }) => !!result.manualScore,
  );
  expect(scored.manualScore.answerCorrect).toBe(false);
  expect(scored.manualScore.citationSupported).toBe(false);
  expect(scored.manualScore.errorCategories).toEqual(["contradiction"]);
  expect(exported.breakdowns.category.lifecycle.vector.count).toBe(1);
  expect(errors).toEqual([]);

  // Only delete this test's own uniquely named knowledge base.
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await expect(page.locator("#knowledge-base option:checked")).toHaveText(
    kbName,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除知识库", exact: true }).click();
  await expect(page.locator("#knowledge-base")).not.toContainText(kbName);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
