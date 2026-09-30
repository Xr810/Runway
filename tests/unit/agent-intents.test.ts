import { test } from "node:test";
import assert from "node:assert/strict";
import { requestsCompanyLogoCompletion, routeCompanyLogoCompletion } from "../../lib/agent-intents";
import type { AiReply } from "../../lib/ai-contract";
import { profileSchema } from "../../lib/enrichment-contract";
import { blankEntry } from "../../lib/model";
import { blankWatch } from "../../lib/watches";

const snapshot = {
  entries: [{ ...blankEntry("job"), id: "job-1", organization: "Example" }], deleted: [],
  directory: { revision: 0, companies: [{ name: "Example", website: "", logoUrl: "" }, { name: "Goldman Sachs", website: "https://www.goldmansachs.com", logoUrl: "" }], channels: [] },
  gigs: [], watches: [blankWatch()], reminders: [], profile: profileSchema.parse({}),
  scanSettings: { enabled: true, time: "08:00", maxAddPerWatch: 5 }, ai: { base: "", model: "", revision: 0 },
};
const reply = { reply: "这次联网搜索没有找到可用结果。", model: "m", actions: [], drafts: [], partTime: [], filter: null, matchCount: null, matchIds: null, enrichment: null, reminders: [], profile: null, watches: [], directory: [], scan: null, completeCompanies: null, pages: [] } as unknown as AiReply;

test("explicit company logo completion is routed to the in-product action", () => {
  const prompt = "帮我把公司的图标都补上,你可以websearch";
  assert.equal(requestsCompanyLogoCompletion(prompt), true);
  const result = routeCompanyLogoCompletion(reply, snapshot, prompt);
  assert.match(result.reply, /补全缺失的官网与官方图标/);
  assert.equal(result.actions?.length, 1);
  assert.equal(result.actions?.[0].path, "/api/companies/complete");
  assert.deepEqual(result.actions?.[0].body, { names: undefined, refreshLogo: true });
});

test("unrelated questions keep the model's normal response", () => {
  assert.equal(requestsCompanyLogoCompletion("帮我搜索 Example 的官网"), false);
  assert.equal(routeCompanyLogoCompletion(reply, snapshot, "帮我搜索 Example 的官网"), reply);
});

test("read-only company questions never create a completion action", () => {
  assert.equal(routeCompanyLogoCompletion(reply, snapshot, "只查看 Example 的公司资料，不要修改"), reply);
});

test("named company logo refresh is targeted and replaces stale cached marks",()=>{
  const richer={...snapshot,directory:{...snapshot.directory,companies:[...snapshot.directory.companies,{name:"M-Labs",website:"https://m-labs.hk",logoUrl:""},{name:"Oliver Wyman",website:"https://www.oliverwyman.com",logoUrl:""}]}};
  const result=routeCompanyLogoCompletion(reply,richer,"Mlabs图标依旧不对，重新获取");
  assert.equal(result.actions?.length,1);
  assert.deepEqual(result.actions?.[0].body,{names:["M-Labs"],refreshLogo:true});
  const oliver=routeCompanyLogoCompletion(reply,richer,"Oliver Wyman公司官网资料有问题，帮我修复");
  assert.deepEqual(oliver.actions?.[0].body,{names:["Oliver Wyman"],refreshLogo:false});
  assert.match(oliver.reply,/Oliver Wyman/);
  const repeated=routeCompanyLogoCompletion(reply,richer,"Oliver和Goldman公司补全没有生效");
  assert.deepEqual(repeated.actions?.[0].body,{names:["Goldman Sachs","Oliver Wyman"],refreshLogo:false});
});

test("a shared company word is not treated as a unique alias", () => {
  const richer = { ...snapshot, directory: { ...snapshot.directory, companies: [
    { name: "Acme Research", website: "", logoUrl: "" },
    { name: "Beta Research", website: "", logoUrl: "" },
  ] } };
  const result = routeCompanyLogoCompletion(reply, richer, "Research 图标补全");
  assert.equal(result, reply);
});
