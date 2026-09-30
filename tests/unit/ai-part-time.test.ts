import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareAiReply } from "../../lib/ai-contract";
import { gigDraftAlreadySaved, gigDraftWarnings } from "../../lib/ai-part-time";
import { newGig, type Gig, type Income } from "../../lib/part-time-contract";
import { today } from "../../lib/model";

const payment: Income = { id: "pay-1", amountMinor: 1999, currency: "USD", status: "pending", date: today(), period: "2026-09", note: "original", voided: false };
const existing: Gig = { ...newGig("income"), id: "poe", title: "Poe bot 收入", revision: 3, notes: "Keep me", payments: [payment] };
const prepare = (proposals: unknown[], gigs: Gig[] = []) => prepareAiReply({ reply: "待确认", partTime: proposals }, [], [], "fixture", { reminders: [], watches: [], gigs }).partTime;

test("task, ongoing work and platform income proposals remain separate from job records", () => {
  for (const type of ["task", "ongoing", "income"] as const) {
    const reply = prepareAiReply({ reply: "待确认", partTime: [{ operation: "add", fields: { title: "调查", type, compensation: "报酬 300 港币" } }] }, [], [], "fixture");
    assert.equal(reply.drafts.length, 0); assert.equal(reply.partTime[0].item.type, type);
    assert.equal(reply.partTime[0].item.payments.length, 0); assert.equal(reply.partTime[0].item.revision, 0);
  }
});
test("add income converts decimal strings exactly and generates stable server-owned IDs", () => {
  const [draft] = prepare([{ operation: "update", targetId: "poe", payments: [{ operation: "add", fields: { amount: "0.29", currency: "USD", status: "received", date: today() } }] }], [existing]);
  assert.equal(draft.item.payments[1].amountMinor, 29); assert.notEqual(draft.item.payments[1].id, payment.id);
  assert.deepEqual(draft.item.payments[0], payment); assert.equal(draft.item.notes, "Keep me"); assert.equal(draft.item.revision, 3);
});
test("marking a pending payment received updates the original instead of adding another", () => {
  const [draft] = prepare([{ operation: "update", targetId: "poe", fields: { nextAction: "继续维护" }, payments: [{ operation: "update", targetId: payment.id, fields: { status: "received", date: today() } }] }], [existing]);
  assert.equal(draft.item.payments.length, 1); assert.equal(draft.item.payments[0].id, payment.id);
  assert.equal(draft.item.payments[0].amountMinor, 1999); assert.equal(draft.item.payments[0].note, "original");
  assert.equal(draft.payments[0].before?.status, "pending"); assert.equal(draft.payments[0].payment.status, "received");
  assert.equal(existing.payments[0].status, "pending");
});
test("invalid amounts, unspecified payment facts and future receipts cannot become drafts", () => {
  const fields = { amount: "19.99", currency: "USD", status: "received", date: today() };
  for (const patch of [{ amount: "-10" }, { amount: "1e3" }, { amount: "1.234" }, { amount: 2000 }, { currency: "JPY" }, { status: undefined }, { date: "2099-01-01" }, { date: "2026-02-30" }, { currency: undefined }]) {
    assert.throws(() => prepare([{ operation: "update", targetId: "poe", payments: [{ operation: "add", fields: { ...fields, ...patch } }] }], [existing]));
  }
});
test("AI cannot change IDs, revisions, archive records, erase payments or void payments", () => {
  for (const fields of [{ id: "other" }, { revision: 99 }, { archived: true }, { payments: [] }]) assert.throws(() => prepare([{ operation: "update", targetId: "poe", fields }], [existing]));
  assert.throws(() => prepare([{ operation: "update", targetId: "poe", payments: [{ operation: "update", targetId: payment.id, fields: { voided: true } }] }], [existing]));
});
test("missing, archived, ambiguous repeated targets and voided payments are rejected", () => {
  const update = { operation: "update", targetId: "poe", fields: { status: "进行中" } };
  assert.throws(() => prepare([update])); assert.throws(() => prepare([update, update], [existing]));
  assert.throws(() => prepare([update], [{ ...existing, archived: true }]));
  const pay = { operation: "update", targetId: payment.id, fields: { status: "received" } };
  assert.throws(() => prepare([{ ...update, payments: [pay, pay] }], [existing]));
  assert.throws(() => prepare([{ ...update, payments: [pay] }], [{ ...existing, payments: [{ ...payment, voided: true }] }]));
  assert.throws(() => prepare([{ ...update, payments: [{ ...pay, targetId: "unknown" }] }], [existing]));
});
test("duplicate warnings cover existing records, response batches and payment status changes", () => {
  const add = { operation: "add", fields: { title: "Poe bot 收入", type: "income" } };
  assert(prepare([add], [existing])[0].warnings.length);
  assert(prepare([add, add]).every(p => p.warnings.length));
  const [draft] = prepare([{ operation: "update", targetId: "poe", payments: [{ operation: "add", fields: { amount: "19.99", currency: "USD", status: "received", date: today(), period: "2026-09" } }] }], [existing]);
  assert(draft.warnings.length);
  const [fresh] = prepare([add]); assert.equal(fresh.warnings.length, 0); assert(gigDraftWarnings(fresh, [existing]).length);
});
test("confirmation recovers lost save replies but rejects stale edits and missing records", () => {
  const [draft] = prepare([{ operation: "update", targetId: "poe", fields: { nextAction: "维护" } }], [existing]);
  assert.equal(gigDraftAlreadySaved(draft, [existing]), false);
  assert.equal(gigDraftAlreadySaved(draft, [{ ...draft.item, revision: 4 }]), true);
  const reordered = { ...draft.item, revision: 4, payments: draft.item.payments.map(p => Object.fromEntries(Object.entries(p).reverse()) as Income) };
  assert.equal(gigDraftAlreadySaved(draft, [reordered]), true);
  assert.throws(() => gigDraftAlreadySaved(draft, [{ ...existing, revision: 4, notes: "Changed elsewhere" }]));
  assert.throws(() => gigDraftAlreadySaved(draft, []));
  const [add] = prepare([{ operation: "add", fields: { title: "调查" } }]);
  assert.equal(gigDraftAlreadySaved(add, []), false); assert.equal(gigDraftAlreadySaved(add, [{ ...add.item, revision: 1 }]), true);
});
