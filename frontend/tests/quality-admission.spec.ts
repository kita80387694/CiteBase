import { test, expect } from "@playwright/test";

test("准入429展示等待提示，保留问题且不自动重提", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.locator(".mode")).toContainText("MOCK");
  page.once("dialog", dialog => dialog.accept(`TEST_ONLY-ADMISSION-${Date.now()}`));
  await page.getByRole("button", { name: "新建知识库" }).click();
  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  let calls = 0;
  await page.route("**/api/questions", async route => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    if (calls === 1) return route.fulfill({ status: 429, headers: { "Retry-After": "1" }, contentType: "application/json", body: JSON.stringify({ message: "服务繁忙，请稍后重试" }) });
    return route.continue();
  });
  const question = page.locator(".ask-box textarea");
  await question.fill("背压验证资料是否充分？");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("建议等待 1 秒后手动重试");
  await expect(question).toHaveValue("背压验证资料是否充分？");
  await page.screenshot({ path: "../docs/screenshots/quality-admission-429-20261010.png", fullPage: true });
  await page.waitForTimeout(1400);
  expect(calls).toBe(1);
  const response = page.waitForResponse(r => r.url().endsWith("/api/questions") && r.request().method() === "POST" && r.status() === 200);
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await response;
  expect(calls).toBe(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
