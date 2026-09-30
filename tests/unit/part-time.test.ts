import { test } from "node:test";
import assert from "node:assert/strict";
import { gigSchema, incomeSchema, incomeTotals, newGig, parseAmount, type Income } from "../../lib/part-time-contract";

const payment = (patch: Partial<Income> = {}): Income => ({ id: crypto.randomUUID(), amountMinor: 12345, currency: "HKD", status: "received", date: "2026-01-10", period: "", note: "", voided: false, ...patch });
test("income amounts use exact minor units and reject invalid numeric formats", () => {
  assert.equal(parseAmount("0.29"),29); assert.equal(parseAmount("100.1"),10010);
  for (const value of ["", "-10", "0", "1.234", "1e3", "Infinity", "1000000001", "1,000"]) assert.throws(() => parseAmount(value));
});
test("income totals separate currencies, received dates and pending amounts", () => {
  const items = [{ ...newGig("ongoing"), title: "Consultant", archived: true, payments: [payment(), payment({ date:"2025-12-31",amountMinor:1 }), payment({ amountMinor:999, status:"pending" }), payment({ amountMinor:999999,voided:true })] },
    { ...newGig("income"), title:"Bot", payments:[payment({ currency:"USD", amountMinor:2500 })] }];
  assert.deepEqual(incomeTotals(items,"2026-01"),[{currency:"HKD",received:12346,month:12345,pending:999},{currency:"USD",received:2500,month:2500,pending:0}]);
  const received = { ...items[0],payments:[payment({status:"received", amountMinor:999})] };
  assert.equal(incomeTotals([received],"2026-01")[0].pending,0);
  assert.equal(incomeTotals([received],"2026-01")[0].received,999);
});
test("ledger validation rejects duplicate ids, bad dates, unsafe links and future receipts", () => {
  const one=payment();
  const item={...newGig("task"),title:"Research interview",payments:[one]};
  assert(gigSchema.safeParse(item).success);
  assert(!gigSchema.safeParse({...item,payments:[one,one]}).success);
  assert(!gigSchema.safeParse({...item,url:"javascript:alert(1)"}).success);
  for(const patch of [{date:"2026-02-30"},{date:"2999-01-01"},{amountMinor:-1},{amountMinor:1.2},{currency:"JPY",amountMinor:101}]) assert(!incomeSchema.safeParse({...one,...patch}).success);
  assert(incomeSchema.safeParse({...one,date:"2999-01-01",status:"pending"}).success);
  assert(incomeSchema.safeParse({...one,currency:"JPY",amountMinor:100}).success);
});
