import { test, expect } from "@playwright/test";

test("探索性Agent策略实际MOCK：默认原策略、参数持久化、预算不变与显式执行", async ({
  page,
}) => {
  const stamp = Date.now(),
    kbName = `TEST_ONLY-AGENT-STRATEGY-${stamp}`;
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.locator(".mode")).toContainText("MOCK");
  page.once("dialog", (dialog) => dialog.accept(kbName));
  await page.getByRole("button", { name: "新建知识库" }).click();
  await expect(page.locator("#knowledge-base option:checked")).toHaveText(
    kbName,
  );
  const kbId = await page.locator("#knowledge-base").inputValue();
  await page.locator("input[type=file]").setInputFiles({
    name: `strategy-guide-${stamp}.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "CiteBase 文档更新失败时保留上一份可用索引，成功后切换版本。此文档仅用于自动流程测试。",
    ),
  });
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: `strategy-guide-${stamp}.md` })
      .getByText("成功", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await page.getByRole("button", { name: "有边界 Agent", exact: true }).click();
  await expect(page.getByLabel("Agent 执行策略", { exact: true })).toHaveValue(
    "original",
  );
  const createdRuns: {
    id: string;
    request: { budget: unknown; strategy?: string };
    config: { agentStrategy?: string };
  }[] = [];
  for (const strategy of [
    "original",
    "inspection-free-v1",
    "stop-aware-v1",
    "combined-v1",
  ]) {
    await page
      .getByLabel("Agent 执行策略", { exact: true })
      .selectOption(strategy);
    if (strategy !== "original")
      await expect(page.getByRole("note")).toContainText(
        "探索性策略，尚无真人质量结论",
      );
    await page
      .getByLabel("Agent 问题", { exact: true })
      .fill("CiteBase 文档更新失败时如何处理？");
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/agent-runs") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "创建 Agent 运行", exact: true })
      .click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const run = await response.json();
    createdRuns.push(run);
    expect(run.request.strategy ?? run.config.agentStrategy ?? "original").toBe(
      strategy,
    );
    expect(response.request().postDataJSON().strategy ?? "original").toBe(
      strategy,
    );
    expect(run.request.budget).toEqual(createdRuns[0].request.budget);
    expect(run.status).toBe("CREATED");
    expect(run.steps).toEqual([]);
    await expect(page.getByTestId("agent-run-strategy")).toContainText(
      strategy,
    );
  }
  const combined = createdRuns[3];
  await page.getByRole("button", { name: "执行此运行", exact: true }).click();
  await expect(page.locator(".agent-run .badge").first()).toHaveText(
    "任务完成",
    { timeout: 60000 },
  );
  const token = await page.evaluate(() =>
    localStorage.getItem("citebase.token"),
  );
  const response = await page.request.get(`/api/agent-runs/${combined.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);
  const completed = await response.json();
  expect(completed.result.strategy).toBe("combined-v1");
  expect(completed.result.modelMode).toBe("mock");
  expect(completed.result.answerCorrect).toBeNull();
  const plannerStep = completed.steps.find(
    (step: { kind: string }) => step.kind === "planner",
  );
  expect(plannerStep.output.policy.strategy).toBe("combined-v1");
  expect(plannerStep.output.policy.allowedTools).not.toContain(
    "inspectCitation",
  );
  expect(plannerStep.output.policy.remainingBudget).toHaveProperty(
    "plannerSteps",
  );
  expect(completed.request.budget).toEqual(createdRuns[0].request.budget);
  await page.reload();
  await expect(page.locator("#knowledge-base")).toBeVisible();
  await page.locator("#knowledge-base").selectOption(kbId);
  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await page.getByRole("button", { name: "有边界 Agent", exact: true }).click();
  await expect(page.getByTestId("agent-run-strategy")).toContainText(
    "combined-v1",
  );
  await page
    .getByRole("button", { name: "填入原配置新建", exact: true })
    .click();
  await expect(page.getByLabel("Agent 执行策略", { exact: true })).toHaveValue(
    "combined-v1",
  );
  await page.screenshot({
    path: "../docs/screenshots/quality-phase3-agent-strategy-mock.png",
    fullPage: true,
  });
});
