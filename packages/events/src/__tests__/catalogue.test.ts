import { describe, expect, it } from "vitest";
import { EVENT_TYPES, ValidationError } from "@foundmill/shared";
import {
  DECLARED_EVENT_TYPES,
  EVENTS,
  declareEvent,
  getEventDeclaration,
  isEventOfType,
  isEventType,
  parseEvent,
  parsePayload,
  safeParseEvent,
  serializeEvent,
  toWire,
} from "../catalogue";
import { EVENT_FIXTURES, FIXTURE_BUSINESS_ID, fixtureEvent, fixtureId } from "../testing/fixtures";
import { z } from "zod";

describe("event catalogue", () => {
  it("declares exactly the types in EVENT_TYPES, once each", () => {
    expect([...DECLARED_EVENT_TYPES].sort()).toEqual([...EVENT_TYPES].sort());
    expect(new Set(DECLARED_EVENT_TYPES).size).toBe(EVENT_TYPES.length);
    for (const t of EVENT_TYPES) expect(EVENTS[t].type).toBe(t);
  });

  it("documents every event and names at least one consumer", () => {
    for (const t of EVENT_TYPES) {
      const d = EVENTS[t];
      expect(d.doc.length, `${t} doc`).toBeGreaterThan(20);
      expect(d.consumers.length, `${t} consumers`).toBeGreaterThan(0);
      expect(typeof d.narratable).toBe("boolean");
    }
  });

  it("accepts the fixture payload for every type", () => {
    for (const t of EVENT_TYPES) {
      const r = EVENTS[t].schema.safeParse(EVENT_FIXTURES[t]);
      expect(r.success, `${t}: ${r.success ? "" : z.prettifyError(r.error)}`).toBe(true);
    }
  });

  it("rejects an empty object for every type (no payload is trivially valid)", () => {
    for (const t of EVENT_TYPES) {
      expect(EVENTS[t].schema.safeParse({}).success, t).toBe(false);
    }
  });

  it("rejects wrong money shapes and negative counts", () => {
    const good = EVENT_FIXTURES["payment.received"];
    expect(parsePayload("payment.received", good).amount).toEqual({
      amountMinor: 4900,
      currency: "EUR",
    });
    expect(() =>
      parsePayload("payment.received", { ...good, amount: { amountMinor: 49.5, currency: "EUR" } }),
    ).toThrow(ValidationError);
    expect(() =>
      parsePayload("payment.received", {
        ...good,
        amount: { amountMinor: 4900, currency: "EURO" },
      }),
    ).toThrow(ValidationError);
    expect(() => parsePayload("payment.received", { ...good, amount: 4900 })).toThrow(
      ValidationError,
    );
    expect(() =>
      parsePayload("cycle.completed", { ...EVENT_FIXTURES["cycle.completed"], tasksCompleted: -1 }),
    ).toThrow(ValidationError);
    expect(() =>
      parsePayload("task.progressed", { ...EVENT_FIXTURES["task.progressed"], progress: 1.2 }),
    ).toThrow(ValidationError);
  });

  it("rejects ids that are not UUIDs and enum values outside the shared vocabulary", () => {
    expect(() =>
      parsePayload("task.started", { ...EVENT_FIXTURES["task.started"], taskId: "task-1" }),
    ).toThrow(/taskId/);
    expect(() =>
      parsePayload("lead.created", { ...EVENT_FIXTURES["lead.created"], channelKey: "tiktok" }),
    ).toThrow(/channelKey/);
    expect(() =>
      parsePayload("agent.health_changed", {
        ...EVENT_FIXTURES["agent.health_changed"],
        to: "dead",
      }),
    ).toThrow(/to/);
    expect(() =>
      parsePayload("mode.changed", { scope: "business", from: "assisted", to: "live" }),
    ).toThrow(ValidationError);
    expect(
      parsePayload("mode.changed", { scope: "game", from: "personal", to: "live" }),
    ).toMatchObject({ scope: "game", to: "live", reason: null });
  });

  it("applies defaults for optional nullable fields", () => {
    const p = parsePayload("task.started", {
      taskId: fixtureId("t"),
      kind: "research",
      title: "Competitor scan",
      assigneeAgentId: fixtureId("a"),
    });
    expect(p).toMatchObject({
      sessionId: null,
      roadmapItemId: null,
      workflowId: null,
      branch: null,
    });
  });

  it("parsePayload / getEventDeclaration reject unknown types", () => {
    expect(() => parsePayload("payment.refunded" as never, {})).toThrow(ValidationError);
    expect(() => getEventDeclaration("nope" as never)).toThrow(/Unknown event type/);
    expect(isEventType("payment.received")).toBe(true);
    expect(isEventType("payment.refunded")).toBe(false);
    expect(isEventType(42)).toBe(false);
  });

  it("declareEvent refuses a type outside EVENT_TYPES at runtime", () => {
    expect(() =>
      declareEvent("made.up" as never, z.object({}), { doc: "x", consumers: ["metrics"] }),
    ).toThrow(/not in EVENT_TYPES/);
  });

  it("parseEvent validates the envelope and the payload together and coerces occurredAt to a Date", () => {
    const event = fixtureEvent("payment.received");
    const wire = JSON.parse(serializeEvent(event));
    expect(typeof wire.occurredAt).toBe("string");
    const parsed = parseEvent(wire);
    expect(parsed.occurredAt).toBeInstanceOf(Date);
    expect(parsed.occurredAt.toISOString()).toBe("2026-10-05T09:00:00.000Z");
    expect(parsed).toEqual(event);
    expect(isEventOfType(parsed, "payment.received")).toBe(true);
    if (isEventOfType(parsed, "payment.received"))
      expect(parsed.payload.amount.amountMinor).toBe(4900);
    expect(toWire(event).occurredAt).toBe("2026-10-05T09:00:00.000Z");
  });

  it("parseEvent rejects unknown type, bad envelope and bad payload with distinct messages", () => {
    const base = toWire(fixtureEvent("signup.created"));
    const unknownType = safeParseEvent({ ...base, type: "signup.deleted" });
    expect(unknownType.ok).toBe(false);
    if (!unknownType.ok) expect(unknownType.error.message).toMatch(/envelope/);

    const badBusiness = safeParseEvent({ ...base, businessId: "b1" });
    expect(badBusiness.ok).toBe(false);
    if (!badBusiness.ok) expect(badBusiness.error.message).toMatch(/businessId/);

    const badPayload = safeParseEvent({
      ...base,
      payload: { ...(base.payload as object), consentState: "maybe" },
    });
    expect(badPayload.ok).toBe(false);
    if (!badPayload.ok)
      expect(badPayload.error.message).toMatch(/Invalid payload for signup.created/);

    expect(() => parseEvent({ ...base, occurredAt: "yesterday" })).toThrow(ValidationError);
    expect(() => parseEvent(null)).toThrow(ValidationError);
  });

  it("entityIds default to [] and narrated to false on the envelope", () => {
    const wire = toWire(fixtureEvent("cycle.started")) as Record<string, unknown>;
    delete wire.entityIds;
    delete wire.narrated;
    const parsed = parseEvent(wire);
    expect(parsed.entityIds).toEqual([]);
    expect(parsed.narrated).toBe(false);
    expect(parsed.businessId).toBe(FIXTURE_BUSINESS_ID);
  });
});
