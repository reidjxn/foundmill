/**
 * writeAccountEvent / writeAccountEvents (../outbox/account-writer): the statements they run, what they refuse before
 * anything is written, and the wall between the two writers (an account-scoped type never goes through the business
 * writer, a business-scoped type never through the account writer; by the compiler and at run time).
 */
import { ACCOUNT_EVENT_TYPES, EVENT_TYPES, isAccountEventType, ValidationError, type BusinessEventType } from "@foundmill/shared";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buildAccountEvent, writeAccountEvent, writeAccountEvents, type WriteAccountEventInput } from "../outbox/account-writer";
import { buildEvent, writeEvent, writeEvents, type Queryable, type WriteEventInput } from "../outbox/writer";
import { CapturingQueryable, renderSql, type CapturedStatement } from "../testing/fake-db";
import { accountFixtureInput, EVENT_FIXTURES, FIXTURE_BUSINESS_ID, FIXTURE_USER_ID, fixtureEvent, fixtureId, fixtureInput } from "../testing/fixtures";

const OTHER = fixtureId("other-user");

/** Answers the event insert with `returning` rows (or none, for a repeated idempotency key) and records everything. */
class ScriptedDb implements Queryable {
  readonly statements: CapturedStatement[] = [];
  constructor(private readonly answer: (stmt: CapturedStatement) => unknown) {}
  async execute(query: SQL): Promise<unknown> {
    const stmt = renderSql(query);
    this.statements.push(stmt);
    return this.answer(stmt);
  }
}
const inserting = () => new ScriptedDb((stmt) => (stmt.sql.startsWith('insert into "account_events"') ? [{ id: stmt.params[0] }] : []));

describe("writeAccountEvent", () => {
  it("inserts one account_events row and one account_outbox row in the caller's transaction and returns the id", async () => {
    const tx = inserting();
    const id = await writeAccountEvent(tx, accountFixtureInput("profile.published", { id: undefined, idempotencyKey: "publish:1" }));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tx.statements).toHaveLength(2);
    const [event, outbox] = tx.statements;
    expect(event!.sql).toMatch(/^insert into "account_events" \(id, user_id, type, occurred_at, actor, payload, idempotency_key\)/);
    expect(event!.sql).toContain("on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing");
    expect(event!.params).toEqual([id, FIXTURE_USER_ID, "profile.published", "2026-10-05T09:00:00.000Z", JSON.stringify({ kind: "user", id: FIXTURE_USER_ID }), JSON.stringify({ handle: "maya-okafor" }), "publish:1"]);
    expect(outbox!.sql).toBe('insert into "account_outbox" (user_id, event_id) values ($1::uuid, $2::uuid)');
    expect(outbox!.params).toEqual([FIXTURE_USER_ID, id]);
    // Nothing touches the business tables.
    expect(tx.statements.some((s) => /"events"|"outbox"/.test(s.sql))).toBe(false);
  });

  it("a repeated idempotency key returns the first event's id and writes no second row", async () => {
    const first = fixtureId("first-event");
    const tx = new ScriptedDb((stmt) => (stmt.sql.startsWith("select id") ? [{ id: first }] : []));
    const id = await writeAccountEvent(tx, accountFixtureInput("profile.published", { id: undefined, idempotencyKey: "publish:1" }));
    expect(id).toBe(first);
    expect(tx.statements.map((s) => s.sql.split(" ").slice(0, 3).join(" "))).toEqual(['insert into "account_events"', 'select id as']);
    expect(tx.statements[1]!.params).toEqual([FIXTURE_USER_ID, "publish:1"]);
    // PGlite's `{ rows }` result shape reads the same.
    const rowsShape = new ScriptedDb((stmt) => ({ rows: stmt.sql.startsWith("select id") ? [{ id: first }] : [] }));
    expect(await writeAccountEvent(rowsShape, accountFixtureInput("profile.published", { idempotencyKey: "publish:1" }))).toBe(first);
  });

  it("stores the payload as the schema parsed it, the person's id in lowercase, and a default time of now", async () => {
    const tx = inserting();
    const before = Date.now();
    await writeAccountEvent(tx, { userId: FIXTURE_USER_ID.toUpperCase(), type: "profile.unpublished", actor: { kind: "user", id: FIXTURE_USER_ID.toUpperCase() }, payload: { handle: "  maya-okafor " } });
    const params = tx.statements[0]!.params;
    expect(params[1]).toBe(FIXTURE_USER_ID);
    expect(JSON.parse(params[4] as string)).toEqual({ kind: "user", id: FIXTURE_USER_ID });
    expect(JSON.parse(params[5] as string)).toEqual({ handle: "maya-okafor" });
    expect(params[6]).toBeNull();
    expect(new Date(params[3] as string).getTime()).toBeGreaterThanOrEqual(before - 5);
  });

  it("refuses, before any statement, a malformed input", async () => {
    const tx = new CapturingQueryable();
    const bad = (over: Record<string, unknown>) => writeAccountEvent(tx, { ...accountFixtureInput("profile.published"), ...over } as WriteAccountEventInput);
    await expect(bad({ userId: "me" })).rejects.toThrow(/userId must be a UUID/);
    await expect(bad({ id: "nope" })).rejects.toThrow(/id must be a UUID/);
    await expect(bad({ payload: {} })).rejects.toThrow(/Invalid payload for profile.published/);
    await expect(bad({ payload: { handle: "Not A Handle" } })).rejects.toThrow(ValidationError);
    await expect(bad({ payload: { handle: "maya-okafor", extra: 1 } })).rejects.toThrow(/Invalid payload/);
    await expect(bad({ occurredAt: "yesterday" })).rejects.toThrow(/occurredAt must be a valid date/);
    await expect(bad({ idempotencyKey: "" })).rejects.toThrow(/idempotencyKey must be 1 to 200 characters/);
    await expect(bad({ idempotencyKey: "k".repeat(201) })).rejects.toThrow(/idempotencyKey/);
    await expect(bad({ otherAccountIds: ["someone"] })).rejects.toThrow(/otherAccountIds\[\] must be a UUID/);
    await expect(bad({ type: "profile.vanished" })).rejects.toThrow(/Unknown event type/);
    expect(tx.statements).toHaveLength(0);
  });

  it("refuses an actor that is a second party", async () => {
    const tx = new CapturingQueryable();
    await expect(writeAccountEvent(tx, accountFixtureInput("profile.published", { actor: { kind: "user", id: OTHER } }))).rejects.toThrow(/a user actor must be the person the row belongs to/);
    await expect(writeAccountEvent(tx, accountFixtureInput("profile.published", { actor: { kind: "agent", id: fixtureId("agent") } }))).rejects.toThrow(/the person themselves or the system/);
    await expect(writeAccountEvent(tx, accountFixtureInput("profile.published", { actor: { kind: "system", id: OTHER } }))).rejects.toThrow(/named by a lowercase word/);
    // An id in a system actor's name, however it is spelled, and anything beside `kind` and `id`.
    const compact = OTHER.replace(/-/g, "");
    for (const actor of [{ kind: "system", id: compact }, { kind: "system", id: `follow:${compact}` }, { kind: "system", id: `follow:${OTHER.replace(/-/g, ".")}` }, { kind: "system", id: OTHER.replace(/-/g, "\u2010") }]) {
      await expect(writeAccountEvent(tx, accountFixtureInput("profile.published", { actor: actor as never })), JSON.stringify(actor)).rejects.toThrow(/named by a lowercase word/);
    }
    for (const actor of [{ kind: "system", id: "platform", other: OTHER }, { kind: "user", id: FIXTURE_USER_ID, onBehalfOf: compact }]) {
      await expect(writeAccountEvent(tx, accountFixtureInput("profile.published", { actor: actor as never })), JSON.stringify(actor)).rejects.toThrow(/the actor must be exactly \{ kind, id \}/);
    }
    expect(tx.statements).toHaveLength(0);
    await writeAccountEvent(inserting(), accountFixtureInput("profile.published", { actor: { kind: "system", id: "platform" } }));
  });
});

describe("the two writers never cross", () => {
  it("the account writer refuses every business-scoped type at run time (the compiler refuses it first)", async () => {
    const tx = new CapturingQueryable();
    // @ts-expect-error a business-scoped type is not a WriteAccountEventInput
    const typed: WriteAccountEventInput = { userId: FIXTURE_USER_ID, type: "payment.received", actor: { kind: "user", id: FIXTURE_USER_ID }, payload: { handle: "maya-okafor" } };
    await expect(writeAccountEvent(tx, typed)).rejects.toThrow(/payment.received is business-scoped and is never written to a person's account events/);
    for (const type of EVENT_TYPES.filter((t) => !isAccountEventType(t))) {
      const input = { userId: FIXTURE_USER_ID, type, actor: { kind: "user", id: FIXTURE_USER_ID }, payload: EVENT_FIXTURES[type] } as unknown as WriteAccountEventInput;
      expect(() => buildAccountEvent(input), type).toThrow(/is business-scoped/);
      await expect(writeAccountEvents(tx, [input]), type).rejects.toThrow(/is business-scoped/);
    }
    expect(tx.statements).toHaveLength(0);
  });

  it("the business writer refuses every account-scoped type at run time (the compiler refuses it first)", async () => {
    const tx = new CapturingQueryable();
    // @ts-expect-error an account-scoped type is not a WriteEventInput
    const typed: WriteEventInput = { businessId: FIXTURE_BUSINESS_ID, type: "profile.published", actor: { kind: "user", id: FIXTURE_USER_ID }, payload: { handle: "maya-okafor" } };
    await expect(writeEvent(tx, typed)).rejects.toThrow(/profile.published is account-scoped and is never written to a business's events/);
    // @ts-expect-error nor a fixture event built for the business writer
    expect(() => fixtureEvent("profile.published")).toThrow(/account-scoped/);
    for (const type of ACCOUNT_EVENT_TYPES) {
      const input = { businessId: FIXTURE_BUSINESS_ID, type, actor: { kind: "user", id: FIXTURE_USER_ID }, payload: EVENT_FIXTURES[type] } as unknown as WriteEventInput;
      expect(() => buildEvent(input), type).toThrow(/is account-scoped/);
      await expect(writeEvent(tx, input), type).rejects.toThrow(/is account-scoped/);
      await expect(writeEvents(tx, [fixtureInput("task.started"), input]), type).rejects.toThrow(/is account-scoped/);
    }
    expect(tx.statements).toHaveLength(0);
    // The compiler agrees on the type level: an account type is not a BusinessEventType.
    const business: BusinessEventType[] = EVENT_TYPES.filter((t): t is BusinessEventType => !isAccountEventType(t));
    expect(business).not.toContain("profile.published");
  });
});

describe("the two-person rule at the writer", () => {
  const follow = (userId: string, handle: string): WriteAccountEventInput => ({ userId, type: "profile.published", actor: { kind: "system", id: "platform" }, payload: { handle } });

  it("one fact about two people is one row per person, each written with its own payload", async () => {
    const tx = inserting();
    const ids = await writeAccountEvents(tx, [follow(FIXTURE_USER_ID, "bo-ode"), follow(OTHER, "maya-okafor")]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const events = tx.statements.filter((s) => s.sql.startsWith('insert into "account_events"'));
    expect(events.map((s) => [s.params[1], JSON.parse(s.params[5] as string)])).toEqual([
      [FIXTURE_USER_ID, { handle: "bo-ode" }],
      [OTHER, { handle: "maya-okafor" }],
    ]);
    // Neither row carries the other person's account id anywhere.
    expect(JSON.stringify(events[0]!.params)).not.toContain(OTHER);
    expect(JSON.stringify(events[1]!.params)).not.toContain(FIXTURE_USER_ID);
    expect(tx.statements.filter((s) => s.sql.startsWith('insert into "account_outbox"')).map((s) => s.params)).toEqual([
      [FIXTURE_USER_ID, ids[0]],
      [OTHER, ids[1]],
    ]);
  });

  it("a sign-up a public address brought: the new person's row and the credited person's, and neither says who the other is", async () => {
    const NEWCOMER = fixtureId("newcomer");
    const facts = { sourceKind: "project_page", sourceRef: "bread-by-bike" } as const;
    const system = { kind: "system", id: "attribution" } as const;
    const tx = inserting();
    const ids = await writeAccountEvents(tx, [
      { userId: NEWCOMER, type: "signup.attributed", actor: system, payload: facts, occurredAt: "2026-11-12T09:00:00.000Z", idempotencyKey: "attribution:1:signup" },
      { userId: FIXTURE_USER_ID, type: "referral.arrived", actor: system, payload: facts, occurredAt: "2026-11-12T09:00:00.000Z", idempotencyKey: "attribution:1:referral" },
    ]);
    expect(new Set(ids).size).toBe(2);
    const events = tx.statements.filter((s) => s.sql.startsWith('insert into "account_events"'));
    expect(events.map((s) => s.params.slice(1))).toEqual([
      [NEWCOMER, "signup.attributed", "2026-11-12T09:00:00.000Z", JSON.stringify(system), JSON.stringify(facts), "attribution:1:signup"],
      [FIXTURE_USER_ID, "referral.arrived", "2026-11-12T09:00:00.000Z", JSON.stringify(system), JSON.stringify(facts), "attribution:1:referral"],
    ]);
    // The credited person's statement holds nothing of the new person, and the reverse; nor do the queue rows.
    const referral = tx.statements.filter((s) => s.params.includes(FIXTURE_USER_ID));
    const signup = tx.statements.filter((s) => s.params.includes(NEWCOMER));
    expect(referral).toHaveLength(2);
    expect(signup).toHaveLength(2);
    expect(JSON.stringify(referral.map((s) => s.params))).not.toContain(NEWCOMER);
    expect(JSON.stringify(signup.map((s) => s.params))).not.toContain(FIXTURE_USER_ID);
    expect(tx.statements.some((s) => /"events"|"outbox"/.test(s.sql))).toBe(false);

    // Refused whole, before the first insert: a payload that names the new person, however it is spelled; the new
    // person as the actor of the credited person's row; a field the schema does not have.
    const refused = new CapturingQueryable();
    const pair = (referralOver: Record<string, unknown>): WriteAccountEventInput[] => [
      { userId: NEWCOMER, type: "signup.attributed", actor: system, payload: facts },
      { userId: FIXTURE_USER_ID, type: "referral.arrived", actor: system, payload: facts, ...referralOver } as WriteAccountEventInput,
    ];
    await expect(writeAccountEvents(refused, pair({ payload: { ...facts, sourceRef: NEWCOMER.replace(/-/g, "") } }))).rejects.toThrow(/carries an account id/);
    await expect(writeAccountEvents(refused, pair({ payload: { ...facts, userId: NEWCOMER } }))).rejects.toThrow(/Invalid payload for referral\.arrived/);
    await expect(writeAccountEvents(refused, pair({ payload: { ...facts, handle: "the-newcomer" } }))).rejects.toThrow(/Invalid payload for referral\.arrived: unrecognized_keys at depth 0/);
    await expect(writeAccountEvents(refused, pair({ actor: { kind: "user", id: NEWCOMER } }))).rejects.toThrow(/a user actor must be the person the row belongs to/);
    // The business writer takes neither type.
    for (const type of ["signup.attributed", "referral.arrived"] as const) {
      await expect(writeEvent(refused, { businessId: FIXTURE_BUSINESS_ID, type, actor: system, payload: facts } as unknown as WriteEventInput), type).rejects.toThrow(/is account-scoped and is never written to a business's events/);
    }
    expect(refused.statements).toHaveLength(0);
  });

  it("refuses the whole fact, before the first insert, when a row would name the other person by their account", async () => {
    const tx = new CapturingQueryable();
    // The fixture schema is strict, so the only place an id could ride is the handle: it is refused there too.
    await expect(writeAccountEvents(tx, [follow(FIXTURE_USER_ID, "bo-ode"), { ...follow(OTHER, "maya-okafor"), payload: { handle: FIXTURE_USER_ID } }])).rejects.toThrow(ValidationError);
    await expect(writeAccountEvents(tx, [follow(FIXTURE_USER_ID, "bo-ode"), follow(FIXTURE_USER_ID.toUpperCase(), "maya-okafor")])).rejects.toThrow(/one row per person: a person appears twice/);
    await expect(writeAccountEvents(tx, [follow(FIXTURE_USER_ID, "bo-ode"), { ...follow(OTHER, "maya-okafor"), actor: { kind: "user", id: FIXTURE_USER_ID } }])).rejects.toThrow(/a user actor must be the person the row belongs to/);
    expect(tx.statements).toHaveLength(0);
    expect(await writeAccountEvents(tx, [])).toEqual([]);
  });

  it("buildAccountEvent holds a payload to everyone the fact is about: the row's person, the other rows, otherAccountIds", () => {
    // A handle may be shaped like an id (letters, digits and hyphens), so the schema lets these through: the value check refuses them.
    const refused = /a value at depth 1 carries an account id/;
    expect(() => buildAccountEvent(accountFixtureInput("profile.published", { payload: { handle: OTHER }, otherAccountIds: [OTHER] }))).toThrow(refused);
    expect(() => buildAccountEvent(accountFixtureInput("profile.published", { payload: { handle: OTHER } }), [OTHER])).toThrow(refused);
    expect(() => buildAccountEvent(accountFixtureInput("profile.published", { payload: { handle: FIXTURE_USER_ID } }))).toThrow(refused);
    // In every spelling a handle can take: without hyphens, with hyphens elsewhere, behind other letters.
    const compact = OTHER.replace(/-/g, "");
    for (const handle of [compact, compact.replace(/(.{4})/g, "$1-").slice(0, -1), `x${compact}`, `id-${compact}-x`]) {
      expect(() => buildAccountEvent(accountFixtureInput("profile.published", { payload: { handle }, otherAccountIds: [OTHER] })), handle).toThrow(refused);
      expect(() => buildAccountEvent(accountFixtureInput("profile.published", { payload: { handle } }), [OTHER]), handle).toThrow(refused);
      expect(() => buildAccountEvent(accountFixtureInput("profile.published", { userId: OTHER, payload: { handle } })), handle).toThrow(refused);
      // The id of someone who is nobody in this call is still shaped like an id.
      expect(() => buildAccountEvent(accountFixtureInput("profile.published", { payload: { handle } })), handle).toThrow(/carries something shaped like an id/);
    }
    expect(() => buildAccountEvent(accountFixtureInput("profile.published", { payload: { handle: fixtureId("stranger") } }))).toThrow(/a value at depth 1 carries something shaped like an id/);
    expect(() => buildAccountEvent(accountFixtureInput("profile.published", { payload: { handle: `x${fixtureId("stranger")}` } }))).toThrow(/carries something shaped like an id/);
    expect(() => buildAccountEvent(accountFixtureInput("profile.published", { otherAccountIds: [OTHER] }), [fixtureId("third")])).not.toThrow();
  });

  it("a refused payload is described by rule, code and depth: no key and no value of it is repeated", () => {
    // The declared schema is strict: Zod's own words for this are `Unrecognized key: "bo@example.com"`.
    const attempts: Record<string, unknown>[] = [
      { handle: "maya-okafor", ["bo@example.com"]: 1 },
      { handle: "maya-okafor", ["PRIVATE-key-name"]: "PRIVATE-value" },
      { handle: "PRIVATE Not A Handle bo@example.com" },
      { handle: { nested: "PRIVATE-value" } },
      { handle: OTHER },
    ];
    for (const payload of attempts) {
      let caught: unknown;
      try {
        buildAccountEvent(accountFixtureInput("profile.published", { payload: payload as never }));
      } catch (err) {
        caught = err;
      }
      expect(caught, JSON.stringify(payload)).toBeInstanceOf(ValidationError);
      const error = caught as ValidationError;
      const said = JSON.stringify([error.message, error.details, String(error)]);
      for (const word of ["bo@example.com", "example.com", "PRIVATE", "Not A Handle", OTHER]) expect(said, word).not.toContain(word);
    }
    expect(() => buildAccountEvent(accountFixtureInput("profile.published", { payload: { handle: "maya-okafor", ["bo@example.com"]: 1 } as never }))).toThrow(/^Invalid payload for profile\.published: unrecognized_keys at depth 0$/);
    expect(() => buildAccountEvent(accountFixtureInput("profile.published", { payload: {} as never }))).toThrow(/^Invalid payload for profile\.published: invalid_type at depth 1$/);
  });
});
