/**
 * The founder's own Gmail and Google Calendar: mail and invitations to outside people run from the first message in
 * assisted and automated mode (founder, Nov 23, 2026: "if the someone new is external ... the agents should be able to
 * reach out on their own from the start"); augmented mode asks for every outside contact; a hard gate still denies.
 */
import { describe, expect, it } from "vitest";
import { BUSINESS_MODES, type BusinessMode } from "@foundmill/shared";
import { evaluate, type AgentCtxInput, type ToolCtxInput } from "../index";

const agent: AgentCtxInput = { id: "agent-1", department: "d", type: "operations_lead", modelKey: "sonnet", approvalThresholdMinor: 25_000, spendCapMinor: 100_000 };
const run = (mode: BusinessMode, t: ToolCtxInput, holiday = false) => evaluate({ principal: agent, tool: t, business: { id: "biz-1", businessMode: mode, holidayActive: holiday, paymentPowers: [] } }).outcome;

const sends: ToolCtxInput[] = [
  { connector: "gmail", name: "send_message", contactsThirdParty: true },
  { connector: "google_calendar", name: "create_event", contactsThirdParty: true },
  { connector: "google_calendar", name: "update_event", contactsThirdParty: true },
];
const runs: ToolCtxInput[] = [
  { connector: "gmail", name: "create_draft" },
  { connector: "gmail", name: "get_draft" },
  { connector: "google_calendar", name: "add_event" },
  { connector: "google_calendar", name: "list_events" },
];

describe("the founder's own Gmail and Google Calendar", () => {
  it("mail and invitations run in assisted and automated mode, on vacation too, and ask in augmented mode", () => {
    for (const t of sends) {
      for (const holiday of [false, true]) {
        expect(run("assisted", t, holiday), `${t.name} assisted ${holiday}`).toBe("allow");
        expect(run("automated", t, holiday), `${t.name} automated ${holiday}`).toBe("allow");
      }
      expect(run("augmented", t), `${t.name} augmented`).toBe("ask");
    }
  });

  it("a cancellation attendees cannot get back still asks in assisted mode", () => {
    expect(run("assisted", { connector: "google_calendar", name: "delete_event", contactsThirdParty: true, irreversible: true })).toBe("ask");
  });

  it("drafts, reads and events with no attendees run in every mode", () => {
    for (const t of runs) for (const mode of BUSINESS_MODES) expect(run(mode, t), `${t.connector}:${t.name} ${mode}`).toBe("allow");
  });

  it("a hard gate still denies", () => {
    expect(run("automated", { connector: "gmail", name: "send_message", hardGate: true })).toBe("deny");
  });
});
