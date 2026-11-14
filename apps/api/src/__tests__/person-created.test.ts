/**
 * `onPersonCreated` (services/person-created.ts): the one place that runs what must happen once when a person's
 * profile is first created, called by `founder.profile.update` on the save that creates the profile.
 *
 * The attribution step still runs, on that save and no other; every step runs in its own transaction and its own
 * try/catch, so a step that throws does not stop the others, does not take back what an earlier one wrote and never
 * fails the save or changes its answer; a failure is logged with the account id, the step's name and a reason code,
 * never an input value; and `ideaDraftToken` is accepted, bounded, passed to the steps and read by none of them yet.
 */
import { repos, type Db } from "@foundmill/db";
import type { PersonProfileContent } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as attributionService from "../services/attribution";
import { recordSignupAttribution } from "../services/attribution";
import { IDEA_DRAFT_TOKEN_MAX_LENGTH, onPersonCreated, PERSON_CREATED_STEPS, type PersonCreatedStep } from "../services/person-created";
import { createApiHarness, type ApiHarness } from "./harness";

// The real attribution service behind a spy, so one test can make the step throw on the way through the router.
vi.mock("../services/attribution", async (importOriginal) => {
  const real = await importOriginal<typeof attributionService>();
  return { ...real, recordSignupAttribution: vi.fn(real.recordSignupAttribution) };
});

let hz: ApiHarness;
/** A person with a public profile at /u/ida-moss. */
let ida: string;

const person = (): PersonProfileContent => ({ headline: "Baker", about: "I bake bread.", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", place: "" });
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => ((await hz.db.execute(q)) as unknown as { rows: T[] }).rows;
const eventTypes = async (userId: string) => (await rows<{ type: string }>(sql`select type from account_events where user_id = ${userId}::uuid order by created_at, id`)).map((r) => r.type);
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "unknown");
const capture = () => {
  const lines: string[] = [];
  return { lines, log: pino({ level: "debug" }, { write: (line: string) => void lines.push(line) }) };
};

let n = 0;
/** A signed-in account with no profile yet. */
async function newcomer() {
  n += 1;
  const userId = await hz.h.createUser(`person-created-${n}@test.local`);
  return { userId, me: hz.caller({ userId, email: `person-created-${n}@test.local` }) };
}
const answer = { displayName: "Newcomer", experience: "first_time", skills: { marketing: 8 }, targetMarkets: ["US"], riskAppetite: "medium" };
/** The mutation's answer without what differs per account. */
const comparable = (result: Record<string, unknown>) => Object.fromEntries(Object.entries(result).filter(([key]) => !["id", "userId", "createdAt", "updatedAt"].includes(key)));

const TOKEN = "idea-draft-token-PRIVATE-9f2c";

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "person-created" });
  ida = await hz.h.createUser("person-created-ida@test.local");
  await repos.founders.upsert(hz.db, ida, { displayName: "Ida Moss" });
  await repos.personProfiles.save(hz.db, ida, { handle: "ida-moss", content: person() });
  await repos.personProfiles.publish(hz.db, ida);
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => vi.mocked(recordSignupAttribution).mockClear());

describe("founder.profile.update runs onPersonCreated on the save that creates the profile", () => {
  it("the attribution step still runs: the row and its two account events are written, once", async () => {
    // An accepted invitation outranks the cookie's reference (services/attribution.ts `recordInvitationAttribution`).
    expect(PERSON_CREATED_STEPS.map((step) => step.name)).toEqual(["invitation_attribution", "signup_attribution", "adult_confirmation"]);
    const p = await newcomer();
    await p.me.founder.profile.update({ confirmAdult: true, ...answer, via: "u.ida-moss" });
    expect(recordSignupAttribution).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordSignupAttribution).mock.calls[0]!.slice(1)).toEqual([p.userId, "u.ida-moss"]);
    expect(await repos.attributions.forUser(hz.db, p.userId)).toMatchObject({ sourceKind: "person_profile", sourceRef: "ida-moss", referrerUserId: ida });
    expect(await eventTypes(p.userId)).toEqual(["signup.attributed"]);
    expect(await eventTypes(ida)).toContain("referral.arrived");

    // A later save is not the save that creates the profile: no step runs, whatever it carries.
    await p.me.founder.profile.update({ confirmAdult: true, displayName: "Renamed", via: "u.ida-moss", ideaDraftToken: TOKEN });
    expect(recordSignupAttribution).toHaveBeenCalledTimes(1);
    expect(await eventTypes(p.userId)).toEqual(["signup.attributed"]);
  });

  it("a step that throws never fails the save or changes its answer", async () => {
    const plain = await newcomer();
    const expected = comparable(await plain.me.founder.profile.update({ ...answer, confirmAdult: true }));

    vi.mocked(recordSignupAttribution).mockRejectedValueOnce(new Error("Failed query: select … params: ida-moss"));
    const p = await newcomer();
    const saved = await p.me.founder.profile.update({ confirmAdult: true, ...answer, via: "u.ida-moss", ideaDraftToken: TOKEN });
    expect(comparable(saved)).toEqual(expected);
    expect(await repos.founders.get(hz.db, p.userId)).toMatchObject({ displayName: "Newcomer" });
    // The step did not run to its end, and the save stands without it.
    expect(await repos.attributions.forUser(hz.db, p.userId)).toBeNull();
    expect(await eventTypes(p.userId)).toEqual([]);

    // A synchronous throw is caught the same way.
    vi.mocked(recordSignupAttribution).mockImplementationOnce(() => {
      throw new TypeError("thrown before any promise");
    });
    const q = await newcomer();
    expect(comparable(await q.me.founder.profile.update({ confirmAdult: true, ...answer, via: "u.ida-moss" }))).toEqual(expected);
    // The next person is attributed as ever.
    const r = await newcomer();
    await r.me.founder.profile.update({ confirmAdult: true, ...answer, via: "u.ida-moss" });
    expect(await repos.attributions.forUser(hz.db, r.userId)).not.toBeNull();
  });

  it("ideaDraftToken is accepted and ignored: the same answer, nothing stored, nothing read", async () => {
    const plain = await newcomer();
    const expected = comparable(await plain.me.founder.profile.update({ ...answer, confirmAdult: true }));
    const before = (await rows<{ n: number }>(sql`select (select count(*)::int from account_events) + (select count(*)::int from attributions) + (select count(*)::int from events) as n`))[0]!.n;

    const p = await newcomer();
    const saved = await p.me.founder.profile.update({ confirmAdult: true, ...answer, ideaDraftToken: TOKEN });
    expect(comparable(saved)).toEqual(expected);
    expect(saved).not.toHaveProperty("ideaDraftToken");
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
    // It reached the one place that will read it, and no step did anything with it.
    expect(recordSignupAttribution).toHaveBeenLastCalledWith(expect.anything(), p.userId, undefined);
    expect((await rows<{ n: number }>(sql`select (select count(*)::int from account_events) + (select count(*)::int from attributions) + (select count(*)::int from events) as n`))[0]!.n).toBe(before);
    expect(JSON.stringify(await repos.founders.get(hz.db, p.userId))).not.toContain(TOKEN);

    // Beside a reference, the reference is still recorded and the token still changes nothing.
    const q = await newcomer();
    expect(comparable(await q.me.founder.profile.update({ confirmAdult: true, ...answer, via: "u.ida-moss", ideaDraftToken: TOKEN }))).toEqual(expected);
    expect(await repos.attributions.forUser(hz.db, q.userId)).toMatchObject({ sourceRef: "ida-moss" });
    expect(JSON.stringify(await rows(sql`select to_jsonb(e)::text as t from account_events e where e.user_id in (${q.userId}::uuid, ${ida}::uuid)`))).not.toContain(TOKEN);
  });

  it("ideaDraftToken is bounded: 200 characters at most, text only, refused before anything is read", async () => {
    expect(IDEA_DRAFT_TOKEN_MAX_LENGTH).toBe(200);
    const p = await newcomer();
    expect(await code(p.me.founder.profile.update({ confirmAdult: true, ...answer, ideaDraftToken: "t".repeat(201) }))).toBe("BAD_REQUEST");
    expect(await code(p.me.founder.profile.update({ confirmAdult: true, ...answer, ideaDraftToken: 42 as never }))).toBe("BAD_REQUEST");
    expect(await code(p.me.founder.profile.update({ confirmAdult: true, ...answer, ideaDraftToken: { token: TOKEN } as never }))).toBe("BAD_REQUEST");
    expect(await repos.founders.get(hz.db, p.userId)).toBeNull();
    expect(recordSignupAttribution).not.toHaveBeenCalled();
    expect(await code(p.me.founder.profile.update({ confirmAdult: true, ...answer, ideaDraftToken: "t".repeat(200) }))).toBe("ok");
    expect(await code(hz.caller(null).founder.profile.update({ confirmAdult: true, ...answer, ideaDraftToken: TOKEN }))).toBe("UNAUTHORIZED");
  });
});

describe("onPersonCreated", () => {
  it("a throwing step does not stop the others, and what an earlier step wrote stays written", async () => {
    const { lines, log } = capture();
    const p = await newcomer();
    const ran: string[] = [];
    const attribution = PERSON_CREATED_STEPS.find((step) => step.name === "signup_attribution")!;
    const steps: PersonCreatedStep[] = [
      // Writes in its own transaction, then a later step fails: the row stays.
      { name: "signup_attribution", run: attribution.run },
      {
        name: "throws_with_the_inputs",
        run: async (_deps, _userId, input) => {
          ran.push("throws_with_the_inputs");
          throw new Error(`could not use ${String(input.via)} or ${String(input.ideaDraftToken)}`);
        },
      },
      {
        name: "throws_at_once",
        run: () => {
          ran.push("throws_at_once");
          throw new RangeError("not a promise");
        },
      },
      {
        name: "rejects_with_a_value",
        run: () => {
          ran.push("rejects_with_a_value");
          return Promise.reject(`a text, not an error: ${TOKEN}`);
        },
      },
      {
        name: "names_itself_after_an_input",
        run: () => {
          ran.push("names_itself_after_an_input");
          const err = new Error("x");
          err.name = `via u.ida-moss ${TOKEN}`;
          throw err;
        },
      },
      {
        name: "runs_last",
        run: async (deps, userId, input) => {
          ran.push("runs_last");
          // Every step is handed the same account and the same two values.
          expect([userId, input]).toEqual([p.userId, { via: "u.ida-moss", ideaDraftToken: TOKEN }]);
          await deps.db.execute(sql`select 1`);
        },
      },
    ];
    await expect(onPersonCreated({ db: hz.db, log }, p.userId, { via: "u.ida-moss", ideaDraftToken: TOKEN }, steps)).resolves.toBeUndefined();
    expect(ran).toEqual(["throws_with_the_inputs", "throws_at_once", "rejects_with_a_value", "names_itself_after_an_input", "runs_last"]);
    // The first step's own transaction committed before the others failed.
    expect(await repos.attributions.forUser(hz.db, p.userId)).toMatchObject({ sourceRef: "ida-moss", referrerUserId: ida });
    expect(await eventTypes(p.userId)).toEqual(["signup.attributed"]);
    // One line per failed step: the account, the step and a reason code. No input value, no error text.
    expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>).map(({ level, userId, step, reason, msg }) => [level, userId, step, reason, msg])).toEqual([
      [40, p.userId, "throws_with_the_inputs", "Error", "a step after the profile was created did not finish"],
      [40, p.userId, "throws_at_once", "RangeError", "a step after the profile was created did not finish"],
      [40, p.userId, "rejects_with_a_value", "unknown", "a step after the profile was created did not finish"],
      [40, p.userId, "names_itself_after_an_input", "unknown", "a step after the profile was created did not finish"],
    ]);
    for (const line of lines) {
      for (const said of [TOKEN, "PRIVATE", "ida-moss", "u.ida", "could not use", ida]) expect(line, said).not.toContain(said);
      expect(Object.keys(JSON.parse(line) as object).sort()).toEqual(["hostname", "level", "msg", "pid", "reason", "step", "time", "userId"]);
    }
  });

  it("with the steps it ships: nothing to do reads nothing, and a database that fails is logged without the values", async () => {
    // No reference: the cookie's step returns before it opens a transaction, and the token opens none.
    const untouched = { transaction: () => Promise.reject(new Error("must not be called")), execute: () => Promise.reject(new Error("must not be called")) } as unknown as Db;
    const quiet = capture();
    const cookieStep = PERSON_CREATED_STEPS.filter((step) => step.name === "signup_attribution");
    for (const input of [{}, { ideaDraftToken: TOKEN }, { via: undefined, ideaDraftToken: TOKEN }, { via: "not a reference", ideaDraftToken: TOKEN }, { via: 42, ideaDraftToken: { not: "text" } }]) {
      await expect(onPersonCreated({ db: untouched, log: quiet.log }, (await newcomer()).userId, input, cookieStep)).resolves.toBeUndefined();
    }
    expect(quiet.lines).toEqual([]);
    // The invitation step reads one row (the person's first accepted invitation) and, with none, writes nothing.
    const none = await newcomer();
    await expect(onPersonCreated({ db: hz.db, log: quiet.log }, none.userId, {}, PERSON_CREATED_STEPS.filter((step) => step.name === "invitation_attribution"))).resolves.toBeUndefined();
    expect(await repos.attributions.forUser(hz.db, none.userId)).toBeNull();
    expect(quiet.lines).toEqual([]);

    // A failing database under the attribution step: its own line, and still no value.
    const failing = { transaction: async () => Promise.reject(new Error(`Failed query: … params: ida-moss ${TOKEN}`)) } as unknown as Db;
    const loud = capture();
    const p = await newcomer();
    await expect(onPersonCreated({ db: failing, log: loud.log }, p.userId, { via: "u.ida-moss", ideaDraftToken: TOKEN }, cookieStep)).resolves.toBeUndefined();
    expect(loud.lines).toHaveLength(1);
    expect(JSON.parse(loud.lines[0]!)).toMatchObject({ userId: p.userId, error: "Error", msg: "signup attribution was not recorded" });
    for (const said of [TOKEN, "ida-moss"]) expect(loud.lines[0], said).not.toContain(said);

    // A logger that fails does not stop the steps either.
    const broken = { warn: () => { throw new Error("the log is away"); } } as unknown as ReturnType<typeof capture>["log"];
    const ran: string[] = [];
    await expect(
      onPersonCreated({ db: hz.db, log: broken }, p.userId, {}, [
        { name: "throws", run: () => Promise.reject(new Error("x")) },
        { name: "after", run: async () => void ran.push("after") },
      ]),
    ).resolves.toBeUndefined();
    expect(ran).toEqual(["after"]);
  });
});
