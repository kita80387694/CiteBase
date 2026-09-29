import { test, expect } from "@playwright/test";

test("阶段二 Mock：切分版本、可配检索、紧凑引用与真实诊断导出", async ({
  page,
}, testInfo) => {
  const stamp = Date.now(),
    kbName = `Stage2-E2E-${stamp}`,
    documentName = `stage2-index-${stamp}.md`,
    runName = `Stage2配置对比-${stamp}`;
  const text =
    "# 索引手册\n\nCiteBase 索引更新失败时保留上一份可用索引，成功后切换新版本。\n\n## 权限\n\nCiteBase 的知识库只允许拥有者读取，引用同样校验归属。";
  const file = {
    name: documentName,
    mimeType: "text/markdown",
    buffer: Buffer.from(text),
  };
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.locator(".mode")).toContainText("MOCK");
  await expect(
    page.getByRole("button", { name: "刷新数据", exact: true }),
  ).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept(kbName));
  await page.getByRole("button", { name: "新建知识库" }).click();
  await expect(page.locator("#knowledge-base option:checked")).toHaveText(
    kbName,
  );
  await page.locator(".chunk-controls summary").click();
  await page
    .getByLabel("切分策略", { exact: true })
    .selectOption("structure-v1");
  await page.getByLabel("分块大小", { exact: true }).fill("200");
  await page.getByLabel("重叠大小", { exact: true }).fill("200");
  await page.locator("input[type=file]").setInputFiles(file);
  await expect(page.getByRole("alert")).toContainText("不能超过分块大小的一半");
  await expect(page.getByRole("heading", { name: "还没有文档" })).toBeVisible();
  await page.getByLabel("分块大小", { exact: true }).fill("300");
  await page.getByLabel("重叠大小", { exact: true }).fill("50");
  await page.locator("input[type=file]").setInputFiles(file);
  const row = page.getByRole("row").filter({ hasText: documentName });
  await expect(row.getByText("成功", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(row).toContainText("structure-v1 · 300 / 50");
  await row.getByRole("button", { name: "版本", exact: true }).click();
  await expect(page.locator(".version-card")).toHaveCount(1);
  await expect(page.locator(".version-card")).toContainText("structure-v1");
  await page.screenshot({
    path: "../docs/screenshots/phase2-stage2-structure-version.png",
  });
  await page.getByRole("button", { name: "关闭文档版本" }).click();
  await page.getByLabel("切分策略", { exact: true }).selectOption("legacy");
  await page.getByLabel("分块大小", { exact: true }).fill("900");
  await page.getByLabel("重叠大小", { exact: true }).fill("200");
  await row.locator("input[type=file]").setInputFiles(file);
  await expect(row).toContainText("legacy · 900 / 200", { timeout: 60_000 });
  await row.getByRole("button", { name: "版本", exact: true }).click();
  await expect(page.locator(".version-card")).toHaveCount(2);
  await expect(
    page.locator(".version-card").filter({ hasText: "当前可用版本" }),
  ).toContainText("legacy");
  await page.getByRole("button", { name: "关闭文档版本" }).click();

  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await page.locator(".retrieval-controls summary").click();
  await page.getByLabel("候选数 candidateK", { exact: true }).fill("12");
  await page.getByLabel("关键词权重", { exact: true }).fill("0.5");
  await page
    .getByLabel("引用格式选项", { exact: true })
    .selectOption("compact");
  await page.getByLabel("检索模式", { exact: true }).selectOption("hybrid");
  await page
    .getByLabel("你想了解什么？")
    .fill("CiteBase 索引更新失败时如何处理？");
  const answerResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/questions") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提问", exact: true }).click();
  const answer = await (await answerResponse).json();
  expect(answer.error).toBeNull();
  expect(answer.retrievalOptions).toEqual({
    candidateK: 12,
    keywordWeight: 0.5,
    rerank: false,
    citationStyle: "compact",
  });
  expect(Object.keys(answer.diagnostics.aliasMap).length).toBeGreaterThan(0);
  expect(answer.usage.rerank).toBeNull();
  expect(answer.usage.embedding).toBeNull();
  expect(answer.diagnostics.timings.generationMs).toBeGreaterThanOrEqual(0);
  expect(answer.diagnostics.candidateCounts.selected).toBeGreaterThan(0);
  const answerCard = page.locator(".answer-card").first();
  await answerCard.locator(".retrieval-diagnostics summary").first().click();
  await expect(answerCard.locator(".rerank-status")).toContainText(
    "关闭 · 未调用",
  );
  await expect(answerCard.locator(".provider-usage")).toContainText(
    "供应商未返回（null）",
  );
  await expect(answerCard.locator(".stage-timings")).toContainText("回答生成");
  await answerCard.locator(".retrieval-diagnostics").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../docs/screenshots/phase2-stage2-retrieval-diagnostics.png",
  });
  await answerCard.locator(".inline-citation").first().click();
  await expect(page.locator(".drawer .source-text")).toContainText(
    "上一份可用索引",
  );
  await page.getByRole("button", { name: "关闭证据" }).click();

  await page.getByRole("button", { name: "检索评测", exact: true }).click();
  await page.getByLabel("评测名称").fill(runName);
  const dataset = {
    version: `stage2-ui-${stamp}`,
    questions: [
      {
        id: "update",
        question: "CiteBase 索引更新失败时如何处理？",
        answerable: true,
        expectedAnswer: "保留上一份可用索引",
        category: "lifecycle",
        split: "dev",
        evidence: [
          {
            documentName,
            page: 1,
            paragraph: 2,
            quote:
              "CiteBase 索引更新失败时保留上一份可用索引，成功后切换新版本。",
          },
        ],
      },
      {
        id: "unknown",
        question: "火星气温是多少？",
        answerable: false,
        expectedAnswer: null,
        category: "unanswerable",
        split: "dev",
        evidence: [],
      },
    ],
  };
  await page.getByLabel("导入评测集 JSON").setInputFiles({
    name: "stage2-evaluation.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(dataset)),
  });
  await page.getByRole("button", { name: "运行向量 / 混合对比" }).click();
  await expect(page.locator(".results h2")).toHaveText(runName, {
    timeout: 90_000,
  });
  await expect(page.locator(".run-retrieval-config")).toContainText("候选 12");
  await expect(page.locator(".run-retrieval-config")).toContainText(
    "关键词权重 0.5",
  );
  await expect(page.locator(".question-results tbody tr")).toHaveCount(4);
  await expect(page.locator(".evaluation-task-status .badge")).toHaveText(
    "成功",
    { timeout: 90_000 },
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  const download = await downloaded,
    stream = await download.createReadStream(),
    chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks),
    exported = JSON.parse(raw.toString());
  expect(exported.config.retrievalOptions).toEqual(answer.retrievalOptions);
  expect(exported.results).toHaveLength(4);
  for (const result of exported.results)
    expect(result.retrievalOptions).toEqual(exported.config.retrievalOptions);
  await testInfo.attach("stage2-mock-export", {
    body: raw,
    contentType: "application/json",
  });
  await page.locator(".results").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../docs/screenshots/phase2-stage2-evaluation.png",
  });

  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await page.locator(".retrieval-controls summary").click();
  await page.getByLabel("启用独立 Reranker", { exact: true }).check();
  await page
    .getByLabel("你想了解什么？")
    .fill("CiteBase 索引更新失败时如何处理？");
  const failedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/questions") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提问", exact: true }).click();
  const failed = await (await failedResponse).json();
  expect(failed.error).toContain("MOCK模式不调用真实reranker");
  expect(failed.usage.rerank).toBeNull();
  expect(failed.retrievalOptions.rerank).toBe(true);
  const failedCard = page.locator(".answer-card").first();
  await expect(failedCard.locator(".badge.failed")).toHaveText(
    "执行失败 · 已停止回答",
  );
  await expect(failedCard.locator(":scope > .inline-error")).toContainText(
    "MOCK模式不调用真实reranker",
  );
  await failedCard.locator(".retrieval-diagnostics summary").first().click();
  await expect(failedCard.locator(".provider-usage")).toContainText(
    "供应商未返回（null）",
  );
  await failedCard.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../docs/screenshots/phase2-stage2-rerank-error.png",
  });
  await testInfo.attach("stage2-mock-rerank-error", {
    body: JSON.stringify(failed, null, 2),
    contentType: "application/json",
  });

  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await expect(page.locator("#knowledge-base option:checked")).toHaveText(
    kbName,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除知识库", exact: true }).click();
  await expect(page.locator("#knowledge-base")).not.toContainText(kbName);
});
