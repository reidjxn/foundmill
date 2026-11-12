/**
 * The two-person rule as code (../account-payload): what an account event's payload schema may declare, what a payload
 * may carry when it is written, and who may be its actor. A payload names another person only by something public
 * about them (a handle); never by account id, email address or a private field.
 */
import { ACCOUNT_EVENT_TYPES, ValidationError } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { accountIdText, accountPayloadKeyProblem, AccountRuleError, assertAccountActor, assertAccountPayloadSchema, assertAccountPayloadValues, looksLikeAnId, type AccountRule } from "../account-payload";
import { EVENTS } from "../catalogue";
import { EVENT_FIXTURES, fixtureId } from "../testing/fixtures";

const ME = fixtureId("user");
const OTHER = fixtureId("other-user");
const RECORD = fixtureId("ask");

const schemaOk = (schema: z.ZodType, recordIds: readonly string[] = []) => () => assertAccountPayloadSchema("profile.published", schema, recordIds);
const valuesOk = (payload: unknown, recordIds: readonly string[] = [], accountIds: readonly string[] = [ME, OTHER]) => () => assertAccountPayloadValues("profile.published", payload, { recordIds, accountIds });

describe("account payload keys", () => {
  it("refuses a key that names a person by an account, in either spelling and behind any prefix", () => {
    for (const key of ["userId", "user_id", "accountId", "ownerId", "memberIds", "fromUserId", "byUserId", "followerId", "followedId", "follower_id", "recipientId", "senderId", "authorId", "actorId", "profileId", "personId", "peopleIds", "referrerId", "inviteeId", "askerId", "answererId", "viewerId", "USERID"]) {
      expect(accountPayloadKeyProblem(key), key).toMatch(/names a person by an account/);
    }
  });

  it("refuses a key that carries a contact detail or a credential", () => {
    for (const key of ["email", "Email", "followerEmail", "e_mail", "e-mail", "phone", "phoneNumber", "mobile", "password", "secret", "clientSecret", "token", "accessToken", "ipAddress", "ip_address"]) {
      expect(accountPayloadKeyProblem(key), key).toMatch(/contact detail or a credential/);
    }
  });

  it("allows what is public or not about a person: a handle, a slug, a count, a record's id", () => {
    for (const key of ["handle", "followerHandle", "byHandle", "slug", "pageSlug", "count", "askId", "threadId", "answerId", "kind", "url", "headline", "ids", "id"]) {
      expect(accountPayloadKeyProblem(key), key).toBeNull();
    }
  });
});

describe("assertAccountPayloadSchema (when the catalog loads)", () => {
  it("accepts a closed object of plain fields, nested and listed", () => {
    expect(schemaOk(z.object({ handle: z.string() }))).not.toThrow();
    expect(schemaOk(z.strictObject({ handle: z.string(), count: z.number().int(), open: z.boolean(), kind: z.enum(["a", "b"]), mark: z.literal("x"), at: z.iso.datetime({ offset: true }) }))).not.toThrow();
    expect(schemaOk(z.object({ by: z.object({ handle: z.string() }).nullable(), tags: z.array(z.string()).default([]), note: z.string().optional(), either: z.union([z.string(), z.number()]) }))).not.toThrow();
  });

  it("refuses a key that names a person by an account or carries a contact detail, at any depth", () => {
    expect(schemaOk(z.object({ userId: z.string() }))).toThrow(/userId: "userId" names a person by an account/);
    expect(schemaOk(z.object({ by: z.object({ followerId: z.string() }) }))).toThrow(/by\.followerId/);
    expect(schemaOk(z.object({ people: z.array(z.object({ email: z.string() })) }))).toThrow(/people\[\]\.email.*contact detail/);
    expect(schemaOk(z.object({ by: z.object({ phone: z.string() }).optional() }))).toThrow(/by\.phone/);
  });

  it("refuses a UUID field unless the declaration lists it as a record id, and an account key can never be listed", () => {
    expect(schemaOk(z.object({ askId: z.guid() }))).toThrow(/askId: a UUID field must be listed in the declaration's recordIds/);
    expect(schemaOk(z.object({ askId: z.uuid() }))).toThrow(/recordIds/);
    expect(schemaOk(z.object({ askId: z.string().uuid() }))).toThrow(/recordIds/);
    expect(schemaOk(z.object({ asks: z.array(z.guid()) }))).toThrow(/asks\[\]/);
    expect(schemaOk(z.object({ askId: z.guid().nullable().default(null) }))).toThrow(/recordIds/);
    expect(schemaOk(z.object({ askId: z.guid(), asks: z.array(z.guid()) }), ["askId", "asks"])).not.toThrow();
    expect(schemaOk(z.object({ handle: z.string() }), ["userId"])).toThrow(/recordIds cannot list it/);
    expect(schemaOk(z.object({ userId: z.guid() }), ["userId"])).toThrow(/recordIds cannot list it/);
  });

  it("refuses an email field and anything free-form, because a free-form bag cannot be checked", () => {
    expect(schemaOk(z.object({ contact: z.email() }))).toThrow(/an email address is never in an account event/);
    expect(schemaOk(z.object({ contact: z.string().email() }))).toThrow(/an email address/);
    expect(schemaOk(z.looseObject({ handle: z.string() }))).toThrow(/a loose object lets unchecked keys through/);
    expect(schemaOk(z.object({ handle: z.string() }).passthrough())).toThrow(/a loose object/);
    expect(schemaOk(z.object({ extra: z.record(z.string(), z.unknown()) }))).toThrow(/extra: a record field cannot be checked/);
    expect(schemaOk(z.object({ extra: z.unknown() }))).toThrow(/a unknown field cannot be checked/);
    expect(schemaOk(z.object({ extra: z.any() }))).toThrow(/cannot be checked/);
    expect(schemaOk(z.string())).toThrow(/the payload schema must be an object/);
    expect(schemaOk(z.array(z.object({ handle: z.string() })))).toThrow(/must be an object/);
  });

  it("every account-scoped declaration in the catalog passes, and names nobody but by a public address", () => {
    /** What each declaration's payload holds: a person's own handle, or the public address a sign-up came through. */
    const fields: Record<(typeof ACCOUNT_EVENT_TYPES)[number], string[]> = {
      "profile.published": ["handle"],
      "profile.unpublished": ["handle"],
      "signup.attributed": ["sourceKind", "sourceRef"],
      "referral.arrived": ["sourceKind", "sourceRef"],
    };
    for (const type of ACCOUNT_EVENT_TYPES) {
      const decl = EVENTS[type];
      const fixture = EVENT_FIXTURES[type] as Record<string, unknown>;
      expect(() => assertAccountPayloadSchema(type, decl.schema, decl.recordIds), type).not.toThrow();
      expect(() => assertAccountPayloadValues(type, fixture, { recordIds: decl.recordIds, accountIds: [ME] }), type).not.toThrow();
      expect(Object.keys(fixture).sort(), type).toEqual(fields[type]);
      expect(decl.recordIds, type).toEqual([]);
      // Nothing else gets through the schema: it is strict.
      expect(decl.schema.safeParse(fixture).success, type).toBe(true);
      expect(decl.schema.safeParse({ ...fixture, userId: ME }).success, type).toBe(false);
      expect(decl.schema.safeParse({ ...fixture, note: "x" }).success, type).toBe(false);
      // And the one text field is a public address, not free text.
      const address = fields[type].at(-1)!;
      expect(decl.schema.safeParse({ ...fixture, [address]: "Maya Okafor" }).success, type).toBe(false);
    }
  });

  it("the attribution events: an address that is, or holds, an account id is refused when written, for either reader", () => {
    const compact = OTHER.replace(/-/g, "");
    for (const type of ["signup.attributed", "referral.arrived"] as const) {
      const decl = EVENTS[type];
      const check = (sourceRef: string, accountIds: readonly string[]) => ruleOf(() => assertAccountPayloadValues(type, { sourceKind: "project_page", sourceRef }, { recordIds: decl.recordIds, accountIds }));
      expect(check("bread-by-bike", [ME, OTHER]), type).toBeNull();
      // A slug may be 32 letters a to f and digits (the address rule allows it): the other person's id, compact.
      expect(decl.schema.safeParse({ sourceKind: "project_page", sourceRef: compact }).success, type).toBe(true);
      expect(check(compact, [ME, OTHER]), type).toBe("account_id");
      expect(check(`x-${compact}-y`, [ME, OTHER]), type).toBe("account_id");
      expect(check(ME, [ME, OTHER]), type).toBe("account_id");
      // Shaped like an id and nobody's in this call: refused all the same.
      expect(check(compact, [ME]), type).toBe("id_shaped");
      expect(check("0123456789abcdef0123456789abcdef", [ME, OTHER]), type).toBe("id_shaped");
    }
  });
});

/** The rule a payload breaks when it is written, or null. */
const ruleOf = (run: () => void): AccountRule | null => {
  try {
    run();
    return null;
  } catch (err) {
    if (err instanceof AccountRuleError) return err.rule;
    throw err;
  }
};

/** One id in every spelling the checks must see through. */
const COMPACT = OTHER.replace(/-/g, "");
const SPELLINGS: Record<string, string> = {
  hyphenated: OTHER,
  capitals: OTHER.toUpperCase(),
  compact: COMPACT,
  "compact, capitals": COMPACT.toUpperCase(),
  "a hyphen every four": COMPACT.replace(/(.{4})/g, "$1-").slice(0, -1),
  "one stray hyphen": `${COMPACT.slice(0, 5)}-${COMPACT.slice(5)}`,
  "hyphen U+2010": OTHER.replace(/-/g, "‐"),
  "non-breaking hyphen U+2011": OTHER.replace(/-/g, "‑"),
  "figure dash U+2012": OTHER.replace(/-/g, "‒"),
  "en dash U+2013": OTHER.replace(/-/g, "–"),
  "em dash U+2014": OTHER.replace(/-/g, "—"),
  "minus sign U+2212": OTHER.replace(/-/g, "−"),
  "fullwidth hyphen U+FF0D": OTHER.replace(/-/g, "－"),
  "fullwidth digits and letters": COMPACT.replace(/[0-9a-f]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)),
  braces: `{${OTHER}}`,
  urn: `urn:uuid:${OTHER}`,
  "spaces between the groups": OTHER.replace(/-/g, " "),
  "dots between the groups": OTHER.replace(/-/g, "."),
  "colons between pairs": COMPACT.replace(/(..)/g, "$1:").slice(0, -1),
  "after other letters and digits": `ab12${COMPACT}`,
  "inside a longer run": `abcdef0123456789${COMPACT}0123456789abcdef`,
  "inside a sentence": `seen by ${COMPACT} today`,
};

describe("assertAccountPayloadValues (when an event is written)", () => {
  it("accepts a public handle and a listed record id", () => {
    expect(valuesOk({ handle: "maya-okafor", by: { handle: "bo-ode" }, tags: ["a", "b"], count: 2, open: true, none: null })).not.toThrow();
    expect(valuesOk({ askId: RECORD, asks: [RECORD] }, ["askId", "asks"])).not.toThrow();
  });

  it("refuses the account id of anyone the fact is about, wherever it hides", () => {
    const rule = (payload: unknown, recordIds: string[] = []) => ruleOf(valuesOk(payload, recordIds));
    expect(rule({ handle: "maya-okafor", by: OTHER })).toBe("account_id");
    expect(rule({ handle: "maya-okafor", self: ME })).toBe("account_id");
    expect(rule({ handle: "maya-okafor", list: [{ deep: [OTHER.toUpperCase()] }] })).toBe("account_id");
    expect(rule({ handle: "maya-okafor", note: `seen by ${OTHER} today` })).toBe("account_id");
    expect(rule({ handle: "maya-okafor", [OTHER]: true })).toBe("account_id");
    // Not even in a field listed as a record id.
    expect(rule({ askId: OTHER }, ["askId"])).toBe("account_id");
    expect(valuesOk({ handle: "maya-okafor", by: OTHER })).toThrow(/a value at depth 1 carries an account id/);
    expect(valuesOk({ handle: "maya-okafor", by: { who: [OTHER] } })).toThrow(/a value at depth 2 carries an account id/);
    expect(valuesOk({ handle: "maya-okafor", [OTHER]: true })).toThrow(/a key at depth 1 carries an account id/);
  });

  it("finds an account id in every common spelling, as a value, in a list, in a sentence and as a key", () => {
    for (const [how, value] of Object.entries(SPELLINGS)) {
      expect(ruleOf(valuesOk({ handle: "maya-okafor", n: value })), how).toBe("account_id");
      expect(ruleOf(valuesOk({ handle: "maya-okafor", deep: [{ list: [`see ${value}.`] }] })), `${how}, nested in text`).toBe("account_id");
      expect(ruleOf(valuesOk({ handle: "maya-okafor", [value]: true })), `${how}, as a key`).toBe("account_id");
      // The handle itself, where the declared schema would let letters, digits and hyphens through.
      expect(ruleOf(valuesOk({ handle: value })), `${how}, as the handle`).toBe("account_id");
      // And the row's own person's id, in the same spelling.
      expect(ruleOf(valuesOk({ handle: "maya-okafor", n: value.replace(/./g, (c) => c) }, [], [OTHER])), `${how}, own`).toBe("account_id");
    }
  });

  it("refuses anything shaped like an id that is not a declared record id holding one plain UUID", () => {
    const rule = (payload: unknown, recordIds: string[] = []) => ruleOf(valuesOk(payload, recordIds, [ME]));
    // The same spellings of an id that is nobody's in this call: still id-shaped.
    for (const [how, value] of Object.entries(SPELLINGS)) {
      expect(rule({ handle: "maya-okafor", n: value }), how).toBe("id_shaped");
      expect(rule({ handle: value }), `${how}, as the handle`).toBe("id_shaped");
    }
    expect(rule({ handle: "maya-okafor", ref: RECORD })).toBe("id_shaped");
    expect(rule({ handle: `x${RECORD}` })).toBe("id_shaped");
    // A declared record id holds one plain UUID and nothing around it, in no other spelling.
    expect(rule({ askId: RECORD }, ["askId"])).toBeNull();
    expect(rule({ askId: `ask ${RECORD}` }, ["askId"])).toBe("id_shaped");
    expect(rule({ askId: RECORD.replace(/-/g, "") }, ["askId"])).toBe("id_shaped");
    expect(rule({ askId: RECORD.replace(/-/g, "‐") }, ["askId"])).toBe("id_shaped");
    expect(rule({ [RECORD]: "x" }, [RECORD])).toBe("id_shaped");
    expect(valuesOk({ handle: "maya-okafor", ref: RECORD })).toThrow(/a value at depth 1 carries something shaped like an id/);
    // Text that is not shaped like an id passes: short runs, words with hyphens, a date.
    expect(rule({ handle: "dead-beef-cafe", note: "0a1b2c3d-0a1b-4a1b", at: "2026-11-12T09:00:00.000Z", between: "Nov 12, 2026 9:00 AM to Nov 13, 2026 10:30 AM", n: "1234567890123456789012345678901" })).toBeNull();
    expect(looksLikeAnId("maya-okafor")).toBe(false);
    expect(looksLikeAnId(`x${RECORD}`)).toBe(true);
    expect(accountIdText("0A1B‐2C3D—x-Y－Z a.b:c_d")).toBe("0a1b2c3dxyzabcd");
  });

  it("refuses an email address, a key the schema would refuse, and a payload that is not an object", () => {
    const rule = (payload: unknown) => ruleOf(valuesOk(payload));
    expect(rule({ handle: "maya-okafor", note: "write to ana@example.com" })).toBe("email");
    expect(rule({ handle: "maya-okafor", list: ["a", "b@c.io"] })).toBe("email");
    expect(rule({ handle: "maya-okafor", ["ana@example.com"]: 1 })).toBe("email");
    expect(rule({ handle: "maya-okafor", note: "ana＠example.com" })).toBe("email");
    expect(rule({ handle: "maya-okafor", followerId: "x" })).toBe("account_key");
    expect(rule({ handle: "maya-okafor", by: { email: "x" } })).toBe("private_key");
    expect(rule("maya-okafor")).toBe("not_object");
    expect(rule([{ handle: "maya-okafor" }])).toBe("not_object");
    expect(rule(null)).toBe("not_object");
  });

  it("a refusal says which rule and how deep, and never repeats a key or a value", () => {
    const secret = "PRIVATE-thing-nobody-should-log";
    const payloads: unknown[] = [
      { handle: "maya-okafor", by: OTHER },
      { handle: "maya-okafor", [OTHER]: true },
      { handle: "maya-okafor", [COMPACT]: true },
      { handle: "maya-okafor", ["ana@example.com"]: true },
      { handle: "maya-okafor", note: `${secret} ana@example.com` },
      { handle: "maya-okafor", [secret]: { email: "x" } },
      { handle: "maya-okafor", [secret]: { [`${secret}UserId`]: "x" } },
      { handle: "maya-okafor", [secret]: [`${secret} ${RECORD}`] },
      { handle: "maya-okafor", [`${secret}@example.com`]: 1 },
    ];
    for (const payload of payloads) {
      let caught: unknown;
      try {
        valuesOk(payload)();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AccountRuleError);
      expect(caught).toBeInstanceOf(ValidationError);
      const error = caught as AccountRuleError;
      const said = JSON.stringify([error.message, error.details, String(error)]);
      for (const word of [OTHER, COMPACT, RECORD, "ana@example.com", "example.com", secret, "PRIVATE"]) expect(said, word).not.toContain(word);
      expect(Object.keys(error.details as object).sort()).toEqual(["depth", "part", "rule", "type"]);
      expect(error.message).toMatch(/^Account event profile\.published: a (key|value) at depth [1-3] /);
    }
  });
});

describe("assertAccountActor", () => {
  const actorOk = (actor: unknown) => () => assertAccountActor("profile.published", actor as never, ME);
  const rule = (actor: unknown) => ruleOf(actorOk(actor));

  it("accepts the person themselves and the system by a lowercase word", () => {
    expect(actorOk({ kind: "user", id: ME })).not.toThrow();
    expect(actorOk({ kind: "user", id: ME.toUpperCase() })).not.toThrow();
    expect(actorOk({ kind: "system", id: "platform" })).not.toThrow();
    expect(actorOk({ kind: "system", id: "public-page:follow_form.v2" })).not.toThrow();
  });

  it("refuses a second party: another person, an agent, a webhook, or a system name that hides an id or an address", () => {
    expect(rule({ kind: "user", id: OTHER })).toBe("actor_other_person");
    expect(rule({ kind: "user", id: ME.replace(/-/g, "") })).toBe("actor_other_person");
    expect(rule({ kind: "agent", id: fixtureId("agent") })).toBe("actor_kind");
    expect(rule({ kind: "webhook", id: "stripe" })).toBe("actor_kind");
    for (const [how, value] of Object.entries(SPELLINGS)) {
      expect(rule({ kind: "system", id: value }), how).toBe("actor_not_a_word");
      expect(rule({ kind: "system", id: `follow:${value}` }), `${how}, behind a prefix`).toBe("actor_not_a_word");
    }
    for (const id of ["ana@example.com", "Platform", "platform team", "9lives", "x".repeat(64)]) expect(rule({ kind: "system", id }), id).toBe("actor_not_a_word");
    expect(actorOk({ kind: "user", id: OTHER })).toThrow(/a user actor must be the person the row belongs to/);
    expect(actorOk({ kind: "agent", id: fixtureId("agent") })).toThrow(/the person themselves or the system$/);
    expect(actorOk({ kind: "system", id: OTHER })).toThrow(/named by a lowercase word/);
  });

  it("is exactly { kind, id }: nothing else rides in the actor, and a refusal repeats nothing of it", () => {
    for (const actor of [{ kind: "system", id: "" }, { kind: "system" }, { id: "platform" }, { kind: "system", id: 7 }, { kind: "system", id: "platform", other: OTHER }, { kind: "user", id: ME, onBehalfOf: OTHER }, "platform", null, undefined]) {
      expect(rule(actor), JSON.stringify(actor)).toBe("actor_shape");
    }
    for (const actor of [{ kind: "system", id: `follow:${COMPACT}` }, { kind: "PRIVATE-kind", id: "x" }, { kind: "system", id: "platform", ["ana@example.com"]: OTHER }]) {
      let caught: unknown;
      try {
        actorOk(actor)();
      } catch (err) {
        caught = err;
      }
      const error = caught as AccountRuleError;
      const said = JSON.stringify([error.message, error.details]);
      for (const word of [OTHER, COMPACT, "ana@example.com", "PRIVATE"]) expect(said, word).not.toContain(word);
    }
  });
});
