// Optional real-model compatibility check. Synthetic context only; no database reads or writes.
import assert from "node:assert/strict";
import { askAi } from "../lib/ai-provider";
import { newGig, type Gig } from "../lib/part-time-contract";
import { today } from "../lib/model";

const baseContext = { reminders: [], watches: [], pages: [], profile: { revision: 0, background: "", goals: "", preferences: "", targets: [], cv: null, cvText: "" } };
async function ask(text: string, gigs: Gig[] = []) {
  return askAi({ workspace: "part-time", messages: [{ role: "user", text }], images: [] }, [], { ...baseContext, gigs });
}
const task = await ask("这是合成测试数据：帮我添加兼职任务‘测试付费调查’，报酬约定 300 港币，今天完成，尚未收款，也不确定什么时候付款。只建立任务。");
assert.equal(task.drafts.length, 0); assert.equal(task.partTime.length, 1);
assert.equal(task.partTime[0].item.type, "task"); assert.equal(task.partTime[0].item.payments.length, 0);
console.log("PASS real model: survey compensation does not create income");
const ongoing = await ask("合成测试：新增‘测试 WorldQuant BRAIN 顾问’长期兼职，正在进行中。暂时没有报酬金额和收款记录。");
assert.equal(ongoing.drafts.length, 0); assert.equal(ongoing.partTime[0].item.type, "ongoing"); assert.equal(ongoing.partTime[0].item.payments.length, 0);
console.log("PASS real model: ongoing consultancy");
const poe: Gig = { ...newGig("income"), id: "synthetic-poe", title: "测试 Poe bot 收入", organization: "Poe", revision: 1 };
const income = await ask("合成测试：给现有‘测试 Poe bot 收入’记一笔今天实际到账的 19.99 美元，结算周期为测试月。", [poe]);
assert.equal(income.partTime[0].item.id, poe.id); assert.equal(income.partTime[0].item.payments[0].amountMinor, 1999);
assert.equal(income.partTime[0].item.payments[0].status, "received"); assert.equal(income.partTime[0].item.payments[0].currency, "USD");
console.log("PASS real model: exact USD receipt on existing platform income");
const pending: Gig = { ...poe, payments: [{ id: "synthetic-payment", amountMinor: 1999, currency: "USD", status: "pending", date: today(), period: "测试月", note: "", voided: false }] };
const settled = await ask("合成测试：现有‘测试 Poe bot 收入’里那笔测试月 19.99 美元待到账款项今天到账了，更新原记录，不要新增。", [pending]);
assert.equal(settled.partTime[0].item.payments.length, 1); assert.equal(settled.partTime[0].item.payments[0].id, "synthetic-payment");
assert.equal(settled.partTime[0].item.payments[0].status, "received");
console.log("PASS real model: pending payment updated without duplicate");
