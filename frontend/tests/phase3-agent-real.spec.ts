import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("真实 Agent 已保存运行：轨迹、预算、引用与导出只读验证", async ({
  page,
}) => {
  const runId = process.env.E2E_AGENT_RUN_ID;
  test.skip(
    !runId,
    "需要 E2E_AGENT_RUN_ID 指向真实完成运行；不会自动发起模型调用",
  );
  let modelExecutionRequests = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      (/\/execute$/.test(r.url()) || /\/questions$/.test(r.url()))
    )
      modelExecutionRequests++;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.locator(".mode")).toHaveText("real");
  const saved = await page.evaluate(async (id) => {
    const response = await fetch(`/api/agent-runs/${id}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("citebase.token")}`,
      },
    });
    if (!response.ok) throw Error(`Saved run fetch: ${response.status}`);
    return response.json();
  }, runId);
  expect(saved.status).toBe("COMPLETED");
  expect(saved.result.modelMode).toBe("real");
  expect(saved.result.citationValid).toBe(true);
  expect(saved.result.citations.length).toBeGreaterThan(0);
  await page.locator("#knowledge-base").selectOption(saved.kbId);
  await page.evaluate(
    ({ id, kbId }) =>
      sessionStorage.setItem(`citebase.agent.selected.alice.${kbId}`, id),
    { id: runId!, kbId: saved.kbId },
  );
  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await page.getByRole("button", { name: "有边界 Agent", exact: true }).click();
  await expect(page.locator(".agent-run")).toHaveAttribute(
    "data-run-id",
    runId!,
  );
  await expect(page.locator(".agent-run .badge").first()).toHaveText("完成");
  await expect(page.locator(".agent-result .answer-text")).not.toBeEmpty();
  const config = page
    .locator(".agent-run details")
    .filter({ has: page.locator("summary", { hasText: "本次运行配置" }) });
  await config.locator("summary").click();
  await expect(config.locator("pre")).toContainText(saved.config.chatModel);
  await expect(config.locator("pre")).toContainText(
    saved.config.agentPlanner.protocolVersion,
  );
  await expect(config.locator("pre")).toContainText(
    saved.config.embeddingModel,
  );
  await config.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../docs/screenshots/phase2-agent-real-config.png",
  });
  await config.locator("summary").click();
  await page.locator(".agent-steps li").first().locator("summary").click();
  await expect(page.locator(".agent-used-budget")).toContainText("工具调用");
  await page.screenshot({
    path: "../docs/screenshots/phase2-agent-real-trace.png",
    fullPage: true,
  });
  await page.locator(".agent-result .citations button").first().click();
  await expect(page.locator(".drawer .source-text")).not.toBeEmpty();
  await page.screenshot({
    path: "../docs/screenshots/phase2-agent-real-citation.png",
  });
  await page.getByRole("button", { name: "关闭证据" }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 Agent 记录", exact: true })
    .click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toBe(`agent-${runId}.json`);
  const exported = JSON.parse(await readFile((await artifact.path())!, "utf8"));
  expect(exported.id).toBe(runId);
  expect(exported.config).toEqual(saved.config);
  expect(exported.result.usage).toEqual(saved.result.usage);
  expect(exported.result.citations).toEqual(saved.result.citations);
  expect(exported.result.answerCorrect).toBeNull();
  expect(modelExecutionRequests).toBe(0);
});
