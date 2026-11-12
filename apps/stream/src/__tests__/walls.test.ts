/**
 * Section walls on business events (security review S1): what a reader walled from Finance or the CRM receives of each
 * event, decided once per entry and wall set, and the exhaustive event → section table.
 */
import { EVENTS, type StreamEntry } from "@foundmill/events";
import { EVENT_FIXTURES, fixtureId } from "@foundmill/events/testing/fixtures";
import { ACCOUNT_EVENT_TYPES, EVENT_TYPES, isAccountEventType, isPersonAddressedEvent, PERSON_ADDRESSED_EVENT_TYPES, type BusinessEventType, type EventType, type SectionMembership } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { EVENT_WALLS, eventView, membershipChangeOf, viewAccountEvent, viewEvent } from "../walls";
import { BUSINESS_A, USER_A, USER_B } from "./helpers";

/** The business-scoped types: every type that can be on a business stream at all. */
const BUSINESS_TYPES = EVENT_TYPES.filter((t): t is BusinessEventType => !isAccountEventType(t));

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
  it("file every business-scoped event type under its sections (compile-time and at runtime); an account-scoped type has no place in the table", () => {
    expect(Object.keys(EVENT_WALLS).sort()).toEqual([...BUSINESS_TYPES].sort());
    for (const type of ACCOUNT_EVENT_TYPES) expect(Object.keys(EVENT_WALLS)).not.toContain(type);
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
    for (const [type, wall] of Object.entries(EVENT_WALLS) as [BusinessEventType, (typeof EVENT_WALLS)[BusinessEventType]][]) {
      const hide: Record<string, readonly string[]> = "hide" in wall ? wall.hide : {};
      for (const [section, paths] of Object.entries(hide)) {
        for (const path of paths) expect(declares(EVENTS[type].schema, path.split(".")), `${type} hides ${path} for ${section}`).toBe(true);
      }
    }
  });

  it("a reader without walls gets each event's own JSON, untouched and unparsed", () => {
    for (const type of BUSINESS_TYPES.filter((t) => !isPersonAddressedEvent(t))) {
      const e = entry(type);
      expect(viewEvent(e, OPEN)).toBe(e.fields.json);
    }
    // Members, admins and read-only roles without an explicit "none" are not walled from anything.
    expect(eventView(member()).walled.size).toBe(0);
    expect(eventView({ role: "viewer", sectionPermissions: { finance: "read" } }).walled.size).toBe(0);
  });

  it("a person-addressed event (a founder's network request or message) reaches no reader of a business stream, walls or none (FU-S-2)", () => {
    expect([...PERSON_ADDRESSED_EVENT_TYPES]).toEqual(["connection.requested", "message.received"]);
    const views = [OPEN, NO_FINANCE, NO_CRM, NO_INBOX, eventView(member({ live: "none" })), eventView(null)];
    for (const type of PERSON_ADDRESSED_EVENT_TYPES) {
      const e = entry(type);
      for (const view of views) expect(viewEvent(e, view), `${type} for ${[...view.walled].join(",") || "no walls"}`).toBeNull();
    }
    // Whichever of the entry's fields names the type, and an entry the relay wrote without `type` beside the JSON.
    const message = entry("message.received", { ...EVENT_FIXTURES["message.received"], preview: "Here is the term sheet" });
    const { type: _type, ...untyped } = message.fields;
    expect(viewEvent({ ...message, fields: untyped }, OPEN)).toBeNull();
    expect(viewEvent({ ...message, fields: { ...untyped, json: JSON.stringify({ ...JSON.parse(message.fields.json!), type: "payment.received" }) } }, OPEN)).not.toBeNull();
    // The event next to it is delivered as before.
    expect(seen(entry("cycle.completed"))).not.toBeNull();
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

describe("account events and the walls", () => {
  let n = 0;
  /** One `ae:` stream entry exactly as the account relay writes it (`id`, `type`, `json`). */
  const accountEntry = (userId: string, over: { type?: string; fieldType?: string | null; json?: string; payload?: unknown; id?: unknown } = {}): StreamEntry => {
    const id = fixtureId(`account-walls-${++n}`);
    const type = over.type ?? "profile.published";
    const event = { id: over.id === undefined ? id : over.id, userId, type, occurredAt: "2026-11-12T09:00:00.000Z", actor: { kind: "system", id: "internal-actor-name" }, payload: over.payload === undefined ? { handle: "maya-okafor" } : over.payload };
    const fields: Record<string, string> = { id, json: over.json ?? JSON.stringify(event) };
    if (over.fieldType !== null) fields.type = over.fieldType ?? type;
    return { stream: `ae:${userId}`, id: `${n}-0`, fields };
  };

  it("an account-scoped event reaches no reader of a business stream, walls or none, even the person it is about", () => {
    const views = [OPEN, NO_FINANCE, NO_CRM, NO_INBOX, eventView(null)];
    for (const type of ACCOUNT_EVENT_TYPES) {
      // As a stray writer would put it on `ev:`: the business envelope, the relay's fields.
      const stray = entry(type as EventType);
      // And with the `type` field missing, or naming a harmless type while the JSON says otherwise.
      const untyped: StreamEntry = { ...stray, fields: { id: stray.fields.id!, json: stray.fields.json! } };
      const disguised: StreamEntry = { ...stray, fields: { ...stray.fields, type: "task.started" } };
      for (const view of views) {
        for (const e of [stray, untyped, disguised]) expect(viewEvent(e, view), `${type} for ${[...view.walled].join(",") || "no walls"}`).toBeNull();
      }
    }
    // A business event that only mentions the words in its text is still delivered.
    const mention = entry("task.blocked", { ...(EVENT_FIXTURES["task.blocked"] as Record<string, unknown>), detail: "waiting for profile.published" });
    expect(viewEvent(mention, OPEN)).toBe(mention.fields.json);
  });

  it("the owner of an account channel gets their own account events, cut to the fields a person may read", () => {
    const e = accountEntry(USER_A);
    const seenJson = viewAccountEvent(e, USER_A);
    expect(JSON.parse(seenJson!)).toEqual({ id: e.fields.id, userId: USER_A, type: "profile.published", occurredAt: "2026-11-12T09:00:00.000Z", payload: { handle: "maya-okafor" } });
    expect(seenJson).not.toContain("internal-actor-name");
    expect(viewAccountEvent(e, USER_A.toUpperCase())).toBe(seenJson);
  });

  it("a sign-up a page brought: each of the two people gets their own row on their own channel, and never the other's", () => {
    // The new person is USER_A, the person credited USER_B; one row each, the same public address in both.
    const payload = { sourceKind: "project_page", sourceRef: "bread-by-bike" };
    const arrived = accountEntry(USER_A, { type: "signup.attributed", payload });
    const credited = accountEntry(USER_B, { type: "referral.arrived", payload });
    expect(JSON.parse(viewAccountEvent(arrived, USER_A)!)).toEqual({ id: arrived.fields.id, userId: USER_A, type: "signup.attributed", occurredAt: "2026-11-12T09:00:00.000Z", payload });
    expect(JSON.parse(viewAccountEvent(credited, USER_B)!)).toEqual({ id: credited.fields.id, userId: USER_B, type: "referral.arrived", occurredAt: "2026-11-12T09:00:00.000Z", payload });
    // What the credited person receives holds nothing of the new person, and the actor never leaves.
    expect(viewAccountEvent(credited, USER_B)).not.toContain(USER_A);
    expect(viewAccountEvent(credited, USER_B)).not.toContain("internal-actor-name");
    // Neither row leaves on the other person's channel, even when it was written to that stream.
    expect(viewAccountEvent(arrived, USER_B)).toBeNull();
    expect(viewAccountEvent(credited, USER_A)).toBeNull();
    expect(viewAccountEvent({ ...arrived, stream: `ae:${USER_B}` }, USER_B)).toBeNull();
    expect(viewAccountEvent({ ...credited, stream: `ae:${USER_A}` }, USER_A)).toBeNull();
    // And neither has a line in the business walls: on `ev:` they reach nobody.
    for (const type of ["signup.attributed", "referral.arrived"]) expect(Object.keys(EVENT_WALLS)).not.toContain(type);
  });

  it("nothing else leaves on an account channel: another person's event, a business event, a signal, a mismatch, noise", () => {
    // Another person's account event, whatever stream it sits on.
    expect(viewAccountEvent(accountEntry(USER_B), USER_A)).toBeNull();
    expect(viewAccountEvent({ ...accountEntry(USER_B), stream: `ae:${USER_A}` }, USER_A)).toBeNull();
    // A business-scoped type, even one that names this account as `userId`.
    expect(viewAccountEvent(accountEntry(USER_A, { type: "payment.received" }), USER_A)).toBeNull();
    expect(viewAccountEvent(entry("payment.received"), USER_A)).toBeNull();
    // The entry's `type` field and its JSON must agree.
    expect(viewAccountEvent(accountEntry(USER_A, { fieldType: "profile.unpublished" }), USER_A)).toBeNull();
    expect(viewAccountEvent(accountEntry(USER_A, { fieldType: null }), USER_A)).not.toBeNull();
    // A content-free signal, text that is not JSON, a JSON value that is not an event, an event without an id or a payload object.
    expect(viewAccountEvent({ stream: `ae:${USER_A}`, id: "1-0", fields: { kind: "message_received", json: JSON.stringify({ type: "live.signal", kind: "message_received", at: "2026-11-12T09:00:00.000Z" }) } }, USER_A)).toBeNull();
    expect(viewAccountEvent(accountEntry(USER_A, { json: "{not json" }), USER_A)).toBeNull();
    expect(viewAccountEvent(accountEntry(USER_A, { json: "[1,2]" }), USER_A)).toBeNull();
    expect(viewAccountEvent(accountEntry(USER_A, { payload: "text" }), USER_A)).toBeNull();
    expect(viewAccountEvent(accountEntry(USER_A, { id: null }), USER_A)).toBeNull();
    expect(viewAccountEvent({ stream: `ae:${USER_A}`, id: "2-0", fields: { id: "x" } }, USER_A)).toBeNull();
  });
});
