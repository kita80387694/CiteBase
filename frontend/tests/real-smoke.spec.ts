import { test, expect } from "@playwright/test";

test("真实模型：基于现有索引提问并核验内联来源", async ({ page }) => {
  test.skip(
    process.env.E2E_REAL !== "1",
    "显式设置 E2E_REAL=1 后调用真实模型；不创建额外评测",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(
    page.getByRole("heading", { name: "知识库", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".mode")).not.toContainText("MOCK");
  await page
    .locator("#knowledge-base")
    .selectOption({ label: "CiteBase 自建手册 v1" });
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await expect(page.locator("tbody .badge.success")).toHaveCount(5, {
    timeout: 90_000,
  });
  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await page.getByLabel("你想了解什么？").fill("Atlas API 默认监听哪个端口？");
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/questions") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提问", exact: true }).click();
  expect((await responsePromise).ok()).toBeTruthy();
  await expect(page.getByLabel("你想了解什么？")).toHaveValue("");
  const answer = page.locator(".answer-card").first();
  await expect(answer.locator(".inline-citation").first()).toBeVisible({
    timeout: 90_000,
  });
  await expect(answer.locator(".answer-text")).not.toContainText(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  await expect(answer).toContainText("引用格式 有效");
  await expect(answer.locator(".answer-text")).toContainText("9081");
  await answer.locator(".inline-citation").first().click();
  await expect(page.locator(".drawer .source-text")).toContainText("Atlas");
  await page.screenshot({
    path: "../docs/screenshots/real-chat.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭证据" }).click();
  await page.getByRole("button", { name: "检索评测", exact: true }).click();
  await page
    .locator(".run-row")
    .filter({ hasText: "real 自建手册对比" })
    .click();
  await expect(page.locator(".results h2")).toHaveText("real 自建手册对比");
  await expect(
    page.locator(".results tbody").first().getByRole("row"),
  ).toHaveCount(2);
  await expect(
    page.locator(".results tbody").last().getByRole("row"),
  ).toHaveCount(116);
  await page.locator(".results").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../docs/screenshots/real-evaluation.png" });
});
