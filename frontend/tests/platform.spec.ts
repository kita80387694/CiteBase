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
    path: "../docs/screenshots/01-login.png",
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
    path: "../docs/screenshots/02-documents.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "处理任务", exact: true }).click();
  const task = page.locator(".task").filter({ hasText: documentName });
  await expect(task).toBeVisible();
  await expect(task.getByText("成功", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "../docs/screenshots/03-tasks.png",
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
    path: "../docs/screenshots/04-chat-evidence.png",
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
        evidence: [
          {
            documentName,
            page: 1,
            paragraph: 1,
            quote: "索引更新失败时保留上一份可用索引",
          },
        ],
      },
      {
        id: "unknown",
        question: "火星天气怎样？",
        answerable: false,
        expectedAnswer: null,
        evidence: [],
      },
    ],
  };
  await page.getByLabel("导入评测集 JSON").setInputFiles({
    name: "evaluation.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(dataset)),
  });
  await page.getByRole("button", { name: "运行向量 / 混合对比" }).click();
  await expect(page.locator(".results h2")).toHaveText(evaluationName, {
    timeout: 90_000,
  });
  await expect(page.locator(".results")).toContainText("混合检索 · RRF");
  await expect(page.locator(".results")).toContainText("向量检索");
  await expect(
    page.locator(".results tbody").first().getByRole("row"),
  ).toHaveCount(2);
  await expect(
    page.locator(".results tbody").last().getByRole("row"),
  ).toHaveCount(4);
  await page.screenshot({
    path: "../docs/screenshots/05-evaluation.png",
    fullPage: true,
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
  await page.screenshot({
    path: "../docs/screenshots/06-evaluation-detail.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭问题详情" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^citebase-.*\.json$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.status).toBe("COMPLETED");
  expect(exported.results).toHaveLength(4);
  expect(exported.config.dataset.version).toBe(dataset.version);
  expect(exported.summary.vector.count).toBe(2);
  expect(exported.summary.hybrid.count).toBe(2);
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
