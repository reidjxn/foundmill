import { describe, expect, it } from "vitest";
import { EVENT_TYPES, GUIDANCE_EVENT_TYPES, isPersonAddressedEvent, PERSON_ADDRESSED_EVENT_TYPES, ValidationError } from "@foundmill/shared";
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
import { EVENT_FIXTURES, FIXTURE_AGENT_ID, FIXTURE_BUSINESS_ID, fixtureEvent, fixtureId } from "../testing/fixtures";
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

  it("foundations.progressed: a step of a drafting attempt with its counts, internal and pushed to open tabs (audit P3)", () => {
    const decl = EVENTS["foundations.progressed"];
    expect(decl.narratable).toBe(false);
    expect(decl.consumers).toContain("stream");
    const vision = parsePayload("foundations.progressed", { attempt: 2, step: "vision", sectionsDone: 0, sectionsTotal: 11, roadmapItems: 0, visionReady: true });
    expect(vision).toEqual({ attempt: 2, step: "vision", section: null, sectionsDone: 0, sectionsTotal: 11, roadmapItems: 0, visionReady: true });
    expect(parsePayload("foundations.progressed", EVENT_FIXTURES["foundations.progressed"]).section).toBe("Pricing");
    const bad = (patch: Record<string, unknown>) => () => parsePayload("foundations.progressed", { ...EVENT_FIXTURES["foundations.progressed"], ...patch });
    expect(bad({ attempt: 0 })).toThrow(ValidationError);
    expect(bad({ step: "finished" })).toThrow(ValidationError);
    expect(bad({ sectionsDone: -1 })).toThrow(ValidationError);
    expect(bad({ section: "" })).toThrow(ValidationError);
    expect(bad({ visionReady: "yes" })).toThrow(ValidationError);
  });

  it("connection.requested and message.received: addressed to a person, never narrated or consumed by a business (FU-S-2, audit #65)", () => {
    expect([...PERSON_ADDRESSED_EVENT_TYPES].sort()).toEqual(["connection.requested", "message.received"]);
    for (const type of PERSON_ADDRESSED_EVENT_TYPES) {
      const decl = EVENTS[type];
      expect(decl.narratable, type).toBe(false);
      // No business consumer reads them: the composer never narrates them and no playbook can be triggered by a founder's private traffic.
      expect(decl.consumers, type).toEqual(["stream"]);
      expect(decl.doc, type).toMatch(/never written to any business/);
    }
    // Every other event type is a business's.
    expect(EVENT_TYPES.filter(isPersonAddressedEvent).sort()).toEqual([...PERSON_ADDRESSED_EVENT_TYPES].sort());
    expect(() => parsePayload("message.received", { ...EVENT_FIXTURES["message.received"], preview: "x".repeat(281) })).toThrow(ValidationError);
  });

  it("business.updated: the settings fields a save changed, pushed to open tabs, never narrated (audit RES-07)", () => {
    const decl = EVENTS["business.updated"];
    expect(decl.consumers).toEqual(["stream"]);
    expect(decl.narratable).toBe(false);
    expect(parsePayload("business.updated", { fields: ["name"] }).fields).toEqual(["name"]);
    expect(() => parsePayload("business.updated", { fields: [] })).toThrow(ValidationError);
    expect(() => parsePayload("business.updated", { fields: ["planTier"] })).toThrow(ValidationError);
  });

  it("conversation.message_posted: a desk message for stream and metrics, never narrated (audit-conversation §4)", () => {
    const decl = EVENTS["conversation.message_posted"];
    expect(decl.narratable).toBe(false);
    expect([...decl.consumers].sort()).toEqual(["metrics", "stream"]);
    const founder = parsePayload("conversation.message_posted", { ...EVENT_FIXTURES["conversation.message_posted"], author: "founder", quickReplyIds: undefined, chosenQuickReplyId: "why_that_one" });
    expect(founder).toMatchObject({ author: "founder", quickReplyIds: [], chosenQuickReplyId: "why_that_one", handOff: false });
    const bad = (patch: Record<string, unknown>) => () => parsePayload("conversation.message_posted", { ...EVENT_FIXTURES["conversation.message_posted"], ...patch });
    expect(bad({ preview: "x".repeat(141) })).toThrow(ValidationError);
    expect(bad({ subjectKind: "concept" })).toThrow(ValidationError);
    expect(bad({ author: "system" })).toThrow(ValidationError);
    expect(bad({ quickReplyIds: ["a", "b", "c", "d", "e"] })).toThrow(ValidationError);
    expect(bad({ quickReplyIds: ["Not An Id"] })).toThrow(ValidationError);
  });

  it("membership.changed: who and what kind of change, for apps/stream only, never narrated (security review S1)", () => {
    const decl = EVENTS["membership.changed"];
    expect(decl.narratable).toBe(false);
    expect([...decl.consumers]).toEqual(["stream"]);
    expect(parsePayload("membership.changed", EVENT_FIXTURES["membership.changed"])).toEqual({ userId: EVENT_FIXTURES["membership.changed"].userId, change: "updated" });
    const bad = (patch: Record<string, unknown>) => () => parsePayload("membership.changed", { ...EVENT_FIXTURES["membership.changed"], ...patch });
    expect(bad({ userId: "someone" })).toThrow(ValidationError);
    expect(bad({ change: "promoted" })).toThrow(ValidationError);
  });

  it("agent.message_sent: a typed message between agents (BUILD §9.9), never narrated", () => {
    const decl = EVENTS["agent.message_sent"];
    expect(decl.narratable).toBe(false);
    expect([...decl.consumers].sort()).toEqual(["metrics", "stream"]);
    const outside = parsePayload("agent.message_sent", { ...EVENT_FIXTURES["agent.message_sent"], sessionId: undefined, taskId: undefined });
    expect(outside).toMatchObject({ type: "request", sessionId: null, taskId: null });
    const bad = (patch: Record<string, unknown>) => () => parsePayload("agent.message_sent", { ...EVENT_FIXTURES["agent.message_sent"], ...patch });
    expect(bad({ type: "chat" })).toThrow(ValidationError);
    expect(bad({ subject: "" })).toThrow(ValidationError);
    expect(bad({ body: "x".repeat(4001) })).toThrow(ValidationError);
    expect(bad({ toAgentId: "not-an-id" })).toThrow(ValidationError);
  });

  it("guidance.*: the guided layer's product signals, for metrics only, never narrated (UX plan §11)", () => {
    for (const t of GUIDANCE_EVENT_TYPES) {
      expect(EVENTS[t].narratable, t).toBe(false);
      expect(EVENTS[t].consumers, t).toEqual(["metrics"]);
    }
    // Tours by id, with the step a founder left on.
    expect(parsePayload("guidance.tour_skipped", { tourId: "inbox", atStep: 2, steps: 4 })).toEqual({ tourId: "inbox", atStep: 2, steps: 4 });
    expect(() => parsePayload("guidance.tour_completed", { tourId: "", steps: 4 })).toThrow(ValidationError);
    expect(() => parsePayload("guidance.tour_skipped", { tourId: "home", atStep: 0, steps: 4 })).toThrow(ValidationError);
    // A term by its TERMS id, never by the display word a glossary may rename; the screen defaults to null.
    expect(parsePayload("guidance.term_opened", { termId: "net_burn" })).toEqual({ termId: "net_burn", screenId: null });
    expect(() => parsePayload("guidance.term_opened", { termId: "Net burn" })).toThrow(ValidationError);
    expect(parsePayload("guidance.explainer_dismissed", { screenId: "finance/runway" })).toEqual({ screenId: "finance/runway" });
    // The switch: where it was flipped and how far the founder had come; counts never negative.
    expect(parsePayload("guidance.turned_off", { from: "tour", toursDone: 1, explainersSeen: 0 })).toEqual({ from: "tour", toursDone: 1, explainersSeen: 0 });
    expect(() => parsePayload("guidance.turned_off", { from: "profile", toursDone: 0, explainersSeen: 0 })).toThrow(ValidationError);
    expect(() => parsePayload("guidance.turned_off", { from: "settings", toursDone: -1, explainersSeen: 0 })).toThrow(ValidationError);
  });

  it("founder.*: the return loop's signals, for metrics only, never narrated (retention plan)", () => {
    for (const t of ["founder.session_started"] as const) {
      expect(EVENTS[t].narratable, t).toBe(false);
      expect(EVENTS[t].consumers, t).toEqual(["metrics"]);
    }
    expect(parsePayload("founder.session_started", { via: "direct", minutesAway: null, sessions: 1 })).toEqual({ via: "direct", notificationId: null, minutesAway: null, sessions: 1 });
    expect(() => parsePayload("founder.session_started", { via: "sms", minutesAway: 3, sessions: 2 })).toThrow(ValidationError);
    expect(() => parsePayload("founder.session_started", { via: "email", minutesAway: 3, sessions: 0 })).toThrow(ValidationError);
    expect(() => parsePayload("notify.email_sent", { ...EVENT_FIXTURES["notify.email_sent"], kind: "promo" })).toThrow(ValidationError);
    expect(parsePayload("notify.email_sent", { ...EVENT_FIXTURES["notify.email_sent"], kind: "daily_brief", inboxItemId: null }).inboxItemId).toBeNull();
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

  it("milestone.shown and milestone.hidden: a founder's own press, pushed to open tabs, never narrated (0089)", () => {
    for (const type of ["milestone.shown", "milestone.hidden"] as const) {
      const decl = EVENTS[type];
      expect(decl.narratable, type).toBe(false);
      expect([...decl.consumers].sort(), type).toEqual(["metrics", "stream"]);
      expect(isPersonAddressedEvent(type)).toBe(false);
      const fixture = EVENT_FIXTURES[type];
      expect(parsePayload(type, fixture)).toEqual(fixture);
      // Ids and public addresses only: nothing of a customer or a follower fits in the payload.
      expect(Object.keys(parsePayload(type, { ...fixture, customerName: "Acme Corp", email: "a@b.example" })).sort()).toEqual(["key", "milestoneId", "slug", "url"]);
      const bad = (patch: Record<string, unknown>) => () => parsePayload(type, { ...fixture, ...patch });
      expect(bad({ milestoneId: "not-an-id" })).toThrow(ValidationError);
      expect(bad({ key: "" })).toThrow(ValidationError);
      expect(bad({ slug: "ab" })).toThrow(ValidationError);
      expect(bad({ url: "/m/relative" })).toThrow(ValidationError);
    }
  });

  it("share.opened: a share control was pressed; the control and an id, never the words, for metrics only (tap-to-post)", () => {
    const decl = EVENTS["share.opened"];
    expect(decl.narratable).toBe(false);
    expect([...decl.consumers]).toEqual(["metrics"]);
    expect(isPersonAddressedEvent("share.opened")).toBe(false);
    // Appended after every type that was there before it: the list of types is only ever added to at its end
    // (not pinned to the last place, which the next type to be added takes).
    expect(EVENT_TYPES.indexOf("share.opened")).toBeGreaterThan(EVENT_TYPES.indexOf("milestone.hidden"));
    const fixture = EVENT_FIXTURES["share.opened"];
    expect(parsePayload("share.opened", fixture)).toEqual(fixture);
    // Nothing of the post fits in the payload: the text, the link and anything else typed are dropped.
    expect(Object.keys(parsePayload("share.opened", { ...fixture, text: "Maple Bakes reached a milestone", link: "https://foundmill.example/m/1", title: "x" })).sort()).toEqual(["kind", "network", "refId", "target"]);
    // Every control: a network's window, a copy, a message, the device's own sheet; a drafted post has no id.
    for (const payload of [
      { network: "bluesky", kind: "page", refId: fixtureId("page"), target: "tap" },
      { network: "linkedin", kind: "page", refId: fixtureId("page"), target: "link_only" },
      { network: "instagram", kind: "milestone", refId: fixtureId("milestone"), target: "copy" },
      { network: null, kind: "draft", refId: null, target: "copy" },
      { network: "whatsapp", kind: "milestone", refId: fixtureId("milestone"), target: "message" },
      { network: null, kind: "draft", refId: null, target: "device" },
      // A post the team wrote to be shared names itself (its asset's id), so it can stop waiting.
      { network: "threads", kind: "draft", refId: fixtureId("asset-post"), target: "tap" },
    ] as const)
      expect(parsePayload("share.opened", payload)).toEqual(payload);
    const bad = (patch: Record<string, unknown>) => () => parsePayload("share.opened", { ...fixture, ...patch });
    expect(bad({ network: "myspace" })).toThrow(ValidationError);
    expect(bad({ kind: "campaign" })).toThrow(ValidationError);
    expect(bad({ target: "posted" })).toThrow(ValidationError);
    expect(bad({ refId: "not-an-id" })).toThrow(ValidationError);
    expect(bad({ network: undefined })).toThrow(ValidationError);
  });

  it("share.opened is not a real outcome: the north star never counts a press it cannot see the end of", () => {
    // The events the catalogue marks as real outside results say so in their own words. Pinned: adding one is a decision.
    const counts = (doc: string) => /the north star counts it/i.test(doc);
    const real = EVENT_TYPES.filter((t) => counts(EVENTS[t].doc));
    expect(real).toEqual(["page.published", "page.followed"]);
    expect(real).not.toContain("share.opened");
    const doc = EVENTS["share.opened"].doc;
    expect(doc).toMatch(/not an outside result and the north star does not count it/);
    expect(doc).toMatch(/nothing calls this posted or published/);
    // Neither does any other event claim a share as its outcome.
    for (const t of real) expect(EVENTS[t].doc, t).not.toMatch(/share/i);
  });

  it("post.drafted: the team wrote a post for the founder to share; ids and the kind of trigger, never the words", () => {
    const decl = EVENTS["post.drafted"];
    expect(decl.scope).toBe("business");
    expect(decl.narratable).toBe(false);
    expect([...decl.consumers]).toEqual(["stream", "metrics"]);
    expect(isPersonAddressedEvent("post.drafted")).toBe(false);
    // Appended last: the list of types is only ever added to at its end.
    // Added after the types that were there before it; not pinned to the last place, which the next type added takes.
    expect(EVENT_TYPES.indexOf("post.drafted")).toBeGreaterThan(EVENT_TYPES.indexOf("share.opened"));
    const fixture = EVENT_FIXTURES["post.drafted"];
    expect(parsePayload("post.drafted", fixture)).toEqual(fixture);
    // Nothing of the post fits in the payload: its words, its link and anything about a person are dropped.
    expect(Object.keys(parsePayload("post.drafted", { ...fixture, text: "Maple Bakes has a page now.", body: "x", link: "https://foundmill.example/p/maple", followerEmail: "a@b.example" })).sort()).toEqual(["agentId", "assetId", "subject", "trigger"]);
    for (const payload of [
      { assetId: fixtureId("asset-post"), trigger: "milestone_shown", subject: "first_follower", agentId: null },
      { assetId: fixtureId("asset-post"), trigger: "first_follower", subject: "first_follower", agentId: FIXTURE_AGENT_ID },
    ] as const)
      expect(parsePayload("post.drafted", payload)).toEqual(payload);
    const bad = (patch: Record<string, unknown>) => () => parsePayload("post.drafted", { ...fixture, ...patch });
    expect(bad({ trigger: "campaign_launched" })).toThrow(ValidationError);
    expect(bad({ subject: "customer_1" })).toThrow(ValidationError);
    expect(bad({ subject: "mrr_1k" })).toThrow(ValidationError);
    expect(bad({ assetId: "not-an-id" })).toThrow(ValidationError);
    expect(bad({ agentId: undefined })).toThrow(ValidationError);
    // A draft is words waiting in the console: not an outside action or result, and it says so.
    expect(decl.doc).toMatch(/Nothing was launched, scheduled, published or measured/);
    expect(decl.doc).toMatch(/not an outside action or result/);
    expect(decl.doc).not.toMatch(/the north star counts it/i);
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
