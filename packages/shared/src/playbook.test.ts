import { describe, expect, it } from "vitest";
import { CreatePlaybookParams, describePlaybook, dueSlot, readCompiledPlaybook } from "./playbook";
import { vacationUntilLabel } from "./vacation";

const flow = {
  trigger: { event: "lead.replied" as const, where: { sentiment: "positive" } },
  steps: [{ action: { type: "create_task", params: { title: "Draft a reply" } }, label: "Draft a reply" }, { action: { type: "schedule_meeting", params: {} }, label: "Book a call" }],
  approvals: [{ step: 0, scope: "first_run" as const }],
  stop: {},
};

describe("the playbook contract (audit AC-07)", () => {
  it("accepts a trigger, steps, approvals and stop, and refuses an approval that names a missing step", () => {
    expect(CreatePlaybookParams.safeParse({ source_text: "When a lead replies positively, draft a reply.", ...flow }).success).toBe(true);
    expect(CreatePlaybookParams.safeParse({ source_text: "x", ...flow, trigger: { event: "not.an.event" } }).success).toBe(false);
    // A step is one plan action; a playbook never creates playbooks and a reply is not an action.
    expect(CreatePlaybookParams.safeParse({ source_text: "x", ...flow, steps: [{ action: { type: "create_playbook", params: {} } }] }).success).toBe(false);
    expect(CreatePlaybookParams.safeParse({ source_text: "x", ...flow, steps: [{ action: { type: "reply_only", params: {} } }] }).success).toBe(false);
    // The old orchestrator shape (strings for the trigger and the steps) is not a playbook.
    expect(CreatePlaybookParams.safeParse({ source_text: "x", trigger: "Every time a lead replies", steps: ["Draft a reply"] }).success).toBe(false);
  });

  it("reads the flow in plain words", () => {
    const words = describePlaybook(flow);
    expect(words.when).toBe("When a lead replies (sentiment is positive)");
    expect(words.steps).toEqual([
      { text: "Draft a reply", approval: "You approve the first run" },
      { text: "Book a call", approval: null },
    ]);
    expect(describePlaybook({ ...flow, stop: { max_runs: 1 } }).stop).toBe("Stops after 1 run");
  });

  it("reads rows written before the contract (steps as { type, params }) and refuses what is not a playbook", () => {
    const legacy = { trigger: { event: "payment.received" }, steps: [{ type: "create_task", params: { title: "Thank them" } }], approvals: [], stop: {} };
    expect(readCompiledPlaybook(legacy)?.steps[0]?.action.type).toBe("create_task");
    // A cron string is still not a trigger: a schedule is the `schedule` shape (founder, Nov 25, 2026).
    expect(readCompiledPlaybook({ trigger: { cron: "0 9 * * 1" }, steps: [], approvals: [{ capability: "purchase_order" }], stop: { condition: "x" } })).toBeNull();
    expect(readCompiledPlaybook(null)).toBeNull();
  });
});

describe("scheduled playbooks (founder, Nov 25, 2026)", () => {
  const weekly = { ...flow, trigger: { schedule: { every: "week" as const, weekday: 1, time: "09:00" } } };

  it("accepts every day, week or month, and nothing more often or both kinds at once", () => {
    expect(CreatePlaybookParams.safeParse({ source_text: "Every Monday at 9am, draft the weekly update.", ...weekly }).success).toBe(true);
    expect(CreatePlaybookParams.safeParse({ source_text: "x", ...flow, trigger: { schedule: { every: "day", time: "17:30" } } }).success).toBe(true);
    expect(CreatePlaybookParams.safeParse({ source_text: "x", ...flow, trigger: { schedule: { every: "month", day_of_month: 1, time: "08:00" } } }).success).toBe(true);
    expect(CreatePlaybookParams.safeParse({ source_text: "x", ...flow, trigger: { schedule: { every: "hour", time: "09:00" } } }).success).toBe(false);
    expect(CreatePlaybookParams.safeParse({ source_text: "x", ...flow, trigger: { schedule: { every: "week", time: "09:00" } } }).success).toBe(false);
    expect(CreatePlaybookParams.safeParse({ source_text: "x", ...flow, trigger: { schedule: { every: "month", day_of_month: 31, time: "09:00" } } }).success).toBe(false);
    expect(CreatePlaybookParams.safeParse({ source_text: "x", ...flow, trigger: { schedule: { every: "day", time: "9am" } } }).success).toBe(false);
    expect(CreatePlaybookParams.safeParse({ source_text: "x", ...flow, trigger: { event: "lead.replied", schedule: { every: "day", time: "09:00" } } }).success).toBe(false);
    expect(CreatePlaybookParams.safeParse({ source_text: "x", ...flow, trigger: {} }).success).toBe(false);
  });

  it("reads back in US English with US times", () => {
    expect(describePlaybook(weekly).when).toBe("Every Monday at 9:00 AM");
    expect(describePlaybook({ ...flow, trigger: { schedule: { every: "day", time: "17:30" } } }).when).toBe("Every day at 5:30 PM");
    expect(describePlaybook({ ...flow, trigger: { schedule: { every: "month", day_of_month: 2, time: "00:15" } } }).when).toBe("On the 2nd of every month at 12:15 AM");
  });

  it("comes due once, in the project's time zone, within the window", () => {
    const hour = 3_600_000;
    const s = weekly.trigger.schedule;
    // Mon, Nov 23, 2026, 9:00 AM in New York is 14:00 UTC.
    expect(dueSlot(s, new Date("2026-11-23T14:10:00Z"), "America/New_York", hour)?.toISOString()).toBe("2026-11-23T14:00:00.000Z");
    expect(dueSlot(s, new Date("2026-11-23T13:59:00Z"), "America/New_York", hour)).toBeNull();
    expect(dueSlot(s, new Date("2026-11-23T15:00:00Z"), "America/New_York", hour)).toBeNull();
    expect(dueSlot(s, new Date("2026-11-24T14:10:00Z"), "America/New_York", hour)).toBeNull();
    // No zone, or one that is not a zone: UTC.
    expect(dueSlot(s, new Date("2026-11-23T09:05:00Z"), null, hour)?.toISOString()).toBe("2026-11-23T09:00:00.000Z");
    expect(dueSlot(s, new Date("2026-11-23T09:05:00Z"), "Mars/Base", hour)?.toISOString()).toBe("2026-11-23T09:00:00.000Z");
    // A late-evening time is still found just after midnight.
    expect(dueSlot({ every: "day", time: "23:50" }, new Date("2026-11-24T00:10:00Z"), "UTC", hour)?.toISOString()).toBe("2026-11-23T23:50:00.000Z");
  });
});

describe("vacationUntilLabel (audit VOL-X2)", () => {
  it("never doubles the word the top bar adds", () => {
    expect(vacationUntilLabel("until I return")).toBe("you return");
    expect(vacationUntilLabel("I return")).toBe("you return");
    expect(vacationUntilLabel(null)).toBe("you return");
    expect(vacationUntilLabel("when the launch ships or runway drops under 8 months")).toBe("the launch ships or runway drops under 8 months");
    expect(vacationUntilLabel("the first customer pays")).toBe("the first customer pays");
  });
});
