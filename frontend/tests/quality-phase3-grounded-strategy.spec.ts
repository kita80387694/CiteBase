import { test, expect } from "@playwright/test";

test("证据生成策略实际MOCK：六选项、实验边界、持久化与配置恢复", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.locator(".mode")).toContainText("MOCK");
  const kbName = `TEST_ONLY-GROUNDED-STRATEGY-${Date.now()}`;
  page.once("dialog", dialog => dialog.accept(kbName));
  await page.getByRole("button", { name: "新建知识库" }).click();
  await expect(page.locator("#knowledge-base option:checked")).toHaveText(kbName);
  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await page.getByRole("button", { name: "有边界 Agent", exact: true }).click();
  const select = page.getByLabel("Agent 执行策略", { exact: true });
  await expect(select).toHaveValue("original");
  await expect(select.locator("option")).toHaveCount(6);
  for (const strategy of ["grounded-answer-v1", "combined-grounded-v1"]) {
    await select.selectOption(strategy);
    await expect(page.getByRole("note")).toContainText("辅助评审不是真人评审");
    await expect(page.getByRole("note")).toContainText("否定或条件结论与缺少证据");
    await page.getByLabel("Agent 问题", { exact: true }).fill("缺少审批时是否允许发布？");
    const pending = page.waitForResponse(r => r.url().endsWith("/api/agent-runs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "创建 Agent 运行", exact: true }).click();
    const response = await pending;
    expect(response.ok()).toBeTruthy();
    const run = await response.json();
    expect(response.request().postDataJSON().strategy).toBe(strategy);
    expect(run.request.strategy).toBe(strategy);
    expect(run.status).toBe("CREATED");
    expect(run.steps).toEqual([]);
    await expect(page.getByTestId("agent-run-strategy")).toContainText(strategy);
    await page.getByRole("button", { name: "取消运行", exact: true }).click();
    await expect(page.locator(".agent-run .badge").first()).toHaveText("已取消");
    await page.getByRole("button", { name: "填入原配置新建", exact: true }).click();
    await expect(select).toHaveValue(strategy);
  }
  // No generated screenshots: do not overwrite historical verification artifacts.
});
