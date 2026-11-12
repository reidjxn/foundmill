/**
 * The two-person rule as code (../account-payload): what an account event's payload schema may declare, what a payload
 * may carry when it is written, and who may be its actor. A payload names another person only by something public
 * about them (a handle); never by account id, email address or a private field.
 */
import { ACCOUNT_EVENT_TYPES, ValidationError } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { accountPayloadKeyProblem, assertAccountActor, assertAccountPayloadSchema, assertAccountPayloadValues } from "../account-payload";
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

  it("every account-scoped declaration in the catalog passes, and names nobody but by a handle", () => {
    for (const type of ACCOUNT_EVENT_TYPES) {
      const decl = EVENTS[type];
      expect(() => assertAccountPayloadSchema(type, decl.schema, decl.recordIds), type).not.toThrow();
      expect(() => assertAccountPayloadValues(type, EVENT_FIXTURES[type], { recordIds: decl.recordIds, accountIds: [ME] }), type).not.toThrow();
      expect(Object.keys(EVENT_FIXTURES[type]), type).toEqual(["handle"]);
      expect(decl.recordIds, type).toEqual([]);
      // Nothing else gets through the schema: it is strict.
      expect(decl.schema.safeParse({ handle: "maya-okafor", userId: ME }).success, type).toBe(false);
      expect(decl.schema.safeParse({ handle: "Maya Okafor" }).success, type).toBe(false);
    }
  });
});

describe("assertAccountPayloadValues (when an event is written)", () => {
  it("accepts a public handle and a listed record id", () => {
    expect(valuesOk({ handle: "maya-okafor", by: { handle: "bo-ode" }, tags: ["a", "b"], count: 2, open: true, none: null })).not.toThrow();
    expect(valuesOk({ askId: RECORD, asks: [RECORD] }, ["askId", "asks"])).not.toThrow();
  });

  it("refuses the account id of anyone the fact is about, wherever it hides", () => {
    const refused = /carries an account id/;
    expect(valuesOk({ handle: "maya-okafor", by: OTHER })).toThrow(refused);
    expect(valuesOk({ handle: "maya-okafor", self: ME })).toThrow(refused);
    expect(valuesOk({ handle: "maya-okafor", list: [{ deep: [OTHER.toUpperCase()] }] })).toThrow(refused);
    expect(valuesOk({ handle: "maya-okafor", note: `seen by ${OTHER} today` })).toThrow(refused);
    expect(valuesOk({ handle: "maya-okafor", [OTHER]: true })).toThrow(refused);
    // Not even in a field listed as a record id.
    expect(valuesOk({ askId: OTHER }, ["askId"])).toThrow(refused);
    // The error says where, never what: not the id as a value, and not the id as a key.
    for (const payload of [{ handle: "maya-okafor", by: OTHER }, { handle: "maya-okafor", [OTHER]: true }, { handle: "maya-okafor", ["ana@example.com"]: true }]) {
      let caught: unknown;
      try {
        valuesOk(payload)();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      const said = JSON.stringify([(caught as ValidationError).message, (caught as ValidationError).details]);
      expect(said).not.toContain(OTHER);
      expect(said).not.toContain("ana@example.com");
    }
  });

  it("refuses any UUID outside the declaration's record ids, an email address, and a key the schema would refuse", () => {
    expect(valuesOk({ handle: "maya-okafor", ref: RECORD })).toThrow(/ref carries a UUID, and only the declaration's recordIds may/);
    expect(valuesOk({ askId: `ask ${RECORD}` }, ["askId"])).toThrow(/carries a UUID/);
    expect(valuesOk({ handle: "maya-okafor", note: "write to ana@example.com" })).toThrow(/note carries an email address/);
    expect(valuesOk({ handle: "maya-okafor", list: ["a", "b@c.io"] })).toThrow(/list\[1\] carries an email address/);
    expect(valuesOk({ handle: "maya-okafor", followerId: "x" })).toThrow(/names a person by an account/);
    expect(valuesOk({ handle: "maya-okafor", by: { email: "x" } })).toThrow(/by\.email/);
    expect(valuesOk("maya-okafor")).toThrow(/the payload must be an object/);
    expect(valuesOk([{ handle: "maya-okafor" }])).toThrow(/the payload must be an object/);
    expect(valuesOk(null)).toThrow(/the payload must be an object/);
  });
});

describe("assertAccountActor", () => {
  const actorOk = (actor: unknown) => () => assertAccountActor("profile.published", actor as never, ME);

  it("accepts the person themselves and the system by a word", () => {
    expect(actorOk({ kind: "user", id: ME })).not.toThrow();
    expect(actorOk({ kind: "user", id: ME.toUpperCase() })).not.toThrow();
    expect(actorOk({ kind: "system", id: "platform" })).not.toThrow();
  });

  it("refuses a second party: another person, an agent, a webhook, or a system name that hides an id or an address", () => {
    expect(actorOk({ kind: "user", id: OTHER })).toThrow(/a user actor must be the person the row belongs to/);
    expect(actorOk({ kind: "agent", id: fixtureId("agent") })).toThrow(/the person themselves or the system, not "agent"/);
    expect(actorOk({ kind: "webhook", id: "stripe" })).toThrow(/not "webhook"/);
    expect(actorOk({ kind: "system", id: OTHER })).toThrow(/named by a word/);
    expect(actorOk({ kind: "system", id: `follow:${OTHER}` })).toThrow(/named by a word/);
    expect(actorOk({ kind: "system", id: "ana@example.com" })).toThrow(/named by a word/);
    expect(actorOk({ kind: "system", id: "" })).toThrow(/actor must be/);
    expect(actorOk(undefined)).toThrow(/actor must be/);
  });
});
