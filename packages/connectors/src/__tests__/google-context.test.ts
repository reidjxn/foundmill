import { describe, expect, it } from "vitest";
import { GATEWAY_TOOL_NAMES, resolveGrants } from "../grants";
import { GMAIL_READONLY_SCOPE, withContextReads, type ContextReads } from "../google-context";

const off: ContextReads = { gmail: { on: false, scopes: [GMAIL_READONLY_SCOPE] }, googleCalendar: { on: false } };
const grants = resolveGrants([{ connectorKey: "gmail", tools: ["drafts.create", "drafts.read", "threads.read"] }, { connectorKey: "google_calendar", tools: ["events.list", "events.create"] }, { connectorKey: "stripe", tools: ["*"] }]);

describe("Gmail and Google Calendar as context", () => {
  it("off: no read of the founder's mail or calendar text, writes and free/busy kept", () => {
    const g = withContextReads(grants, off);
    for (const ref of ["gmail:list_drafts", "gmail:get_draft", "gmail:list_messages", "gmail:get_message", "google_calendar:list_events", "google_calendar:get_event"]) expect(g.toolRefs, ref).not.toContain(ref);
    for (const ref of ["gmail:create_draft", "google_calendar:add_event", "google_calendar:find_free_slots", "stripe:*"]) expect(g.toolRefs, ref).toContain(ref);
    expect(g.mcpTools).not.toContain("mcp__gmail__get_draft");
    expect(g.mcpTools).toContain("mcp__gmail__create_draft");
  });

  it("on without gmail.readonly: drafts are read, the inbox is not", () => {
    const g = withContextReads(grants, { gmail: { on: true, scopes: [] }, googleCalendar: { on: true } });
    expect(g.toolRefs).toEqual(expect.arrayContaining(["gmail:list_drafts", "gmail:get_draft", "google_calendar:list_events"]));
    expect(g.toolRefs).not.toContain("gmail:get_message");
    expect(g.mcpTools).not.toContain("mcp__gmail__get_message");
  });

  it("on with gmail.readonly: nothing is taken out", () => {
    const g = withContextReads(grants, { gmail: { on: true, scopes: [GMAIL_READONLY_SCOPE] }, googleCalendar: { on: true } });
    expect(g).toBe(grants);
  });

  it("a wildcard grant is spelled out without the blocked reads", () => {
    const g = withContextReads(resolveGrants([{ connectorKey: "gmail", tools: ["*"] }]), off);
    expect(g.toolRefs).toEqual(GATEWAY_TOOL_NAMES.gmail!.filter((t) => !["list_drafts", "get_draft", "list_messages", "get_message"].includes(t)).map((t) => `gmail:${t}`));
    expect(g.mcpTools).not.toContain("mcp__gmail");
    expect(g.mcpTools).toContain("mcp__gmail__send_message");
  });
});
