/**
 * Section walls on business events (security review S1): what a reader walled from Finance or the CRM receives of each
 * event, decided once per entry and wall set, and the exhaustive event → section table.
 */
import { EVENTS, type StreamEntry } from "@foundmill/events";
import { EVENT_FIXTURES, fixtureId } from "@foundmill/events/testing/fixtures";
import { EVENT_TYPES, type EventType, type SectionMembership } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { EVENT_WALLS, eventView, membershipChangeOf, viewEvent } from "../walls";
import { BUSINESS_A } from "./helpers";

let seq = 0;
/** One `ev:` stream entry exactly as the outbox relay writes it (`id`, `type`, `json`). */
function entry<T extends EventType>(type: T, payload: Record<string, unknown> = EVENT_FIXTURES[type] as Record<string, unknown>): StreamEntry {
  const id = fixtureId(`walls-${++seq}`);
  const event = { id, businessId: BUSINESS_A, type, occurredAt: "2026-10-12T09:00:00.000Z", actor: { kind: "system", id: "test" }, entityIds: [], payload, narrated: false };
  return { stream: `ev:${BUSINESS_A}`, id: `${seq}-0`, fields: { id, type, json: JSON.stringify(event) } };
}

const member = (sectionPermissions: SectionMembership["sectionPermissions"] = {}): SectionMembership => ({ role: "member", sectionPermissions });
const OPEN = eventView({ role: "owner", sectionPermissions: {} });
const NO_FINANCE = eventView(member({ finance: "none" }));
const NO_CRM = eventView(member({ crm: "none" }));
const NO_INBOX = eventView(member({ inbox: "none" }));

const seen = (e: StreamEntry, view = OPEN) => {
  const json = viewEvent(e, view);
  return json === null ? null : (JSON.parse(json) as { type: string; payload: Record<string, unknown>; redacted?: string[] });
};

describe("event walls", () => {
  it("file every event type under its sections (compile-time and at runtime)", () => {
    expect(Object.keys(EVENT_WALLS).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("hide only fields the event declares (a renamed payload field must not silently stop being hidden)", () => {
    // Walks a Zod schema by dotted path, through optional, nullable and default wrappers.
    const declares = (schema: unknown, path: string[]): boolean => {
      const def = (schema as { _zod?: { def?: { type?: string; innerType?: unknown; shape?: Record<string, unknown> } } })._zod?.def;
      if (!def) return false;
      if (def.innerType) return declares(def.innerType, path);
      if (path.length === 0) return true;
      const [head, ...rest] = path;
      return def.type === "object" && !!def.shape && head! in def.shape && declares(def.shape[head!], rest);
    };
    for (const [type, wall] of Object.entries(EVENT_WALLS) as [EventType, (typeof EVENT_WALLS)[EventType]][]) {
      const hide: Record<string, readonly string[]> = "hide" in wall ? wall.hide : {};
      for (const [section, paths] of Object.entries(hide)) {
        for (const path of paths) expect(declares(EVENTS[type].schema, path.split(".")), `${type} hides ${path} for ${section}`).toBe(true);
      }
    }
  });

  it("a reader without walls gets each event's own JSON, untouched and unparsed", () => {
    for (const type of EVENT_TYPES) {
      const e = entry(type);
      expect(viewEvent(e, OPEN)).toBe(e.fields.json);
    }
    // Members, admins and read-only roles without an explicit "none" are not walled from anything.
    expect(eventView(member()).walled.size).toBe(0);
    expect(eventView({ role: "viewer", sectionPermissions: { finance: "read" } }).walled.size).toBe(0);
  });

  it("a member walled from Finance gets no payment, bank or runway event, and no amount or cost on the others", () => {
    for (const type of ["payment.received", "bank.balance_updated", "runway.threshold_crossed"] as const) expect(seen(entry(type), NO_FINANCE)).toBeNull();
    const note = seen(entry("inbox.item_created", { ...EVENT_FIXTURES["inbox.item_created"], subject: "Cash is £263,345 with 14 months of runway" }), NO_FINANCE)!;
    expect(note.payload).not.toHaveProperty("subject");
    expect(note.payload).not.toHaveProperty("cost");
    expect(note.payload.inboxItemId).toBe(EVENT_FIXTURES["inbox.item_created"].inboxItemId);
    expect(note.redacted).toEqual(["finance"]);
    expect(seen(entry("cycle.completed"), NO_FINANCE)!.payload).not.toHaveProperty("cost");
    expect(seen(entry("campaign.launched"), NO_FINANCE)!.payload).not.toHaveProperty("budget");
    const won = seen(entry("customer.converted"), NO_FINANCE)!;
    expect(won.payload).not.toHaveProperty("amount");
    expect(won.payload).not.toHaveProperty("acquisitionCost");
    const health = seen(entry("agent.health_changed", { ...EVENT_FIXTURES["agent.health_changed"], signals: { budgetRemaining: { amountMinor: 1200, currency: "GBP" }, loopDetected: true } }), NO_FINANCE)!;
    expect(health.payload.signals).toEqual({ loopDetected: true });
    // A negotiation's terms are free text that quotes the price: both go.
    const offer = { ...EVENT_FIXTURES["negotiation.message"], proposal: { price: { amountMinor: 4900, currency: "GBP" }, quantity: 12, terms: ["£49 a seat for 12 months"] } };
    const negotiation = seen(entry("negotiation.message", offer), NO_FINANCE)!;
    expect(negotiation.payload.proposal).toEqual({ quantity: 12 });
    expect(negotiation.redacted).toEqual(["finance"]);
    // Nothing to hide: the event goes through as it was written.
    const progressed = entry("task.progressed");
    expect(viewEvent(progressed, NO_FINANCE)).toBe(progressed.fields.json);
  });

  it("a member walled from the CRM gets payments without the payer, and notes without their subject", () => {
    const payment = entry("payment.received", { ...EVENT_FIXTURES["payment.received"], customer: { externalId: "cus_1", email: "ada@example.com", name: "Ada Lovelace" } });
    const paid = seen(payment, NO_CRM)!;
    expect(paid.payload.amount).toEqual(EVENT_FIXTURES["payment.received"].amount);
    expect(paid.payload).not.toHaveProperty("customer");
    expect(viewEvent(payment, NO_CRM)).not.toContain("ada@example.com");
    expect(paid.redacted).toEqual(["crm"]);
    expect(seen(entry("signup.created", { ...EVENT_FIXTURES["signup.created"], customer: { externalId: null, email: "ada@example.com", name: null } }), NO_CRM)!.payload).not.toHaveProperty("customer");
    expect(seen(entry("inbox.item_created"), NO_CRM)!.payload).not.toHaveProperty("subject");
    expect(seen(entry("lead.replied"), NO_CRM)!.payload).not.toHaveProperty("summary");
  });

  it("a desk conversation belongs to the Inbox or the Team, as the conversation router decides", () => {
    const aboutNote = entry("conversation.message_posted");
    const aboutAgent = entry("conversation.message_posted", { ...EVENT_FIXTURES["conversation.message_posted"], subjectKind: "agent" });
    expect(seen(aboutNote, NO_INBOX)).toBeNull();
    expect(seen(aboutAgent, NO_INBOX)).not.toBeNull();
    expect(seen(aboutAgent, eventView(member({ team: "none" })))).toBeNull();
  });

  it("an event of a type it does not know reaches only readers without walls; a membership-less decision is walled from all", () => {
    const unknown: StreamEntry = { stream: `ev:${BUSINESS_A}`, id: "1-0", fields: { type: "made.up", json: JSON.stringify({ type: "made.up", payload: {} }) } };
    expect(viewEvent(unknown, OPEN)).toBe(unknown.fields.json);
    expect(viewEvent(unknown, NO_FINANCE)).toBeNull();
    expect(seen(entry("mode.changed"), eventView(null))).not.toBeNull();
    expect(seen(entry("task.started"), eventView(undefined))).toBeNull();
  });

  it("decides once per entry and wall set", () => {
    const e = entry("inbox.item_created");
    const first = viewEvent(e, NO_FINANCE);
    expect(viewEvent(e, eventView(member({ finance: "none" })))).toBe(first);
    expect(viewEvent(e, NO_CRM)).not.toBe(first);
  });

  it("reads who a membership change is about", () => {
    expect(membershipChangeOf(entry("membership.changed"))).toBe(EVENT_FIXTURES["membership.changed"].userId);
    expect(membershipChangeOf(entry("mode.changed"))).toBeNull();
  });
});
