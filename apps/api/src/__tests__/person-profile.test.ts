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
import { PERSON_HANDLE_TAKEN, PERSON_HOLD_MESSAGES, type PersonProfileContent, type ProjectPageContent } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROFILE_MISSING_MESSAGE, profileHoldReason } from "../services/person-profile";
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
