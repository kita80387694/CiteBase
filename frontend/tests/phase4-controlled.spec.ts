import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('固定本机故障适配器：部分检查点、取消、导出和显式恢复', async ({ page }) => {
  test.skip(process.env.E2E_PROCESS_GATE !== '1', 'Requires actual two-JVM test-only gate harness');
  const gate = 'http://127.0.0.1:39555';
  const stamp = Date.now(), name = `Phase4GateUI-${stamp}`, marker = `P4_GATE_UI_${stamp}`;
  await page.goto('/');
  await page.getByRole('button', { name: '进入 CiteBase' }).click();
  await expect(page.locator('.mode')).toContainText('MOCK');
  page.once('dialog', d => d.accept(name));
  await page.getByRole('button', { name: '新建知识库' }).click();
  await expect(page.locator('#knowledge-base option:checked')).toHaveText(name);
  const kbId = await page.locator('#knowledge-base').inputValue();
  const token = await page.evaluate(() => localStorage.getItem('citebase.token'));
  const headers = { Authorization: `Bearer ${token}` };
  const documentName = `${name}.md`, quote = 'CiteBase 恢复规则是保留已完成检查点，仅继续未完成工作。';
  await page.locator('input[type=file]').setInputFiles({ name: documentName, mimeType: 'text/markdown', buffer: Buffer.from(quote) });
  await expect(page.getByRole('row').filter({ hasText: documentName }).getByText('成功', { exact: true })).toBeVisible({ timeout: 60000 });
  expect((await page.request.post(`${gate}/rules`, { data: { rules: [{ operation: 'generation', marker, skip: 1, remaining: 1, action: 'hold' }] } })).ok()).toBe(true);
  const created = await page.request.post('/api/evaluations', { headers, data: {
    kbId, name, idempotencyKey: `gate-ui-${stamp}`, topK: 3,
    dataset: { version: 'process-ui-v1', questions: [{ id: marker, question: `CiteBase 恢复规则是什么？ ${marker}`, answerable: true, expectedAnswer: '保留已完成检查点', evidence: [{ documentName, page: 1, paragraph: 1, quote, groupId: 'rule' }] }] }
  } });
  expect(created.status()).toBe(202); const run = await created.json();
  let heldId = '';
  await expect.poll(async () => { const s = await (await page.request.get(`${gate}/state`)).json(); heldId = s.calls.find((c: any) => c.marker === marker && c.state === 'HELD')?.id || ''; return !!heldId; }, { timeout: 60000 }).toBe(true);
  await page.getByRole('button', { name: '处理任务', exact: true }).click();
  const task = page.locator(`[data-task-id="${run.id}"]`);
  await expect(task).toContainText('1 / 2');
  await task.getByRole('button', { name: '取消任务', exact: true }).click();
  expect((await page.request.post(`${gate}/release`, { data: { ids: [heldId] } })).ok()).toBe(true);
  await expect(task.locator('.badge')).toHaveText('已取消', { timeout: 60000 });
  await task.getByRole('button', { name: '任务详情', exact: true }).click();
  await expect(page.locator('.task-details')).toContainText('externalCalls');
  const download = page.waitForEvent('download');
  await task.getByRole('button', { name: '导出已保存结果', exact: true }).click();
  const partial = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(partial.taskStatus).toBe('CANCELLED'); expect(partial.partial).toBe(true);
  expect(partial.results).toHaveLength(1); expect(partial.pendingItems).toHaveLength(1);
  const checkpoint = JSON.stringify(partial.results[0]);
  await page.screenshot({ path: '../docs/screenshots/phase4-controlled-cancel.png', fullPage: true });
  await task.getByRole('button', { name: '重试任务', exact: true }).click();
  await expect(task.locator('.badge')).toHaveText('任务完成', { timeout: 60000 });
  await expect(task).toContainText('恢复代次 1');
  const final = await (await page.request.get(`/api/evaluations/${run.id}/export`, { headers })).json();
  expect(final.partial).toBe(false); expect(final.results).toHaveLength(2);
  expect(final.results.map((r: any) => JSON.stringify(r))).toContain(checkpoint);
  await page.screenshot({ path: '../docs/screenshots/phase4-controlled-resume.png', fullPage: true });
});
