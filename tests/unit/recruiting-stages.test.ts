import test from "node:test";
import assert from "node:assert/strict";
import {
  appointmentSchema,
  normalizeStageStates,
  stageDueDate,
  stageProgress,
} from "../../lib/appointments";
import { blankEntry, entrySchema } from "../../lib/model";
import {
  defaultReminderPreferences,
  reminderPreferencesSchema,
  recruitingReminders,
} from "../../lib/recruiting-reminders";
import { timelineEvents } from "../../lib/journey";

const stage = (patch: Record<string, unknown> = {}) =>
  appointmentSchema.parse({
    id: "round-1",
    title: "Round 1",
    type: "interview",
    startsAt: "2026-09-10T02:00:00Z",
    receivedDate: "2026-09-01",
    ...patch,
  });
const job = () => {
  const entry = blankEntry("job");
  entry.title = "Analyst";
  return entry;
};

test("interview baseline is scheduled held date, not late confirmation", () => {
  const entry = job();
  entry.status = "一面";
  entry.appointments = [stage({ status: "completed", completedAt: "2026-09-11T02:00:00Z" })];
  assert.equal(recruitingReminders([entry])[0].date, "2026-09-17");
});
test("assessment completion starts phase two and deadline override works", () => {
  const entry = job();
  entry.status = "笔试";
  entry.appointments = [
    stage({
      type: "assessment",
      startsAt: "2026-09-12T08:00:00Z",
      deadlineDate: "2026-09-12",
      status: "completed",
      completedAt: "2026-09-05T08:00:00Z",
      reminderBase: "deadline",
      reminderDays: 3,
    }),
  ];
  assert.equal(recruitingReminders([entry])[0].date, "2026-09-15");
  assert.equal(stageProgress(entry.appointments[0], "2026-09-10", "2026-09-15").state, "waiting");
});
test("null inherits, explicit false and zero override defaults", () => {
  const entry = job();
  entry.status = "已投递";
  entry.applied = "2026-10-01";
  entry.applicationReminderDays = 0;
  assert.equal(recruitingReminders([entry], defaultReminderPreferences)[0].date, "2026-10-01");
  entry.applicationRemindersEnabled = false;
  assert.equal(recruitingReminders([entry]).length, 0);
});
test("manual follow-up, offer, next stage, response and cancellation suppress automatic reminder", () => {
  const entry = job();
  entry.status = "一面";
  entry.appointments = [stage({ status: "completed", completedAt: "2026-09-10T02:00:00Z" })];
  entry.followUp = "2026-09-18";
  assert.equal(recruitingReminders([entry]).length, 0);
  entry.followUp = "";
  entry.status = "Offer";
  assert.equal(recruitingReminders([entry]).length, 0);
  entry.status = "二面";
  entry.appointments.push(stage({ id: "round-2", startsAt: "2026-09-20T02:00:00Z" }));
  assert.equal(recruitingReminders([entry]).length, 0);
  entry.appointments[1].status = "cancelled";
  entry.appointments[0].response = "advanced";
  assert.equal(recruitingReminders([entry]).length, 0);
});
test("invalid ordering, future confirmation and early interview attendance are rejected", () => {
  assert.equal(
    appointmentSchema.safeParse({
      ...stage(),
      status: "completed",
      completedAt: "2026-09-09T02:00:00Z",
    }).success,
    false,
  );
  assert.equal(
    appointmentSchema.safeParse({ ...stage(), receivedDate: "2026-09-11" }).success,
    false,
  );
  assert.equal(
    appointmentSchema.safeParse({
      ...stage(),
      status: "completed",
      completedAt: "2099-01-01T00:00:00Z",
    }).success,
    false,
  );
});

test("assessment plan yields to company deadline and switches to feedback after completion", () => {
  const entry = job();
  entry.status = "笔试";
  entry.appointments = [stage({ type: "assessment", startsAt: "", receivedDate: "2026-09-10" })];
  assert.equal(timelineEvents([entry])[0].date, "2026-09-13");
  assert.equal(timelineEvents([entry])[0].label, "测评计划期限");
  assert.equal(entry.appointments[0].deadlineDate, "");
  entry.appointments[0].deadlineDate = "2026-09-15";
  assert.equal(timelineEvents([entry])[0].date, "2026-09-15");
  entry.appointments[0] = stage({
    ...entry.appointments[0],
    status: "completed",
    completedAt: "2026-09-13T00:00:00+08:00",
  });
  assert.equal(timelineEvents([entry])[0].date, "2026-09-20");
  assert.equal(timelineEvents([entry])[0].type, "followup");
  entry.appointments[0].reminderBase = "deadline";
  assert.equal(recruitingReminders([entry])[0].date, "2026-09-22");
  assert.equal(
    appointmentSchema.safeParse({ ...entry.appointments[0], deadlineDate: "2026-99-01" }).success,
    false,
  );
  assert.equal(
    appointmentSchema.safeParse({
      ...entry.appointments[0],
      completedAt: "2026-09-09T12:00:00+08:00",
    }).success,
    false,
  );
});

test("calendar day arithmetic spans leap day and interview offset boundaries", () => {
  const entry = job();
  entry.status = "已投递";
  entry.applied = "2024-02-16";
  assert.equal(recruitingReminders([entry])[0].date, "2024-03-01");
  entry.status = "一面";
  entry.appointments = [
    stage({
      startsAt: "2026-09-15T20:00:00-04:00",
      status: "completed",
      completedAt: "2026-09-17T01:00:00Z",
    }),
  ];
  assert.equal(recruitingReminders([entry])[0].date, "2026-09-23");
});

test("current round is explicit, not inferred from dates, and cancelled rounds cannot revive reminders", () => {
  const entry = job();
  entry.status = "已投递";
  entry.applied = "2026-09-01";
  entry.appointments = [
    stage({ status: "completed", completedAt: "2026-09-11T02:00:00Z" }),
    stage({ id: "assessment", type: "assessment", startsAt: "" }),
  ];
  assert.equal(entrySchema.safeParse(entry).success, false);
  assert.deepEqual(recruitingReminders([entry]), []);
  entry.appointments[0].stageState = "superseded";
  assert.equal(entrySchema.safeParse(entry).success, true);
  entry.appointments[1].status = "cancelled";
  assert.deepEqual(recruitingReminders([entry]), []);
  entry.appointments[1].stageState = "superseded";
  assert.deepEqual(recruitingReminders([entry]), []);
});

test("legacy records with several current stages stay readable, newest stays active", () => {
  const first = stage({ id: "round-1", status: "completed", completedAt: "2026-09-11T02:00:00Z" });
  const second = stage({ id: "round-2", startsAt: "2026-09-20T02:00:00Z" });
  const normalized = normalizeStageStates([first, second]);
  assert.equal(normalized[0].stageState, "superseded");
  assert.equal(normalized[1].stageState, "current");
  assert.equal(normalizeStageStates([{ ...first, stageState: "superseded" }, second]).length, 2);
  assert.deepEqual(normalizeStageStates([second]), [second]);
});
test("progress uses separate pending and feedback intervals without inventing unknown dates", () => {
  const item = stage({
    type: "assessment",
    startsAt: "",
    receivedDate: "2026-09-10",
    deadlineDate: "2026-09-15",
  });
  assert.equal(stageProgress(item, "2026-09-12").percent, 40);
  assert.equal(stageProgress({ ...item, deadlineDate: "" }, "2026-09-12").percent, 67);
  assert.equal(
    stageProgress({ ...item, deadlineDate: "", receivedDate: "" }, "2026-09-12").percent,
    0,
  );
  const completed = {
    ...item,
    status: "completed" as const,
    completedAt: "2026-09-13T00:00:00+08:00",
  };
  assert.equal(stageProgress(completed, "2026-09-15", "2026-09-20").percent, 29);
  assert.equal(stageProgress(completed, "2026-09-15").percent, 0);
  assert.equal(
    stageProgress({ ...completed, response: "advanced", stageState: "superseded" }, "2026-09-15")
      .label,
    "已进入下一阶段",
  );
  assert.equal(
    stageProgress({ ...item, status: "cancelled" }, "2026-09-15").label,
    "已取消 / 未参加",
  );
});

test("assessment plans use configurable calendar days without changing feedback rules", () => {
  const entry = job();
  const item = stage({ type: "assessment", startsAt: "", receivedDate: "2024-02-28" });
  entry.appointments = [item];
  const prefs = reminderPreferencesSchema.parse({
    assessment: { ...defaultReminderPreferences.assessment, planDays: 5 },
  });
  assert.equal(stageDueDate(item), "2024-03-02");
  assert.equal(stageDueDate(item, prefs.assessment.planDays), "2024-03-04");
  assert.equal(timelineEvents([entry], prefs)[0].date, "2024-03-04");
  assert.equal(stageProgress(item, "2024-03-01", undefined, 5).percent, 40);
  assert.equal(stageDueDate({ ...item, receivedDate: "2024-03-01" }, 5), "2024-03-06");
  assert.equal(stageDueDate({ ...item, deadlineDate: "2024-03-10" }, 5), "2024-03-10");
  assert.equal(stageDueDate({ ...item, receivedDate: "" }, 5), "");
  entry.appointments = [{ ...item, status: "completed", completedAt: "2024-02-29T00:00:00+08:00" }];
  assert.equal(timelineEvents([entry], prefs)[0].date, "2024-03-07");
  assert.equal(timelineEvents([entry], prefs)[0].type, "followup");
  assert.equal(
    stageProgress(entry.appointments[0], "2024-03-01", "2024-03-07", 5).state,
    "waiting",
  );
  entry.appointments[0].reminderBase = "deadline";
  assert.deepEqual(
    recruitingReminders([entry], prefs),
    [],
    "a plan is not a company deadline for feedback reminders",
  );
  assert.equal(reminderPreferencesSchema.parse({}).assessment.planDays, 3);
  for (const planDays of [0, 91, 1.5])
    assert.equal(
      reminderPreferencesSchema.safeParse({ assessment: { ...prefs.assessment, planDays } })
        .success,
      false,
    );
  assert.equal(item.deadlineDate, "");
});
