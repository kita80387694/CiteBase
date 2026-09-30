import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Automated MOCK fixture scores below are not genuine human quality judgements.
test("质量评审MOCK流程：盲化、双人独立评分、审计、导入导出、裁决与撤权", async ({
  page,
  browser,
}) => {
  const stamp = Date.now(),
    name = `TEST_ONLY-AUTOMATED-REVIEW-${stamp}`;
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.locator(".mode")).toContainText("MOCK");
  const token = await page.evaluate(() =>
    localStorage.getItem("citebase.token"),
  );
  const headers = { Authorization: `Bearer ${token}` };
  const kbResponse = await page.request.post("/api/knowledge-bases", {
    headers,
    data: { name },
  });
  expect(kbResponse.ok()).toBe(true);
  const kb = await kbResponse.json();
  const documentName = `review-source-${stamp}.md`,
    text = "测试文档：评测窗口为17分钟。此数据仅用于自动流程测试。";
  const upload = await page.request.post(
    `/api/knowledge-bases/${kb.id}/documents`,
    {
      headers,
      multipart: {
        file: {
          name: documentName,
          mimeType: "text/markdown",
          buffer: Buffer.from(text),
        },
      },
    },
  );
  expect(upload.ok()).toBe(true);
  await expect
    .poll(
      async () => {
        const docs = await (
          await page.request.get(`/api/knowledge-bases/${kb.id}/documents`, {
            headers,
          })
        ).json();
        return docs[0]?.status;
      },
      { timeout: 60000 },
    )
    .toBe("SUCCESS");
  const created = await page.request.post("/api/evaluations", {
    headers,
    data: {
      kbId: kb.id,
      name,
      topK: 5,
      idempotencyKey: `review-test-${stamp}`,
      dataset: {
        version: `review-test-${stamp}`,
        questions: [
          {
            id: "window",
            question: "评测窗口为多少分钟？",
            answerable: true,
            expectedAnswer: "17分钟",
            evidence: [{ documentName, page: 1, paragraph: 1, quote: text }],
          },
        ],
      },
    },
  });
  expect(created.status()).toBe(202);
  const evaluation = await created.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/tasks/${evaluation.id}`, { headers })
          ).json()
        ).status,
      { timeout: 90000 },
    )
    .toBe("SUCCEEDED");
  await page.getByRole("button", { name: "人工质量评审", exact: true }).click();
  await page.getByRole("button", { name: "管理评审项目", exact: true }).click();
  await page.getByLabel("评审项目名称", { exact: true }).fill(name);
  await page.getByLabel("选择已完成来源").selectOption(evaluation.id);
  await page.getByRole("button", { name: "添加来源", exact: true }).click();
  await page.getByRole("button", { name: "创建评审项目", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByLabel("评审者用户名").fill("alice,bob");
  await page.getByLabel("双人复核比例（%）").fill("100");
  await page.getByRole("button", { name: "分配评审任务", exact: true }).click();
  await expect(page.locator(".review-summary")).toContainText("分配 4");
  const projects = await (
    await page.request.get("/api/reviews/projects", { headers })
  ).json();
  const project = projects.find((p: { name: string }) => p.name === name);
  const assignments = await (
    await page.request.get("/api/reviews/assignments", { headers })
  ).json();
  const assignment = assignments.find(
    (a: { projectName: string }) => a.projectName === name,
  );
  const packet = await (
    await page.request.get(`/api/reviews/assignments/${assignment.id}`, {
      headers,
    })
  ).json();
  for (const field of [
    "source",
    "runId",
    "mode",
    "model",
    "modelMode",
    "config",
    "trace",
    "owner",
    "promptTokens",
  ])
    expect(packet).not.toHaveProperty(field);
  expect(packet.latestScore).toBeNull();
  expect(packet.history).toEqual([]);
  await page.getByRole("button", { name: "我的盲评任务", exact: true }).click();
  await page
    .locator(".review-list-item")
    .filter({ hasText: name })
    .first()
    .click();
  await expect(page.getByLabel("答案正确性", { exact: true })).toHaveValue("");
  async function fill(p: Page, incorrect = false) {
    await p
      .getByLabel("答案正确性", { exact: true })
      .selectOption(incorrect ? "INCORRECT" : "CORRECT");
    await p.getByLabel("答案完整性", { exact: true }).selectOption("CORRECT");
    await p.getByLabel("引用支持", { exact: true }).selectOption("SUPPORTED");
    await p.getByLabel("无依据内容", { exact: true }).selectOption("NONE");
    await p.getByLabel("拒答判断", { exact: true }).selectOption("NOT_REFUSED");
    await p
      .getByLabel("评分依据", { exact: true })
      .fill("AUTOMATED MOCK FIXTURE，仅验证评分流程，不计入真人评审。");
  }
  await fill(page);
  await page.getByRole("button", { name: "保存人工评分", exact: true }).click();
  await expect(
    page.getByText("评分已保存，修改历史保留。", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../docs/screenshots/quality-phase3-blind-review-mock.png",
    fullPage: true,
  });
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await bob.goto("/");
  await bob.getByLabel("用户名", { exact: true }).fill("bob");
  await bob.getByLabel("密码", { exact: true }).fill("Bob-demo-123!");
  await bob.getByRole("button", { name: "进入 CiteBase" }).click();
  await bob.getByRole("button", { name: "人工质量评审", exact: true }).click();
  await bob
    .locator(".review-list-item")
    .filter({ hasText: name })
    .first()
    .click();
  await expect(
    bob.getByText("尚未发生人工评分。", { exact: true }),
  ).toBeVisible();
  await fill(bob, true);
  await bob.getByRole("button", { name: "保存人工评分", exact: true }).click();
  await expect(
    bob.getByText("评分已保存，修改历史保留。", { exact: true }),
  ).toBeVisible();
  // Complete the matching second review explicitly through own-score import to exercise authorization.
  const bobToken = await bob.evaluate(() =>
    localStorage.getItem("citebase.token"),
  );
  const bh = { Authorization: `Bearer ${bobToken}` };
  const ownerDetail = await (
    await page.request.get(`/api/reviews/projects/${project.id}`, { headers })
  ).json();
  const ownItem = ownerDetail.assignments.find(
    (a: { id: string }) => a.id === assignment.id,
  ).itemId;
  const bobAssignment = ownerDetail.assignments.find(
    (a: { itemId: string; username: string }) =>
      a.itemId === ownItem && a.username === "bob",
  );
  const score = {
    correctness: "INCORRECT",
    completeness: "CORRECT",
    citationSupport: "SUPPORTED",
    unsupportedContent: "NONE",
    refusal: "NOT_REFUSED",
    rationale: "AUTOMATED MOCK FIXTURE，测试冲突裁决与导入，不是真人判断。",
  };
  await bob.getByLabel("导入本人评分 JSON", { exact: true }).setInputFiles({
    name: "test-only-score.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        scores: [{ assignmentId: bobAssignment.id, ...score }],
      }),
    ),
  });
  await expect(
    bob.getByText("本人评分导入完成。", { exact: true }),
  ).toBeVisible();
  const forbidden = await bob.request.get(
    `/api/reviews/projects/${project.id}`,
    { headers: bh },
  );
  expect([403, 404]).toContain(forbidden.status());
  await page.getByRole("button", { name: "管理评审项目", exact: true }).click();
  await page.locator(".review-list-item").filter({ hasText: name }).click();
  await expect(page.locator(".review-summary")).toContainText("争议 1");
  const target = page.locator(`[data-review-item="${ownItem}"]`);
  await target.locator("summary").click();
  await target.getByRole("button", { name: "复核此答案", exact: true }).click();
  await fill(page);
  await page.getByRole("button", { name: "保存争议裁决", exact: true }).click();
  await expect(
    page.getByText("裁决已保存，原始评分不变。", { exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出评审 JSON", exact: true })
    .click();
  const exported = JSON.parse(
    await readFile((await (await downloadPromise).path())!, "utf8"),
  );
  expect(
    exported.scores.some((s: { kind: string }) => s.kind === "ADJUDICATION"),
  ).toBe(true);
  expect(
    exported.items.every(
      (i: { modelMode: string }) => i.modelMode.toLowerCase() === "mock",
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../docs/screenshots/quality-phase3-owner-review-mock.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "撤销 bob", exact: true }).click();
  await expect(
    page.getByText("已撤销 bob 的评审访问权限。", { exact: true }),
  ).toBeVisible();
  expect([403, 404]).toContain(
    (
      await bob.request.get(`/api/reviews/assignments/${bobAssignment.id}`, {
        headers: bh,
      })
    ).status(),
  );
  await bob.getByRole("button", { name: "刷新评审数据", exact: true }).click();
  await expect(
    bob.locator(".review-list-item").filter({ hasText: name }),
  ).toHaveCount(0);
  await bobContext.close();
  await page.getByRole("button", { name: "我的盲评任务", exact: true }).click();
  await page
    .locator(".review-list-item")
    .filter({ hasText: name })
    .first()
    .click();
  const docs = await (
    await page.request.get(`/api/knowledge-bases/${kb.id}/documents`, {
      headers,
    })
  ).json();
  expect(
    (
      await page.request.delete(`/api/documents/${docs[0].id}`, { headers })
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "刷新评审数据", exact: true }).click();
  await expect(
    page.getByText("此答案已撤回，证据不可访问，也不能继续评分。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存人工评分", exact: true }),
  ).toHaveCount(0);
  const withdrawn = await (
    await page.request.get(`/api/reviews/assignments/${assignment.id}`, {
      headers,
    })
  ).json();
  expect(withdrawn.status).toBe("WITHDRAWN");
  expect(withdrawn).not.toHaveProperty("answer");
  expect(withdrawn).not.toHaveProperty("history");
  await page.screenshot({
    path: "../docs/screenshots/quality-phase3-withdrawn-mock.png",
    fullPage: true,
  });
});

test("评审请求真实网络失败后可重试恢复", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入 CiteBase" }).click();
  await expect(page.locator(".mode")).toContainText("MOCK");
  let failed = false;
  await page.route("**/api/reviews/assignments", async (route) => {
    if (!failed) {
      failed = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "人工质量评审", exact: true }).click();
  await expect(page.locator(".review-workspace [role=alert]")).toBeVisible();
  await page.getByRole("button", { name: "重试加载", exact: true }).click();
  await expect(page.locator(".review-workspace [role=alert]")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "已分配答案", exact: true }),
  ).toBeVisible();
});
