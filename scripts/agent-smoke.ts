// Read-only live-model smoke test: all records below are in-memory fixtures, never saved.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { askAi } from "../lib/ai-provider";
import { readAgentData } from "../lib/agent-context";
import { getAiConfig } from "../lib/ai-config";
import { blankEntry, today } from "../lib/model";
import { profileSchema, rubric } from "../lib/enrichment-contract";
import { newGig } from "../lib/part-time-contract";
import { assessWithBuiltin } from "../lib/builtin-enrichment";
import { controlPool, pool, runAsUser } from "../lib/postgres";
import type { AgentSnapshot } from "../lib/agent-contract";
// AI settings and assessment reads are tenant-scoped, so run under a disposable account (#30).
const account = randomUUID();
await controlPool.query("INSERT INTO accounts(id,display_name) VALUES($1,'[agent-smoke] account')", [account]);
try {
  await runAsUser(account, async () => {
    const config = await getAiConfig();
    const job = { ...blankEntry("job"), title: "Agent fixture interview", revision: 1, jd: "Python programming and data analysis internship", organization: "" };
    const gig = { ...newGig(), title: "Agent fixture income", revision: 1, payments: [{ id: "fixture-payment", amountMinor: 30000, currency: "HKD" as const, status: "pending" as const, date: today(), period: "", note: "test fixture", voided: false }] };
    const profile = profileSchema.parse({ background: "Electrical engineering student with Python projects", targets: ["Data analysis"] });
    const agent: AgentSnapshot = { entries: [job], deleted: [], directory: { revision: 1, companies: [{ name: "Fixture Co", website: "https://example.com", logoUrl: "" }], channels: [] }, gigs: [gig], reminders: [], watches: [], profile, scanSettings: { enabled: true, time: "08:00", maxAddPerWatch: 5 }, ai: { base: config.base, model: config.model, revision: config.revision } };
    for (const [name, text, path] of [
      ["appointment", `为 ${job.title} 添加面试：2026年10月5日下午3点新加坡时间，技术面试，地点Zoom。生成待确认提案。`, "/api/desk"],
      ["directory", "请读取公司目录，把 Fixture Co 的官网改成 https://example.org，保留其余资料，生成待确认提案。", "/api/directory"],
      ["income", "把 Agent fixture income 的300港币待收款作废，保留账目供追溯，生成待确认提案。", "/api/part-time"],
    ]) {
      let reads = 0;
      const result = await askAi({ images: [], messages: [{ role: "user", text }] }, agent.entries, { ...agent, agent, profile, pages: [], read: async r => { reads++; return readAgentData(r, agent); } }, undefined, config);
      assert(result.actions?.some(a => a.path === path), `${name}: no expected action; reply=${result.reply}`);
      console.log(JSON.stringify({ test: name, passed: true, reads, actions: result.actions!.length }));
    }
    const result = await assessWithBuiltin({ target: { kind: "job", id: job.id }, name: job.title, job, profile, rubric });
    assert.equal(result.kind, "assessment"); assert.equal(result.model, config.model); assert.equal(result.outlook.score, null);
    console.log(JSON.stringify({ test: "builtin-assessment", passed: true, hasReason: !!result.fit.reason }));
  });
} finally {
  await controlPool.query("DELETE FROM accounts WHERE id=$1", [account]).catch(() => {});
  await pool.end();
}
