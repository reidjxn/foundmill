/**
 * Founder-executed tools and ask-always tools (founder, 2026-11-22). A founder-executed tool is denied for every agent
 * call in every mode, vacation included, whatever else permits it, and runs only with `context.founderPress`. An
 * ask-always tool asks in every mode, automated mode and vacation included, even with the inbound payment power.
 */
import { describe, expect, it } from "vitest";
import { BUSINESS_MODES, type BusinessMode } from "@foundmill/shared";
import { evaluate, type AgentCtxInput, type ToolCtxInput } from "../index";

const agent: AgentCtxInput = { id: "agent-1", department: "d", type: "legal_lead", modelKey: "sonnet", approvalThresholdMinor: 25_000, spendCapMinor: 100_000 };
const request: ToolCtxInput = { connector: "lightbringer_mcp", name: "request_patent_preparation", contactsThirdParty: true, irreversible: true, founderExecuted: true };
const reply: ToolCtxInput = { connector: "lightbringer_mcp", name: "reply_to_comment", contactsThirdParty: true, irreversible: true, askAlways: true };
const draft: ToolCtxInput = { connector: "lightbringer_mcp", name: "update_innovation" };
const run = (mode: BusinessMode, tool: ToolCtxInput, opts: { holiday?: boolean; press?: boolean; autonomy?: AgentCtxInput["autonomy"] } = {}) =>
  evaluate({ principal: { ...agent, ...(opts.autonomy ? { autonomy: opts.autonomy } : {}) }, tool, business: { id: "biz-1", businessMode: mode, holidayActive: opts.holiday ?? false, paymentPowers: ["inbound"] }, context: { founderPress: opts.press ?? false } });

describe("founder-executed tools", () => {
  it("are denied for an agent call in every mode, on vacation, and with any autonomy override", () => {
    for (const mode of BUSINESS_MODES) for (const holiday of [false, true]) {
      const r = run(mode, request, { holiday });
      expect(r.outcome, `${mode} holiday=${holiday}`).toBe("deny");
      expect(r.policyIds).toContain("founder-executed");
    }
    for (const autonomy of BUSINESS_MODES) expect(run("assisted", request, { autonomy }).outcome, autonomy).toBe("deny");
  });

  it("run only from the founder's press, in every mode, without asking again", () => {
    for (const mode of BUSINESS_MODES) for (const holiday of [false, true]) {
      const r = run(mode, { connector: "lightbringer_mcp", name: "request_patent_preparation", founderExecuted: true }, { holiday, press: true });
      expect(r.outcome, `${mode} holiday=${holiday}`).toBe("allow");
    }
  });

  it("a press never lifts another tool's own rules: a hard gate stays denied", () => {
    expect(run("automated", { connector: "x", name: "y", hardGate: true, founderExecuted: false }, { press: true }).outcome).toBe("deny");
  });
});

describe("ask-always tools", () => {
  it("ask in every mode, automated and vacation included, even with the inbound payment power", () => {
    for (const mode of BUSINESS_MODES) for (const holiday of [false, true]) {
      const r = run(mode, reply, { holiday });
      expect(r.outcome, `${mode} holiday=${holiday}`).toBe("ask");
      expect(r.policyIds).toContain("ask-always");
    }
  });

  it("the same hints without askAlways would run in automated mode, and a quiet draft runs everywhere", () => {
    const { askAlways: _drop, ...plain } = reply;
    expect(run("automated", plain).outcome).toBe("allow");
    for (const mode of BUSINESS_MODES) expect(run(mode, draft).outcome, mode).toBe("allow");
  });
});
