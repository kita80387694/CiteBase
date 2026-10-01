import { test, expect } from "@playwright/test";
test("运行状态读取实际数据库、窗口切换与网络失败重试",async({page})=>{
 await page.goto("/");await page.getByRole("button",{name:"进入 CiteBase"}).click();
 const initial=page.waitForResponse(r=>r.url().includes("/api/operations/summary?windowMinutes=60"));
 await page.getByRole("button",{name:"运行状态",exact:true}).click();const response=await initial;expect(response.ok()).toBeTruthy();const data=await response.json();expect(data.scope).toBe("SELF");
 await expect(page.getByRole("region",{name:"个人运行状态"})).toContainText("覆盖多个 worker");
 for(const kind of data.kinds){const label=({INDEX:"文档索引",EVALUATION:"检索评测",AGENT:"Agent 执行"} as Record<string,string>)[kind.kind];const card=page.locator(".operations-card").filter({has:page.getByRole("heading",{name:label,exact:true})});await expect(card).toContainText(`排队 ${kind.queued}`);if(kind.queueLatency.sampleCount===0)await expect(card).toContainText("P95 不可用");}
 const changed=page.waitForResponse(r=>r.url().includes("/api/operations/summary?windowMinutes=5"));await page.getByLabel("统计窗口",{exact:true}).selectOption("5");expect((await changed).ok()).toBeTruthy();
 await page.route("**/api/operations/summary?*",route=>route.abort());await page.getByRole("button",{name:"刷新运行状态",exact:true}).click();await expect(page.getByRole("button",{name:"重试运行状态",exact:true})).toBeVisible();await expect(page.locator(".operations-card")).toHaveCount(0);
 await page.unroute("**/api/operations/summary?*");await page.getByRole("button",{name:"重试运行状态",exact:true}).click();await expect(page.getByRole("heading",{name:"模型调用记录",exact:true})).toBeVisible();
 await page.screenshot({path:"../docs/screenshots/quality-phase3-operations-mock.png",fullPage:true});
});
