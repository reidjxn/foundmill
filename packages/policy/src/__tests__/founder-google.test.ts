/**
 * The founder's own Gmail and Google Calendar (founder, Nov 19, 2026): sending mail and inviting people ask first in
 * every mode and on vacation; drafts and events with no attendees run; a hard gate still denies.
 */
import { describe, expect, it } from "vitest";
import { BUSINESS_MODES, type BusinessMode } from "@foundmill/shared";
import { evaluate, type AgentCtxInput, type ToolCtxInput } from "../index";

const agent: AgentCtxInput = { id: "agent-1", department: "d", type: "operations_lead", modelKey: "sonnet", approvalThresholdMinor: 25_000, spendCapMinor: 100_000 };
const run = (mode: BusinessMode, t: ToolCtxInput, holiday = false) => evaluate({ principal: agent, tool: t, business: { id: "biz-1", businessMode: mode, holidayActive: holiday, paymentPowers: [] } }).outcome;

const asks: ToolCtxInput[] = [
  { connector: "gmail", name: "send_message", contactsThirdParty: true, irreversible: true },
  { connector: "google_calendar", name: "create_event", contactsThirdParty: true },
  { connector: "google_calendar", name: "update_event", contactsThirdParty: true },
  { connector: "google_calendar", name: "delete_event", contactsThirdParty: true, irreversible: true },
];
const runs: ToolCtxInput[] = [
  { connector: "gmail", name: "create_draft" },
  { connector: "gmail", name: "get_draft" },
  { connector: "google_calendar", name: "add_event" },
  { connector: "google_calendar", name: "list_events" },
];

describe("the founder's own Gmail and Google Calendar", () => {
  it("sending mail and inviting people ask in every mode, on vacation too", () => {
    for (const t of asks) for (const mode of BUSINESS_MODES) for (const holiday of [false, true]) expect(run(mode, t, holiday), `${t.connector}:${t.name} ${mode} ${holiday}`).toBe("ask");
  });

  it("drafts, reads and events with no attendees run in every mode", () => {
    for (const t of runs) for (const mode of BUSINESS_MODES) expect(run(mode, t), `${t.connector}:${t.name} ${mode}`).toBe("allow");
  });

  it("a hard gate still denies", () => {
    expect(run("automated", { connector: "gmail", name: "send_message", hardGate: true })).toBe("deny");
  });

  it("another connector's send is unchanged", () => {
    expect(run("automated", { connector: "sendgrid", name: "send_mail", contactsThirdParty: true })).toBe("allow");
  });
});
