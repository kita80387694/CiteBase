import { test, expect } from "@playwright/test";

test("成本实验实际MOCK：默认兼容、条件重排、缓存MISS/HIT与Agent原配置恢复", async ({
  page,
}) => {
  const stamp = Date.now(),
    kbName = `TEST_ONLY-RETRIEVAL-COST-${stamp}`;
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.locator(".mode")).toContainText("MOCK");
  page.once("dialog", (dialog) => dialog.accept(kbName));
  await page.getByRole("button", { name: "新建知识库" }).click();
  await expect(page.locator("#knowledge-base option:checked")).toHaveText(
    kbName,
  );
  await page.locator("input[type=file]").setInputFiles({
    name: `cost-guide-${stamp}.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "CiteBase 文档更新失败时保留上一份可用索引，成功后切换版本。此文档仅用于自动成本流程测试。",
    ),
  });
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: `cost-guide-${stamp}.md` })
      .getByText("成功", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await page.locator(".retrieval-controls summary").click();
  await expect(
    page.getByLabel("启用检索结果缓存 · 实验", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("重排输入精确去重 · 实验", { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByLabel("重排调用策略", { exact: true })).toHaveValue(
    "always",
  );
  await page
    .getByLabel("你想了解什么？")
    .fill("CiteBase 文档更新失败时如何处理？");
  async function ask() {
    await page
      .getByLabel("你想了解什么？")
      .fill("CiteBase 文档更新失败时如何处理？");
    const promise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/questions") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "提问", exact: true }).click();
    const response = await promise;
    expect(response.ok()).toBe(true);
    return {
      body: await response.json(),
      sent: response.request().postDataJSON(),
    };
  }
  const baseline = await ask();
  expect(baseline.sent.retrievalOptions).not.toHaveProperty("rerankPolicy");
  expect(baseline.sent.retrievalOptions).not.toHaveProperty("deduplicate");
  expect(baseline.sent.retrievalOptions).not.toHaveProperty("cache");
  await page.getByLabel("启用独立 Reranker", { exact: true }).check();
  await page
    .getByLabel("重排调用策略", { exact: true })
    .selectOption("candidate-pressure-v1");
  await page.getByLabel("重排输入精确去重 · 实验", { exact: true }).check();
  await page.getByLabel("启用检索结果缓存 · 实验", { exact: true }).check();
  const miss = await ask();
  expect(miss.sent.retrievalOptions).toMatchObject({
    rerank: true,
    rerankPolicy: "candidate-pressure-v1",
    deduplicate: true,
    cache: true,
  });
  expect(miss.body.diagnostics.cost.cache.status).toBe("MISS");
  expect(miss.body.diagnostics.cost.rerankDecision).toBe(
    "SKIPPED_CANDIDATE_PRESSURE",
  );
  const hit = await ask();
  expect(hit.body.diagnostics.cost.cache.status).toBe("HIT");
  expect(hit.body.diagnostics.cost.currentProviderCalls).toEqual({
    embedding: 0,
    rerank: 0,
  });
  expect(hit.body.usage.embedding).toBeNull();
  expect(hit.body.usage.rerank).toBeNull();
  expect(hit.body.diagnostics.cost.usageReason).toBe("not_called_cache_hit");
  await page.locator(".retrieval-diagnostics > summary").first().click();
  await expect(page.getByLabel("检索成本诊断").first()).toContainText(
    "缓存：HIT",
  );
  await expect(page.getByLabel("检索成本诊断").first()).toContainText(
    "不继承历史 token",
  );
  await expect(page.locator(".provider-usage").first()).toContainText(
    "本次未调用供应商（null）",
  );
  await page.screenshot({
    path: "../docs/screenshots/quality-phase3-retrieval-cost-hit-mock.png",
    fullPage: true,
  });
  // Shared controls in Agent keep experimental options when explicitly reusing a terminal run.
  await page.getByRole("button", { name: "有边界 Agent", exact: true }).click();
  await page.locator(".retrieval-controls summary").click();
  await page.getByLabel("启用独立 Reranker", { exact: true }).check();
  await page
    .getByLabel("重排调用策略", { exact: true })
    .selectOption("candidate-pressure-v1");
  await page.getByLabel("重排输入精确去重 · 实验", { exact: true }).check();
  await page.getByLabel("启用检索结果缓存 · 实验", { exact: true }).check();
  await page
    .getByLabel("Agent 问题", { exact: true })
    .fill("CiteBase 文档更新失败时如何处理？");
  const creation = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/agent-runs") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "创建 Agent 运行", exact: true })
    .click();
  const created = await (await creation).json();
  expect(created.request.retrievalOptions).toMatchObject({
    rerankPolicy: "candidate-pressure-v1",
    deduplicate: true,
    cache: true,
  });
  await page.getByRole("button", { name: "取消运行", exact: true }).click();
  await expect(page.locator(".agent-run .badge").first()).toHaveText("已取消");
  await page
    .getByRole("button", { name: "填入原配置新建", exact: true })
    .click();
  await expect(page.getByLabel("重排调用策略", { exact: true })).toHaveValue(
    "candidate-pressure-v1",
  );
  await expect(
    page.getByLabel("启用检索结果缓存 · 实验", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("重排输入精确去重 · 实验", { exact: true }),
  ).toBeChecked();
});
