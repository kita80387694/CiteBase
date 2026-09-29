import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function enterAgent(page: Page) {
  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await page.getByRole("button", { name: "有边界 Agent", exact: true }).click();
  await expect(page.getByLabel("Agent 问题", { exact: true })).toBeVisible();
}
async function create(page: Page, question: string) {
  await page.getByLabel("Agent 问题", { exact: true }).fill(question);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/agent-runs") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "创建 Agent 运行", exact: true })
    .click();
  const saved = await (await response).json();
  expect(saved.status).toBe("CREATED");
  await expect(page.locator(".agent-run")).toHaveAttribute(
    "data-run-id",
    saved.id,
  );
  return saved;
}
test("Agent MOCK 实际后端：持久创建、显式执行、引用导出、取消、预算和幂等恢复", async ({
  page,
}) => {
  const stamp = Date.now(),
    kbName = `Agent-E2E-${stamp}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let executions = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/execute") && r.method() === "POST") executions++;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.locator(".mode")).toContainText("MOCK");
  page.once("dialog", (dialog) => dialog.accept(kbName));
  await page.getByRole("button", { name: "新建知识库" }).click();
  await expect(page.locator("#knowledge-base option:checked")).toHaveText(
    kbName,
  );
  const kbId = await page.locator("#knowledge-base").inputValue();
  const paragraphs = Array.from(
    { length: 30 },
    (_, i) =>
      `## 操作规范 ${i + 1}\n\nCiteBase 文档更新失败时保留上一份可用索引，成功后切换版本。操作记录编号 CB-${i + 100} 必须保存在审计日志中，确保每次版本切换可以追溯。CiteBase 只允许当前用户读取自己的知识库，引用访问也会校验权限。`,
  ).join("\n\n");
  await page.locator("input[type=file]").setInputFiles({
    name: `agent-guide-${stamp}.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from(paragraphs),
  });
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: `agent-guide-${stamp}.md` })
      .getByText("成功", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await enterAgent(page);
  await expect(
    page.getByText("还没有 Agent 运行。", { exact: true }),
  ).toBeVisible();
  const normal = await create(page, "CiteBase 文档更新失败时如何处理？");
  expect(executions).toBe(0);
  await page.reload();
  await expect(page.locator("#knowledge-base")).toBeVisible();
  await page.locator("#knowledge-base").selectOption(kbId);
  await enterAgent(page);
  await expect(page.locator(".agent-run")).toHaveAttribute(
    "data-run-id",
    normal.id,
  );
  await expect(page.locator(".agent-run .badge").first()).toHaveText("待执行");
  expect(executions).toBe(0);
  await page.getByRole("button", { name: "执行此运行", exact: true }).click();
  await expect(page.locator(".agent-run .badge").first()).toHaveText(
    "任务完成",
    {
      timeout: 60000,
    },
  );
  expect(executions).toBe(1);
  await expect(page.locator(".agent-result")).toContainText(
    "MOCK · 仅流程验证",
  );
  await expect(page.locator(".agent-steps li").first()).toBeVisible();
  await page.locator(".agent-result .citations button").first().click();
  await expect(page.locator(".drawer .source-text")).toContainText(
    "保留上一份可用索引",
  );
  await page.getByRole("button", { name: "关闭证据" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 Agent 记录", exact: true })
    .click();
  const exported = JSON.parse(
    await readFile((await (await downloadPromise).path())!, "utf8"),
  );
  expect(exported.id).toBe(normal.id);
  expect(exported.result.modelMode).toBe("mock");
  expect(exported.result.answerCorrect).toBeNull();
  expect(exported.result.citationValid).toBe(true);
  await page.screenshot({
    path: "../docs/screenshots/phase2-agent-mock-completed.png",
    fullPage: true,
  });
  const cancelled = await create(page, "取消这次尚未执行的 Agent 运行");
  await page.getByRole("button", { name: "取消运行", exact: true }).click();
  await expect(page.locator(".agent-run .badge").first()).toHaveText("已取消");
  expect(executions).toBe(1);
  await expect(
    page.getByRole("button", { name: "执行此运行", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".agent-run")).toHaveAttribute(
    "data-run-id",
    cancelled.id,
  );
  await page.locator(".agent-budget-controls summary").click();
  await page.getByLabel("最大证据片段", { exact: true }).fill("1");
  await create(page, "CiteBase 文档更新失败时如何处理？");
  await page.getByRole("button", { name: "执行此运行", exact: true }).click();
  await expect(page.locator(".agent-run .badge").first()).toHaveText("失败", {
    timeout: 60000,
  });
  await expect(page.locator(".agent-run .inline-error")).toContainText(
    "预算耗尽",
  );
  await expect(page.locator(".agent-result .answer-text")).toHaveCount(0);
  await expect(page.locator(".agent-run")).not.toContainText(
    "证据不足 · 明确拒答",
  );
  await page.screenshot({
    path: "../docs/screenshots/phase2-agent-budget-failed.png",
    fullPage: true,
  });
  // Real create reaches the backend; only the browser response is deliberately dropped.
  let lostId = "",
    firstKey = "";
  await page.getByLabel("最大证据片段", { exact: true }).fill("12");
  await page.route(
    "**/api/agent-runs",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      firstKey = route.request().postDataJSON().idempotencyKey;
      lostId = (await (await route.fetch()).json()).id;
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page
    .getByLabel("Agent 问题", { exact: true })
    .fill("创建响应丢失恢复用例");
  await page
    .getByRole("button", { name: "创建 Agent 运行", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("创建未完成");
  await page.reload();
  await expect(page.locator("#knowledge-base")).toBeVisible();
  await page.locator("#knowledge-base").selectOption(kbId);
  await enterAgent(page);
  const reconcile = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/agent-runs") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "核对并重试创建", exact: true })
    .click();
  const response = await reconcile;
  expect(response.request().postDataJSON().idempotencyKey).toBe(firstKey);
  expect((await response.json()).id).toBe(lostId);
  await expect(page.locator(".agent-run")).toHaveAttribute(
    "data-run-id",
    lostId,
  );
  expect(executions).toBe(2);
  await page.getByRole("button", { name: "取消运行", exact: true }).click();
  await expect(page.locator(".agent-run .badge").first()).toHaveText("已取消");
  await page.getByRole("button", { name: "基础 RAG", exact: true }).click();
  await expect(page.getByLabel("你想了解什么？")).toBeVisible();
  expect(errors).toEqual([]);
});
