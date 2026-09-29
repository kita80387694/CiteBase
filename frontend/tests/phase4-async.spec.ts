import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function token(page: Page) {
  return page.evaluate(() => localStorage.getItem("citebase.token")!);
}
async function exportEvaluation(page: Page) {
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
  return JSON.parse(await readFile((await (await promise).path())!, "utf8"));
}

test("阶段四实际MOCK：异步评测、未知创建幂等恢复、快照引用、三类任务和Agent入队", async ({
  page,
}) => {
  const stamp = Date.now(),
    kbName = `Phase4-UI-${stamp}`,
    documentName = `phase4-source-${stamp}.md`,
    evalName = `Phase4异步-${stamp}`;
  const runtimeErrors: string[] = [];
  page.on("pageerror", (e) => runtimeErrors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.locator(".mode")).toContainText("MOCK");
  page.once("dialog", (d) => d.accept(kbName));
  await page.getByRole("button", { name: "新建知识库" }).click();
  await expect(page.locator("#knowledge-base option:checked")).toHaveText(
    kbName,
  );
  const kbId = await page.locator("#knowledge-base").inputValue();
  const original =
    "CiteBase 旧版评测窗口为 17 分钟，版本标识 P4-OLD。\n\nCiteBase 文档更新失败时保留上一份可用索引。";
  await page.locator("input[type=file]").setInputFiles({
    name: documentName,
    mimeType: "text/markdown",
    buffer: Buffer.from(original),
  });
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: documentName })
      .getByText("成功", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "检索评测", exact: true }).click();
  await page.getByLabel("评测名称", { exact: true }).fill(evalName);
  const dataset = {
    version: `phase4-${stamp}`,
    questions: [
      {
        id: "window",
        question: "CiteBase 旧版评测窗口为多少分钟？",
        answerable: true,
        expectedAnswer: "17 分钟",
        evidence: [
          {
            documentName,
            page: 1,
            paragraph: 1,
            quote: "CiteBase 旧版评测窗口为 17 分钟，版本标识 P4-OLD。",
            groupId: "window",
          },
        ],
      },
      {
        id: "unknown",
        question: "火星地下湖泊有多少条鱼？",
        answerable: false,
        evidence: [],
      },
    ],
  };
  await page.getByLabel("导入评测集 JSON").setInputFiles({
    name: "phase4.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(dataset)),
  });
  let firstKey = "",
    createdId = "",
    createStatus = 0,
    dropped = false;
  // Actual server work is created; only its browser response is dropped.
  await page.route("**/api/evaluations", async (route) => {
    if (route.request().method() !== "POST" || dropped) return route.continue();
    dropped = true;
    firstKey = route.request().postDataJSON().idempotencyKey;
    const response = await route.fetch();
    createStatus = response.status();
    const body = await response.json();
    createdId = body.id;
    expect(body.taskId).toBe(body.id);
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "运行向量 / 混合对比", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "核对并重试创建评测" }),
  ).toBeEnabled();
  expect(createStatus).toBe(202);
  expect(firstKey).toBeTruthy();
  await expect(page.getByLabel("评测名称", { exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.locator("#knowledge-base")).toBeVisible();
  await page.locator("#knowledge-base").selectOption(kbId);
  await page.getByRole("button", { name: "检索评测", exact: true }).click();
  const adopted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/evaluations") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "核对并重试创建评测" }).click();
  const replay = await adopted;
  expect(replay.status()).toBe(202);
  expect(replay.request().postDataJSON().idempotencyKey).toBe(firstKey);
  expect((await replay.json()).id).toBe(createdId);
  await expect(page.locator(".results h2")).toHaveText(evalName);
  await expect(page.locator(".evaluation-task-status .badge")).toHaveText(
    "成功",
    { timeout: 90000 },
  );
  await expect(page.locator(".question-results tbody tr")).toHaveCount(4);
  const exported = await exportEvaluation(page);
  expect(exported.partial).toBe(false);
  expect(exported.taskStatus).toBe("SUCCEEDED");
  expect(exported.results).toHaveLength(4);
  expect(
    exported.results.every(
      (r: { answerCorrect: unknown }) => r.answerCorrect === null,
    ),
  ).toBe(true);
  const citation = exported.results.find(
    (r: { caseId: string; mode: string }) =>
      r.caseId === "window" && r.mode === "vector",
  ).citations[0];
  expect(citation.id).toBeTruthy();
  await page.screenshot({
    path: "../docs/screenshots/phase4-async-evaluation.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "知识库", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: documentName });
  await row.locator("input[type=file]").setInputFiles({
    name: documentName,
    mimeType: "text/markdown",
    buffer: Buffer.from("CiteBase 新版评测窗口为 29 分钟，版本标识 P4-NEW。"),
  });
  await expect(row.getByText("成功", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  const auth = { Authorization: `Bearer ${await token(page)}` };
  await expect
    .poll(async () =>
      (
        await page.request.get(`/api/citations/${citation.id}`, {
          headers: auth,
        })
      ).status(),
    )
    .toBe(404);
  await page.getByRole("button", { name: "检索评测", exact: true }).click();
  await page
    .getByRole("button", {
      name: "CiteBase 旧版评测窗口为多少分钟？",
      exact: true,
    })
    .first()
    .click();
  const scoped = page.waitForResponse((r) =>
    r.url().includes(`/evaluations/${createdId}/citations/`),
  );
  await page.locator(".drawer.wide .inline-citation").first().click();
  expect((await scoped).status()).toBe(200);
  await expect(page.locator(".drawer .source-text")).toContainText("P4-OLD");
  await expect(page.locator(".drawer")).toContainText("本次评测快照版本");
  await page.screenshot({
    path: "../docs/screenshots/phase4-snapshot-citation.png",
  });
  await page.getByRole("button", { name: "关闭证据" }).click();

  const bob = await page.request.post("/api/auth/login", {
    data: { username: "bob", password: "Bob-demo-123!" },
  });
  expect(bob.ok()).toBe(true);
  const bobHeaders = { Authorization: `Bearer ${(await bob.json()).token}` };
  expect(
    (
      await page.request.get(`/api/tasks/${createdId}`, { headers: bobHeaders })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get(
        `/api/evaluations/${createdId}/citations/${citation.id}`,
        { headers: bobHeaders },
      )
    ).status(),
  ).toBe(404);

  await page.getByRole("button", { name: "知识问答", exact: true }).click();
  await page.getByRole("button", { name: "有边界 Agent", exact: true }).click();
  await page
    .getByLabel("Agent 问题", { exact: true })
    .fill("CiteBase 新版评测窗口为多少分钟？");
  await page
    .getByRole("button", { name: "创建 Agent 运行", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "执行此运行", exact: true }),
  ).toBeVisible();
  const executed = page.waitForResponse(
    (r) => r.url().endsWith("/execute") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "执行此运行", exact: true }).click();
  const queued = await executed;
  expect(queued.status()).toBe(202);
  const agent = await queued.json();
  expect(agent.taskId).toBe(agent.id);
  await expect(page.locator(".agent-run .badge").first()).toHaveText(
    "任务完成",
    { timeout: 90000 },
  );
  await expect(page.locator(".agent-result .answer-text")).toContainText("29");
  await page.getByRole("button", { name: "处理任务", exact: true }).click();
  await expect(page.locator(".unified-tasks .task")).toHaveCount(4);
  await page.getByLabel("任务类型", { exact: true }).selectOption("EVALUATION");
  await expect(page.locator(".unified-tasks .task")).toHaveCount(1);
  await expect(page.locator(".unified-tasks .task")).toContainText(
    "问题/模式项",
  );
  await page.getByLabel("任务类型", { exact: true }).selectOption("");
  await expect(page.locator(".unified-tasks .task")).toHaveCount(4);
  await page.screenshot({
    path: "../docs/screenshots/phase4-unified-tasks.png",
    fullPage: true,
  });
  expect(runtimeErrors).toEqual([]);
});
