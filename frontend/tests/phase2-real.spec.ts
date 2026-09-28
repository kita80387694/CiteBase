import { test, expect } from "@playwright/test";

test.describe.configure({ retries: 0 });

test("阶段一真实界面：单次 Harbor 问答、来源与含失败的既有评测", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.E2E_REAL !== "1",
    "显式开启真实模型检查；只提交一次问答，不创建评测或人工评分",
  );
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.locator(".mode")).toHaveText("real");
  await page
    .locator("#knowledge-base")
    .selectOption({ label: "Phase2 baseline" });
  await expect(page.locator("tbody tr")).toHaveCount(12);
  await expect(page.locator("tbody .badge.success")).toHaveCount(12);
  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await page
    .getByLabel("你想了解什么？")
    .fill("Harbor 正式站运输箱的正常温度范围是多少？");
  const pendingAnswer = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/questions") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提问", exact: true }).click();
  const response = await pendingAnswer;
  const answerBody = await response.json();
  await testInfo.attach("single-real-question-response", {
    body: JSON.stringify(
      { status: response.status(), result: answerBody },
      null,
      2,
    ),
    contentType: "application/json",
  });
  // Keep a failed real response as evidence; never retry to obtain a passing answer.
  expect.soft(response.ok(), "单次真实问答 HTTP 状态").toBeTruthy();
  expect
    .soft(
      answerBody.error ?? null,
      "单次真实问答失败原因，不能丢弃或重试筛成功",
    )
    .toBeNull();
  expect
    .soft(answerBody.answer ?? "", "Harbor 正式站温度，应区别于同名干扰文档")
    .toMatch(/2\s*[–—\-~至到]\s*6/);
  if (response.ok()) {
    await expect(page.getByLabel("你想了解什么？")).toHaveValue("");
    const answer = page.locator(".answer-card").first();
    await answer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "../docs/screenshots/phase2-real-chat.png" });
    if (answerBody.citations?.length) {
      await answer.locator(".inline-citation").first().click();
      await expect(page.locator(".drawer .source-text")).toContainText(
        "Harbor",
      );
      await page.screenshot({
        path: "../docs/screenshots/phase2-real-citation.png",
      });
      await page.getByRole("button", { name: "关闭证据" }).click();
    } else {
      expect
        .soft(
          answerBody.citations?.length ?? 0,
          "单次真实回答应提供可点击来源；失败需保留",
        )
        .toBeGreaterThan(0);
    }
  } else {
    await page.screenshot({
      path: "../docs/screenshots/phase2-real-question-error.png",
    });
  }

  await page.getByRole("button", { name: "检索评测", exact: true }).click();
  await page
    .locator(".run-row")
    .filter({ hasText: "smoke-dev-0-87404fc2" })
    .click();
  await expect(page.locator(".results h2")).toHaveText("smoke-dev-0-87404fc2");
  await expect(page.locator(".question-results tbody tr")).toHaveCount(4);
  await expect(page.locator(".results > .alert")).toBeVisible();
  await expect(page.locator(".question-results .inline-error")).toHaveCount(1);
  await expect(page.locator(".question-results .inline-error")).toHaveText(
    "模型引用不属于本次检索结果",
  );
  await page.locator(".results").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../docs/screenshots/phase2-real-evaluation.png",
  });
  await page.getByLabel("错误与评分筛选").selectOption("error");
  await expect(page.locator(".question-results tbody tr")).toHaveCount(1);
  await page.locator(".question-results .question-button").click();
  await expect(page.locator(".drawer.wide > .alert")).toHaveText(
    "模型引用不属于本次检索结果",
  );
  await expect(page.locator(".review-metrics")).toContainText("未评分");
  await expect(page.locator(".review-metrics")).toContainText("未评估");
  await page.screenshot({
    path: "../docs/screenshots/phase2-real-error-detail.png",
  });
  await page.getByRole("button", { name: "关闭问题详情" }).click();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  const download = await pendingDownload;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks);
  await testInfo.attach("existing-smoke-export", {
    body: raw,
    contentType: "application/json",
  });
  const exported = JSON.parse(raw.toString());
  expect(exported.name).toBe("smoke-dev-0-87404fc2");
  expect(exported.status).toBe("COMPLETED_WITH_ERRORS");
  expect(exported.results).toHaveLength(4);
  expect(
    exported.results.filter((row: { error: string | null }) => !!row.error),
  ).toHaveLength(1);
  expect(
    exported.results.every(
      (row: { answerCorrect: boolean | null }) => row.answerCorrect === null,
    ),
  ).toBeTruthy();
  expect(runtimeErrors).toEqual([]);
});
