/**
 * founder.publicProfile.* and publicPerson.byHandle — a person's own public profile at /u/<handle> (package 2.3, first
 * part; services/person-profile.ts).
 *
 * Signed in only for the person's own; a suggested address until the first save; nothing public until Publish; the
 * deterministic screen holds an email address, a phone number or markup (before going public, and on a save while
 * public); the address follows the page rule and is one person's; the signed-out read gives the view's columns only,
 * and null for anything not public; private fields never leave; a person building on their own is asked nothing more.
 */
import { repos } from "@foundmill/db";
import { PERSON_HANDLE_RESERVED, PERSON_HANDLE_TAKEN, PERSON_HOLD_MESSAGES, type PersonProfileContent, type ProjectPageContent } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROFILE_MISSING_MESSAGE, PUBLIC_PERSON_LIMITS, PUBLIC_PROFILE_OWN_LIMITS, handlePosesAsPlatform, profileHoldReason, publicPersonByHandle, publicPersonLimitKeys, publishPublicProfile } from "../services/person-profile";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "person" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const content = (over: Partial<PersonProfileContent> = {}): PersonProfileContent => ({ headline: "Baker who wants to sell online", about: "I bake sourdough at home.\n\nI want to learn how to sell it.", strengths: ["Baking", "Talking to people"], wantsToLearn: ["Selling"], lookingFor: "on_my_own", place: "Leeds, UK", ...over });

let n = 0;
async function person(displayName: string, options: { profile?: boolean } = {}) {
  n += 1;
  const userId = await hz.h.createUser(`person-${n}@test.local`);
  if (options.profile !== false) await repos.founders.upsert(hz.db, userId, { displayName, experience: "PRIVATE-experience", residence: "PRIVATE-residence", citizenship: "PRIVATE-citizenship", budgetMinor: 1_234_567, skills: { finance: 19 }, constraints: ["PRIVATE-constraint"], riskAppetite: "PRIVATE-risk", timeCommitment: "PRIVATE-time", targetMarkets: ["PRIVATE-market"] });
  return { userId, me: hz.caller({ userId }) };
}

const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "unknown");

async function fill(key: string, rule: { limit: number; windowMs: number }, left = 0) {
  for (let i = 0; i < rule.limit - left; i++) await hz.limits.take([{ key, rule }]);
}
/** How many hits `key` holds in its window now (taken back at once). */
async function hits(key: string, windowMs = 60_000): Promise<number> {
  const probe = await hz.limits.take([{ key, rule: { limit: 100_000, windowMs } }]);
  if (!probe.ok) throw new Error("probe refused");
  await hz.limits.refund(probe.ticket);
  return 100_000 - 1 - probe.remaining;
}

describe("founder.publicProfile", () => {
  it("is the signed-in person's own: signed out is refused, and nobody reads anyone else's", async () => {
    expect(await code(hz.caller(null).founder.publicProfile.get())).toBe("UNAUTHORIZED");
    expect(await code(hz.caller(null).founder.publicProfile.publish({ content: content() }))).toBe("UNAUTHORIZED");
    const a = await person("Ana Ruiz");
    const b = await person("Ben Ode");
    await a.me.founder.publicProfile.update({ content: content({ headline: "Ana's" }) });
    expect((await b.me.founder.publicProfile.get()).content.headline).toBe("");
  });

  it("starts private, with every field empty, 'Building on my own' and a suggested address; nothing is written", async () => {
    const p = await person("Maya Okafor");
    const view = await p.me.founder.publicProfile.get();
    expect(view).toMatchObject({ saved: false, public: false, publishedAt: null, displayName: "Maya Okafor", projects: [], content: { headline: "", about: "", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", place: "" } });
    expect(view.handle).toMatch(/^maya-okafor/);
    expect(view.url).toBe(`http://localhost:3000/u/${view.handle}`);
    expect((await repos.personProfiles.get(hz.db, p.userId))?.handle).toBeNull();
    // A second Maya is offered another address.
    const twin = await person("Maya Okafor");
    await p.me.founder.publicProfile.update({ content: content() });
    const other = await twin.me.founder.publicProfile.get();
    expect(other.handle).not.toBe(view.handle);
    expect(other.handle).toMatch(/^maya-okafor-[0-9a-f]{4}$/);
  });

  it("an account without a profile is told to finish it first", async () => {
    const p = await person("Nobody", { profile: false });
    await expect(p.me.founder.publicProfile.get()).rejects.toThrow(PROFILE_MISSING_MESSAGE);
  });

  it("saves (tidied, the address stored on the first save), publishes, keeps the date on changes and takes it down", async () => {
    const p = await person("Sam Lee");
    const saved = await p.me.founder.publicProfile.update({ content: content({ headline: "  Baker\n in Leeds ", strengths: ["Baking", "baking", " Writing "] }) });
    expect(saved.outcome).toBe("saved");
    expect(saved.profile).toMatchObject({ saved: true, public: false, handle: "sam-lee", content: { headline: "Baker in Leeds", strengths: ["Baking", "Writing"] } });
    expect(await hz.caller(null).publicPerson.byHandle({ handle: "sam-lee" })).toBeNull();

    const published = await p.me.founder.publicProfile.publish({ content: content({ lookingFor: "looking_for_cofounder" }) });
    expect(published.outcome).toBe("published");
    expect(published.profile).toMatchObject({ public: true, content: { lookingFor: "looking_for_cofounder" } });
    const firstDate = published.profile.publishedAt;
    expect(firstDate).toBeTruthy();

    const anon = hz.caller(null);
    const pub = await anon.publicPerson.byHandle({ handle: "sam-lee" });
    expect(pub).toMatchObject({ handle: "sam-lee", url: "http://localhost:3000/u/sam-lee", displayName: "Sam Lee", headline: content().headline, lookingFor: "looking_for_cofounder", place: "Leeds, UK", projects: [] });
    // Exactly the public fields, nothing of the account.
    expect(Object.keys(pub!).sort()).toEqual(["about", "displayName", "handle", "headline", "lookingFor", "place", "projects", "publishedAt", "strengths", "url", "wantsToLearn"]);
    const text = JSON.stringify(pub);
    for (const secret of ["PRIVATE", "1234567", "finance", "test.local", p.userId]) expect(text, secret).not.toContain(secret);

    // A change while public is live at once, and keeps the date.
    const changed = await p.me.founder.publicProfile.update({ content: content({ headline: "Sourdough, by bike" }) });
    expect(changed.outcome).toBe("saved");
    expect(changed.profile.publishedAt).toEqual(firstDate);
    expect((await anon.publicPerson.byHandle({ handle: "sam-lee" }))?.headline).toBe("Sourdough, by bike");

    const down = await p.me.founder.publicProfile.unpublish();
    expect(down).toMatchObject({ public: false, content: { headline: "Sourdough, by bike" } });
    expect(await anon.publicPerson.byHandle({ handle: "sam-lee" })).toBeNull();
    // Taking a private profile down changes nothing.
    expect((await p.me.founder.publicProfile.unpublish()).public).toBe(false);
  });

  it("holds an email address, a phone number or markup before it goes public, and while it is public", async () => {
    const p = await person("Lee Park");
    const cases: [Partial<PersonProfileContent>, "personal_data" | "markup"][] = [
      [{ about: "Write to me at lee@example.com" }, "personal_data"],
      [{ headline: "Call +44 7700 900123" }, "personal_data"],
      [{ strengths: ["<script>x</script>"] }, "markup"],
      [{ place: "javascript:alert(1)" }, "markup"],
    ];
    for (const [over, reason] of cases) {
      const held = await p.me.founder.publicProfile.publish({ content: content(over) });
      expect(held, JSON.stringify(over)).toMatchObject({ outcome: "held", reason, message: PERSON_HOLD_MESSAGES[reason], profile: { public: false } });
    }
    // Held while private: the words are kept, still private.
    expect((await p.me.founder.publicProfile.get()).content.place).toBe("javascript:alert(1)");
    expect(await hz.caller(null).publicPerson.byHandle({ handle: "lee-park" })).toBeNull();

    // Public, then a save that would put a phone number on it: nothing changes.
    await p.me.founder.publicProfile.publish({ content: content() });
    const held = await p.me.founder.publicProfile.update({ content: content({ about: "Text me: 555 123 4567" }) });
    expect(held).toMatchObject({ outcome: "held", reason: "personal_data" });
    expect((await hz.caller(null).publicPerson.byHandle({ handle: "lee-park" }))?.about).toBe(content().about);
    const heldPublish = await p.me.founder.publicProfile.publish({ content: content({ about: "lee@example.com" }) });
    expect(heldPublish.outcome).toBe("held");
    expect((await repos.personProfiles.get(hz.db, p.userId))?.content.about).toBe(content().about);
    // The name is screened too.
    expect(profileHoldReason(content(), "Lee lee@example.com")).toBe("personal_data");
    expect(profileHoldReason(content(), "Lee Park")).toBeNull();
  });

  it("the address follows the page rule and is one person's", async () => {
    const a = await person("Ivy Stone");
    const b = await person("Ivo Stone");
    await a.me.founder.publicProfile.update({ handle: "ivy", content: content() });
    expect((await a.me.founder.publicProfile.get()).handle).toBe("ivy");
    await expect(b.me.founder.publicProfile.update({ handle: "ivy", content: content() })).rejects.toThrow(PERSON_HANDLE_TAKEN);
    await expect(b.me.founder.publicProfile.update({ handle: "login", content: content() })).rejects.toThrow(/kept for the product/);
    await expect(b.me.founder.publicProfile.update({ handle: "a", content: content() })).rejects.toThrow(/at least 3/);
    // Upper case is tidied; a handle may match a project page's address (they live under /u/ and /p/).
    expect((await b.me.founder.publicProfile.update({ handle: " IVO-STONE ", content: content() })).profile.handle).toBe("ivo-stone");
  });

  it("refuses fields over their limits, naming the field", async () => {
    const p = await person("Over Limit");
    await expect(p.me.founder.publicProfile.update({ content: content({ headline: "x".repeat(81) }) })).rejects.toThrow(/headline to 80/);
    await expect(p.me.founder.publicProfile.update({ content: content({ strengths: Array.from({ length: 9 }, (_, i) => `Tag ${i}`) }) })).rejects.toThrow(/8 tags/);
    await expect(p.me.founder.publicProfile.update({ content: content({ wantsToLearn: ["x".repeat(31)] }) })).rejects.toThrow(/30 characters/);
  });

  it("lists the person's published project pages only where the page names its founders", async () => {
    const p = await person("Rae Field");
    const b = await repos.businesses.create(hz.db, { name: `Field Bakes ${n}`, archetype: "b2b_saas" });
    await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
    await repos.memberships.add(hz.db, b.id, { userId: p.userId, role: "owner" });
    const page = (showFounders: boolean): ProjectPageContent => ({ pitch: "Bread by bike", about: "Fresh bread.", forWhom: "", stage: "building", showFounders, followForm: false });
    await repos.pages.publish(hz.db, b.id, { content: page(false), slug: `field-bakes-${n}`, userId: p.userId });
    await p.me.founder.publicProfile.publish({ content: content() });
    const anon = hz.caller(null);
    expect((await anon.publicPerson.byHandle({ handle: "rae-field" }))?.projects).toEqual([]);
    expect((await p.me.founder.publicProfile.get()).projects).toEqual([]);
    await repos.pages.publish(hz.db, b.id, { content: page(true), slug: `field-bakes-${n}`, userId: p.userId });
    expect((await anon.publicPerson.byHandle({ handle: "rae-field" }))?.projects).toEqual([{ slug: `field-bakes-${n}`, name: b.name, pitch: "Bread by bike", path: `/p/field-bakes-${n}` }]);
    expect((await p.me.founder.publicProfile.get()).projects).toHaveLength(1);
  });

  it("'Building on my own' is kept as the answer, and nothing public says anything about people", async () => {
    const p = await person("Solo Founder");
    const view = await p.me.founder.publicProfile.publish({ content: content({ lookingFor: "on_my_own" }) });
    expect(view.profile.content.lookingFor).toBe("on_my_own");
    const pub = await hz.caller(null).publicPerson.byHandle({ handle: "solo-founder" });
    expect(pub?.lookingFor).toBe("on_my_own");
  });
});

describe("publicPerson.byHandle", () => {
  it("an unknown, malformed or private handle reads as nothing, the same for each", async () => {
    const anon = hz.caller(null);
    expect(await anon.publicPerson.byHandle({ handle: "no-such-person" })).toBeNull();
    expect(await anon.publicPerson.byHandle({ handle: "Not A Handle" })).toBeNull();
    expect(await anon.publicPerson.byHandle({ handle: "" })).toBeNull();
    const p = await person("Quiet Person");
    await p.me.founder.publicProfile.update({ content: content() });
    expect(await anon.publicPerson.byHandle({ handle: "quiet-person" })).toBeNull();
  });

  it("an archived profile is gone from the public read", async () => {
    const p = await person("Gone Person");
    await p.me.founder.publicProfile.publish({ content: content() });
    expect(await hz.caller(null).publicPerson.byHandle({ handle: "gone-person" })).not.toBeNull();
    await hz.db.execute(sql`update founder_profiles set archived_at = now() where user_id = ${p.userId}`);
    expect(await hz.caller(null).publicPerson.byHandle({ handle: "gone-person" })).toBeNull();
  });
});

describe("the display name, changed in Your profile", () => {
  it("is screened while the public profile is public, and refused with the profile's sentence", async () => {
    const p = await person("Nia Cole");
    await p.me.founder.publicProfile.publish({ content: content() });
    for (const [name, reason] of [["Nia nia@example.com", "personal_data"], ["Nia 555 201 3344", "personal_data"], ["Nia <script>", "markup"]] as const) {
      await expect(p.me.founder.profile.update({ confirmAdult: true, displayName: name }), name).rejects.toThrow(PERSON_HOLD_MESSAGES[reason]);
    }
    expect((await hz.caller(null).publicPerson.byHandle({ handle: "nia-cole" }))?.displayName).toBe("Nia Cole");
    // An ordinary new name goes out at once.
    await p.me.founder.profile.update({ confirmAdult: true, displayName: "Nia Cole-Hart" });
    expect((await hz.caller(null).publicPerson.byHandle({ handle: "nia-cole" }))?.displayName).toBe("Nia Cole-Hart");
  });

  it("is screened while a published project page names the person, even with a private profile", async () => {
    const p = await person("Omar Diaz");
    const b = await repos.businesses.create(hz.db, { name: `Omar Makes ${n}`, archetype: "b2b_saas" });
    await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
    await repos.memberships.add(hz.db, b.id, { userId: p.userId, role: "owner" });
    const page = (showFounders: boolean): ProjectPageContent => ({ pitch: "Chairs", about: "Made by hand.", forWhom: "", stage: "building", showFounders, followForm: false });
    // A page that does not name its founders: the name is nobody else's business.
    await repos.pages.publish(hz.db, b.id, { content: page(false), slug: `omar-makes-${n}`, userId: p.userId });
    await p.me.founder.profile.update({ confirmAdult: true, displayName: "Omar omar@example.com" });
    await p.me.founder.profile.update({ confirmAdult: true, displayName: "Omar Diaz" });
    // Named on it: held.
    await repos.pages.publish(hz.db, b.id, { content: page(true), slug: `omar-makes-${n}`, userId: p.userId });
    await expect(p.me.founder.profile.update({ confirmAdult: true, displayName: "Omar omar@example.com" })).rejects.toThrow(PERSON_HOLD_MESSAGES.personal_data);
    expect((await hz.caller(null).publicPage.bySlug({ slug: `omar-makes-${n}` }))?.founderNames).toEqual(["Omar Diaz"]);
    // Other fields of the profile change as before, and the same name is no change.
    await p.me.founder.profile.update({ confirmAdult: true, displayName: "Omar Diaz", riskAppetite: "low" });
  });

  it("is free while nothing public shows it, and the publish that follows screens it", async () => {
    const p = await person("Pia Lund");
    await p.me.founder.profile.update({ confirmAdult: true, displayName: "Pia pia@example.com" });
    expect((await repos.founders.get(hz.db, p.userId))?.displayName).toBe("Pia pia@example.com");
    expect(await p.me.founder.publicProfile.publish({ content: content() })).toMatchObject({ outcome: "held", reason: "personal_data" });
    expect(await hz.caller(null).publicPerson.byHandle({ handle: "pia-lund" })).toBeNull();
  });

  it("publish screens the name as it is locked for the publish, not as it was read before", async () => {
    const p = await person("Quinn Ash");
    await p.me.founder.publicProfile.update({ content: content() });
    // A name change lands between the publish's first read and its write (another tab, "Your profile").
    const db = new Proxy(hz.db, {
      get(target, key) {
        if (key === "transaction") {
          return async (fn: (tx: unknown) => Promise<unknown>) => {
            await target.execute(sql`update founder_profiles set display_name = 'Quinn quinn@example.com' where user_id = ${p.userId}`);
            return target.transaction(fn as never);
          };
        }
        const v = Reflect.get(target, key) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const result = await publishPublicProfile({ db, env: hz.deps.env, limits: hz.limits, userId: p.userId }, { content: content() });
    expect(result).toMatchObject({ outcome: "held", reason: "personal_data", profile: { public: false } });
    expect(await hz.caller(null).publicPerson.byHandle({ handle: "quinn-ash" })).toBeNull();
  });

  it("a name with a bidi control is refused", async () => {
    const p = await person("Rena Holt");
    await expect(p.me.founder.profile.update({ confirmAdult: true, displayName: "Rena\u202eHolt" })).rejects.toThrow(/direction of the text/);
  });
});

describe("the address", () => {
  it("never poses as the product or its staff", async () => {
    const p = await person("Sol Brandt");
    for (const handle of ["foundmill-support", "foundmill-team", "team-foundmill", "my-foundmill-page", "support-desk", "admin-team", "f0undmill", "official-help"]) {
      expect(handlePosesAsPlatform(handle), handle).toBe(true);
      await expect(p.me.founder.publicProfile.update({ handle, content: content() }), handle).rejects.toThrow(PERSON_HANDLE_RESERVED);
    }
    for (const handle of ["sol-brandt", "mill-house", "teamwork-studio", "found-it-bakery"]) expect(handlePosesAsPlatform(handle), handle).toBe(false);
    expect((await p.me.founder.publicProfile.update({ handle: "sol-brandt", content: content() })).profile.handle).toBe("sol-brandt");
  });

  it("one a person left stays theirs for 90 days", async () => {
    const a = await person("Tao Reyes");
    const b = await person("Tao Rivers");
    await a.me.founder.publicProfile.update({ handle: "tao-r", content: content() });
    await a.me.founder.publicProfile.update({ handle: "tao-reyes", content: content() });
    await expect(b.me.founder.publicProfile.update({ handle: "tao-r", content: content() })).rejects.toThrow(PERSON_HANDLE_TAKEN);
    // The suggestion for B steps around it too.
    expect((await b.me.founder.publicProfile.get()).handle).not.toBe("tao-r");
    // A can take it back at any time.
    expect((await a.me.founder.publicProfile.update({ handle: "tao-r", content: content() })).profile.handle).toBe("tao-r");
    await a.me.founder.publicProfile.update({ handle: "tao-reyes", content: content() });
    // After 90 days it is free.
    await hz.db.execute(sql`update person_handle_releases set released_at = now() - interval '91 days' where handle = 'tao-r'`);
    expect((await b.me.founder.publicProfile.update({ handle: "tao-r", content: content() })).profile.handle).toBe("tao-r");
  });
});

describe("limits", () => {
  it("the person's own get, update and publish are limited per account", async () => {
    const p = await person("Uma Price");
    const other = await person("Uma Pierce");
    for (const what of ["get", "update", "publish"] as const) await fill(`public-profile:${what}:${p.userId}`, PUBLIC_PROFILE_OWN_LIMITS[what]);
    expect(await code(p.me.founder.publicProfile.get())).toBe("TOO_MANY_REQUESTS");
    expect(await code(p.me.founder.publicProfile.update({ handle: "probe-one", content: content() }))).toBe("TOO_MANY_REQUESTS");
    expect(await code(p.me.founder.publicProfile.publish({ handle: "probe-two", content: content() }))).toBe("TOO_MANY_REQUESTS");
    // Taking a profile down is never held back, and another account is not affected.
    expect((await p.me.founder.publicProfile.unpublish()).public).toBe(false);
    expect((await other.me.founder.publicProfile.get()).public).toBe(false);
    expect(PUBLIC_PROFILE_OWN_LIMITS.update.limit).toBeLessThanOrEqual(30);
  });

  it("random unknown handles do not use up the per-handle or the global bucket of a real handle", async () => {
    const p = await person("Vic Lane");
    await p.me.founder.publicProfile.publish({ content: content() });
    const anon = hz.caller(null);
    for (let i = 0; i < 25; i++) expect(await anon.publicPerson.byHandle({ handle: `no-such-person-${i}` })).toBeNull();
    // A private profile reads as unknown, and is counted the same way.
    const q = await person("Vic Quiet");
    await q.me.founder.publicProfile.update({ content: content() });
    expect(await anon.publicPerson.byHandle({ handle: "vic-quiet" })).toBeNull();
    expect(await hits(publicPersonLimitKeys.all)).toBe(0);
    expect(await hits(publicPersonLimitKeys.handle("no-such-person-0"))).toBe(0);
    expect(await hits(publicPersonLimitKeys.unknown)).toBe(26);
    expect((await anon.publicPerson.byHandle({ handle: "vic-lane" }))?.displayName).toBe("Vic Lane");
    expect(await hits(publicPersonLimitKeys.all)).toBe(1);
    expect(await hits(publicPersonLimitKeys.handle("vic-lane"))).toBe(1);

    // With the unknown ceiling full, random lookups are refused and the real page still reads.
    await fill(publicPersonLimitKeys.unknown, PUBLIC_PERSON_LIMITS.unknown);
    expect(await code(anon.publicPerson.byHandle({ handle: "no-such-person-x" }))).toBe("TOO_MANY_REQUESTS");
    expect((await anon.publicPerson.byHandle({ handle: "vic-lane" }))?.displayName).toBe("Vic Lane");
    expect(await hits(publicPersonLimitKeys.all)).toBe(2);
  });

  it("limits each caller by the address the api sees, generously", async () => {
    const p = await person("Wen Ford");
    await p.me.founder.publicProfile.publish({ content: content() });
    await fill(publicPersonLimitKeys.caller(hz.deps.env, "203.0.113.20"), PUBLIC_PERSON_LIMITS.perCaller);
    const refused = await publicPersonByHandle({ ...hz.deps, clientAddress: "203.0.113.20" }, "wen-ford").then(() => "ok", (e: { code?: string }) => e.code);
    expect(refused).toBe("rate_limited");
    // Refused before anything else was spent.
    expect(await hits(publicPersonLimitKeys.all)).toBe(0);
    expect((await publicPersonByHandle({ ...hz.deps, clientAddress: "203.0.113.21" }, "wen-ford"))?.displayName).toBe("Wen Ford");
    expect(publicPersonLimitKeys.caller(hz.deps.env, "203.0.113.20")).not.toContain("203.0.113.20");
    expect(PUBLIC_PERSON_LIMITS.perCaller.limit).toBeGreaterThanOrEqual(300);
  });
});
