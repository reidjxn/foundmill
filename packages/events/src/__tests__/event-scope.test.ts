/**
 * One catalog, two scopes (docs/ARCHITECTURE.md §5 "Account events"): every declaration states `business` or
 * `account`, the shared vocabulary and the catalog agree, the two envelopes refuse each other's types, the first
 * two account events carry a handle and nothing else, and the two attribution events (`signup.attributed` for the new
 * person, `referral.arrived` for the person credited) carry a public address and nothing else.
 */
import { ACCOUNT_EVENT_TYPES, EVENT_SCOPES, EVENT_TYPES, eventScopeOf, isAccountEventType, ValidationError, type AccountEventType, type BusinessEventType } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AccountEventParseError, accountEventToWire, isAccountEventOfType, issueReason, parseAccountEvent, safeParseAccountEvent, serializeAccountEvent, type AccountEvent } from "../account-event";
import { declareAccountEvent, declareEvent, EVENTS, eventScope, eventTypesOfScope, parseEvent, safeParseEvent, type EventPayload, type PlatformEvent } from "../catalogue";
import { accountFixtureEvent, accountFixtureInput, EVENT_FIXTURES, FIXTURE_BUSINESS_ID, FIXTURE_USER_ID, fixtureEvent } from "../testing/fixtures";

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// The compiler's view of the wall: a PlatformEvent is never of an account type, an AccountEvent never of a business one.
export type _PlatformEventsAreBusinessOnly = Assert<Equal<PlatformEvent["type"], BusinessEventType>>;
export type _AccountEventsAreAccountOnly = Assert<Equal<AccountEvent["type"], AccountEventType>>;
export type _NoTypeHasBothScopes = Assert<Equal<Extract<BusinessEventType, AccountEventType>, never>>;
export type _ScopeIsOnTheDeclaration = Assert<Equal<(typeof EVENTS)["profile.published"]["scope"], "account">>;
export type _BusinessScopeIsOnTheDeclaration = Assert<Equal<(typeof EVENTS)["payment.received"]["scope"], "business">>;
export type _ProfilePayloadIsTheHandle = Assert<Equal<EventPayload<"profile.published">, { handle: string }>>;
// One sign-up, two rows, and the same two public fields in both: no account id, no business id, nothing about the other person.
type AttributionSource = { sourceKind: "project_page" | "person_profile"; sourceRef: string };
export type _SignupAttributedIsAccountScoped = Assert<Equal<(typeof EVENTS)["signup.attributed"]["scope"], "account">>;
export type _ReferralArrivedIsAccountScoped = Assert<Equal<(typeof EVENTS)["referral.arrived"]["scope"], "account">>;
export type _SignupAttributedPayload = Assert<Equal<EventPayload<"signup.attributed">, AttributionSource>>;
export type _ReferralArrivedPayload = Assert<Equal<EventPayload<"referral.arrived">, AttributionSource>>;
export type _NeitherIsABusinessEvent = Assert<Equal<Extract<PlatformEvent["type"], "signup.attributed" | "referral.arrived">, never>>;

describe("event scope", () => {
  it("every declaration states its scope, and the catalog and the shared vocabulary agree", () => {
    expect([...EVENT_SCOPES]).toEqual(["business", "account"]);
    for (const type of EVENT_TYPES) {
      expect(EVENT_SCOPES, type).toContain(EVENTS[type].scope);
      expect(EVENTS[type].scope, type).toBe(eventScopeOf(type));
      expect(eventScope(type), type).toBe(isAccountEventType(type) ? "account" : "business");
    }
    expect(eventTypesOfScope("account").sort()).toEqual([...ACCOUNT_EVENT_TYPES].sort());
    expect(eventTypesOfScope("business").sort()).toEqual(EVENT_TYPES.filter((t) => !isAccountEventType(t)).sort());
    expect(eventTypesOfScope("business").length + eventTypesOfScope("account").length).toBe(EVENT_TYPES.length);
  });

  it("the account-scoped types are the two profile events, the two attribution events and the founder notice, each in the vocabulary", () => {
    expect([...ACCOUNT_EVENT_TYPES]).toEqual(["profile.published", "profile.unpublished", "signup.attributed", "referral.arrived", "founder_notice.sent", "account.admitted", "profile.created", "idea.kept", "idea.drafted"]);
    // Where they sit in the vocabulary is not pinned: every team appends its types at the end, of either scope.
    for (const type of ACCOUNT_EVENT_TYPES) expect(EVENT_TYPES as readonly string[]).toContain(type);
    for (const type of ACCOUNT_EVENT_TYPES) {
      const decl = EVENTS[type];
      expect(decl.scope).toBe("account");
      // The Composer writes a project's Inbox: a person's own fact is never narrated there.
      expect(decl.narratable).toBe(false);
      expect(decl.recordIds).toEqual(type === "founder_notice.sent" ? ["businessId", "notificationId"] : []);
    }
    for (const type of ["profile.published", "profile.unpublished"] as const) {
      expect(EVENTS[type].consumers).toEqual(["stream"]);
      expect(EVENT_FIXTURES[type]).toEqual({ handle: "maya-okafor" });
    }
    expect(isAccountEventType("page.published")).toBe(false);
    expect(isAccountEventType(null)).toBe(false);
  });

  it("a sign-up a public address brought is two account events, one per person, each a public address and nothing else", () => {
    const signup = EVENTS["signup.attributed"];
    const referral = EVENTS["referral.arrived"];
    for (const decl of [signup, referral]) {
      expect([decl.scope, decl.narratable, [...decl.consumers], [...decl.recordIds]]).toEqual(["account", false, ["metrics"], []]);
      // The same closed schema for both readers: the kind and the slug or handle as it arrived.
      expect(decl.schema).toBe(signup.schema);
      expect(decl.schema.parse({ sourceKind: "project_page", sourceRef: "bread-by-bike" })).toEqual({ sourceKind: "project_page", sourceRef: "bread-by-bike" });
      expect(decl.schema.parse({ sourceKind: "person_profile", sourceRef: "sam-lee" })).toEqual({ sourceKind: "person_profile", sourceRef: "sam-lee" });
      // What the business-scoped declaration used to carry is refused, field by field: both accounts and the project.
      for (const extra of [{ userId: FIXTURE_USER_ID }, { referrerUserId: FIXTURE_USER_ID }, { referrerUserId: null }, { sourceBusinessId: FIXTURE_BUSINESS_ID }, { sourceBusinessId: null }]) {
        expect(decl.schema.safeParse({ sourceKind: "project_page", sourceRef: "bread-by-bike", ...extra }).success, `${decl.type} ${Object.keys(extra)[0]}`).toBe(false);
      }
      // And anything that could say who signed up, or narrow it: a handle, a name, an email address, a time, a count.
      for (const extra of [{ handle: "the-newcomer" }, { newHandle: "the-newcomer" }, { displayName: "New Person" }, { email: "new@example.com" }, { at: "2026-11-12T09:00:00.000Z" }, { signedUpAt: "2026-11-12T09:00:00.000Z" }, { count: 1 }, { ordinal: 1 }, { first: true }]) {
        expect(decl.schema.safeParse({ sourceKind: "project_page", sourceRef: "bread-by-bike", ...extra }).success, `${decl.type} ${Object.keys(extra)[0]}`).toBe(false);
      }
      // The address is a slug or a handle, as the public address spells it; the kind is one of the two.
      for (const sourceRef of ["ab", "x".repeat(41), "-abc", "abc-", "Bread-By-Bike", "bread by bike", "p.bread-by-bike", "bread_by_bike", "", FIXTURE_USER_ID.toUpperCase()]) {
        expect(decl.schema.safeParse({ sourceKind: "project_page", sourceRef }).success, `${decl.type} ${sourceRef}`).toBe(false);
      }
      for (const sourceKind of ["card", "invitation", "", "PROJECT_PAGE"]) expect(decl.schema.safeParse({ sourceKind, sourceRef: "bread-by-bike" }).success, `${decl.type} ${sourceKind}`).toBe(false);
      expect(decl.schema.safeParse({ sourceKind: "project_page" }).success).toBe(false);
      expect(decl.schema.safeParse({ sourceRef: "bread-by-bike" }).success).toBe(false);
    }
    expect(Object.keys(EVENT_FIXTURES["signup.attributed"]).sort()).toEqual(["sourceKind", "sourceRef"]);
    expect(Object.keys(EVENT_FIXTURES["referral.arrived"]).sort()).toEqual(["sourceKind", "sourceRef"]);
    // The credited person's declaration says, where a consumer reads it, what the row must never say.
    expect(referral.doc).toMatch(/never says who signed up/);
    expect(signup.doc).toMatch(/not who is credited/);
    // The fixtures build as account events and are refused as business events.
    expect(accountFixtureEvent("signup.attributed")).toMatchObject({ userId: FIXTURE_USER_ID, type: "signup.attributed", payload: { sourceKind: "project_page", sourceRef: "northwind-skincare" } });
    expect(accountFixtureEvent("referral.arrived")).toMatchObject({ userId: FIXTURE_USER_ID, type: "referral.arrived", payload: { sourceKind: "person_profile", sourceRef: "maya-okafor" } });
    for (const type of ["signup.attributed", "referral.arrived"] as const) {
      const wire = { ...JSON.parse(JSON.stringify(fixtureEvent("page.published"))), type, payload: EVENT_FIXTURES[type] };
      const parsed = safeParseEvent(wire);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.message).toBe(`${type} is account-scoped and is never a business event`);
      expect(() => declareEvent(type as never, z.object({ sourceRef: z.string() }), { doc: "x", consumers: ["metrics"] })).toThrow(/is account-scoped; declare it with declareAccountEvent/);
    }
  });

  it("each declaring helper refuses the other scope, and an account payload that breaks the conventions", () => {
    expect(() => declareEvent("profile.published" as never, z.object({ handle: z.string() }), { doc: "x", consumers: ["stream"] })).toThrow(/is account-scoped; declare it with declareAccountEvent/);
    expect(() => declareAccountEvent("payment.received" as never, z.object({ handle: z.string() }), { doc: "x", consumers: ["stream"] })).toThrow(/is not in ACCOUNT_EVENT_TYPES/);
    expect(() => declareAccountEvent("made.up" as never, z.object({}), { doc: "x", consumers: ["stream"] })).toThrow(/not in EVENT_TYPES/);
    expect(() => declareAccountEvent("profile.published", z.object({ handle: z.string(), userId: z.guid() }), { doc: "x", consumers: ["stream"] })).toThrow(/names a person by an account/);
    expect(() => declareAccountEvent("profile.published", z.object({ handle: z.string(), askId: z.guid() }), { doc: "x", consumers: ["stream"] })).toThrow(/recordIds/);
    const ok = declareAccountEvent("profile.published", z.object({ handle: z.string(), askId: z.guid() }), { doc: "x", consumers: ["stream"], recordIds: ["askId"] });
    expect([ok.scope, ok.narratable, ok.recordIds]).toEqual(["account", false, ["askId"]]);
    expect(declareEvent("payment.received", z.object({}), { doc: "x", consumers: ["metrics"], scope: "business" }).scope).toBe("business");
  });

  it("a business envelope refuses an account-scoped type, whatever else it carries", () => {
    const wire = { ...JSON.parse(JSON.stringify(fixtureEvent("page.published"))), type: "profile.published", payload: EVENT_FIXTURES["profile.published"] };
    const parsed = safeParseEvent(wire);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toBe("profile.published is account-scoped and is never a business event");
    expect(() => parseEvent(wire)).toThrow(ValidationError);
    expect(() => parseEvent({ ...wire, businessId: FIXTURE_BUSINESS_ID, userId: FIXTURE_USER_ID })).toThrow(/account-scoped/);
  });

  it("an account envelope round-trips, and refuses a business-scoped type, a missing person and a bad payload", () => {
    const event = accountFixtureEvent("profile.published");
    expect(Object.keys(event).sort()).toEqual(["actor", "id", "occurredAt", "payload", "type", "userId"]);
    const wire = JSON.parse(serializeAccountEvent(event));
    expect(wire).toEqual({ ...accountEventToWire(event), occurredAt: "2026-10-05T09:00:00.000Z" });
    const parsed = parseAccountEvent(wire);
    expect(parsed).toEqual(event);
    expect(parsed.occurredAt).toBeInstanceOf(Date);
    expect(isAccountEventOfType(parsed, "profile.published")).toBe(true);
    expect(isAccountEventOfType(parsed, "profile.unpublished")).toBe(false);

    const business = safeParseAccountEvent({ ...wire, type: "payment.received", payload: EVENT_FIXTURES["payment.received"] });
    expect(business.ok).toBe(false);
    if (!business.ok) expect(business.error.message).toBe("payment.received is business-scoped and is never an account event");
    // A business event as it travels on `ev:` has no `userId`: it never parses as an account event.
    expect(safeParseAccountEvent(JSON.parse(JSON.stringify(fixtureEvent("task.started")))).ok).toBe(false);
    expect(() => parseAccountEvent({ ...wire, userId: "me" })).toThrow(/Invalid account event envelope/);
    expect(() => parseAccountEvent({ ...wire, payload: {} })).toThrow(/Invalid payload for profile.published/);
    expect(() => parseAccountEvent({ ...wire, payload: { handle: "maya-okafor", email: "PRIVATE@example.com" } })).toThrow(/Invalid payload/);
    expect(() => parseAccountEvent({ ...wire, type: "profile.vanished" })).toThrow(ValidationError);
    expect(() => parseAccountEvent(null)).toThrow(ValidationError);
    // A refusal never repeats what the payload said, as a value or as a key (Zod's own text for a strict object
    // names the key), nor a type the catalog does not know.
    for (const bad of [
      { ...wire, payload: { handle: "maya-okafor", email: "PRIVATE@example.com" } },
      { ...wire, payload: { handle: "maya-okafor", ["PRIVATE@example.com"]: 1 } },
      { ...wire, payload: { handle: "PRIVATE Not A Handle" } },
      { ...wire, type: "PRIVATE.type@example.com" },
      { ...wire, userId: "PRIVATE-user", actor: { kind: "PRIVATE-kind", id: 7 } },
      { ...wire, ["PRIVATE-envelope-key"]: "x", id: "PRIVATE-id" },
    ]) {
      const refused = safeParseAccountEvent(bad);
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.error).toBeInstanceOf(AccountEventParseError);
        expect(JSON.stringify([refused.error.message, refused.error.details, String(refused.error)])).not.toMatch(/PRIVATE|example\.com/);
      }
    }
    const strictKey = safeParseAccountEvent({ ...wire, payload: { handle: "maya-okafor", ["bo@example.com"]: 1 } });
    if (!strictKey.ok) expect([strictKey.error.reason, strictKey.error.message]).toEqual(["invalid_payload", "Invalid payload for profile.published: unrecognized_keys at depth 0"]);
    const envelope = safeParseAccountEvent({ ...wire, userId: "me", actor: { kind: "nobody", id: "x" } });
    // The envelope's own field names may be said: the schema wrote them, not the input.
    if (!envelope.ok) expect([envelope.error.reason, envelope.error.message]).toEqual(["invalid_envelope", "Invalid account event envelope: invalid_format at userId; invalid_value at actor.kind"]);
    const unknown = safeParseAccountEvent({ ...wire, type: "profile.vanished" });
    if (!unknown.ok) expect([unknown.error.reason, unknown.error.message]).toEqual(["invalid_envelope", "Invalid account event envelope: invalid_value at type"]);
    expect(issueReason([{ code: "unrecognized_keys", path: [] }, { code: "invalid_type", path: ["bo@example.com", 0] }, { path: ["a"] }])).toBe("unrecognized_keys at depth 0; invalid_type at depth 2; invalid at depth 1");
    expect(issueReason(Array.from({ length: 7 }, () => ({ code: "custom", path: ["x"] })))).toBe("custom at depth 1; custom at depth 1; custom at depth 1; custom at depth 1; custom at depth 1; and 2 more");
  });

  it("the account fixture input is the person acting on their own account", () => {
    expect(accountFixtureInput("profile.unpublished")).toMatchObject({ userId: FIXTURE_USER_ID, type: "profile.unpublished", actor: { kind: "user", id: FIXTURE_USER_ID }, payload: { handle: "maya-okafor" } });
  });
});
