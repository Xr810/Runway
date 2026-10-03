import {test} from "node:test";
import assert from "node:assert/strict";
import {blankEntry,defaultJobDeadline,defaultNextAction,normalizeLegacyNextAction,validCalendarDate} from "../../lib/model";

test("only real calendar dates pass validation",()=>{
 for(const value of ["2026-02-28","2026-12-31","2000-02-29"]) assert(validCalendarDate(value),value);
 for(const value of ["2026-13-01","2026-02-30","2026-04-31","2026-2-3","","2026-13-40","not-a-date"]) assert(!validCalendarDate(value),value);
});

test("unknown job deadlines stay unknown instead of being invented",()=>{
 const job={...blankEntry("job"),nextAction:"2026-09-28 收到的笔记（无明确截止日期）"};
 assert.equal(defaultJobDeadline(job,new Date("2026-09-29T02:00:00Z")),"");
 assert.equal(defaultJobDeadline({...job,deadline:"2026-10-10"},new Date("2026-09-29T02:00:00Z")),"2026-10-10");
 assert.equal(defaultJobDeadline({...job,nextAction:""},new Date("2026-09-29T02:00:00Z")),"");
});

test("legacy notification prose normalizes into the selected job stage",()=>{
 assert.equal(normalizeLegacyNextAction("笔试","尽快处理 2026-09-28 收到的笔记（无明确截止日期）"),"笔试");
 assert.equal(defaultNextAction("一面"),"一面");
 assert.equal(normalizeLegacyNextAction("已投递","其他事项"),"");
});
