import { describe, expect, it } from "vitest";
import { CreatePlaybookParams, describePlaybook, readCompiledPlaybook } from "./playbook";
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
    expect(readCompiledPlaybook({ trigger: { cron: "0 9 * * 1" }, steps: [], approvals: [{ capability: "purchase_order" }], stop: { condition: "x" } })).toBeNull();
    expect(readCompiledPlaybook(null)).toBeNull();
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
