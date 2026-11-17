/**
 * WP-14 T2: Founder fit follows the profile's skill ratings on every idea the person holds, in place and without a
 * model call; and a person takes charge only once their profile says how much time they can give and where they live
 * (founder's answer A5, 2026-11-17).
 */
import { repos } from "@foundmill/db";
import { TAKE_CHARGE_NEEDS_MESSAGE, quickSkillRatings, skillsFit } from "@foundmill/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIT_EVIDENCE } from "../services/founder-fit";
import { founderBrief } from "../services/ideation";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "quick-fit" });
}, 120_000);
afterAll(() => hz.close());

const KEYS = ["market_pull", "market_size", "competition", "speed_to_first_customer", "capital_intensity", "agent_executability", "founder_fit", "defensibility", "regulatory_load", "distribution_clarity"];
const attributes = (fit: number) => Object.fromEntries(KEYS.map((k) => [k, { value: k === "founder_fit" ? fit : 10, evidence: `Unverified: ${k}.` }]));
const fitOf = async (userId: string, ideaId: string) => ((await repos.ideas.get(hz.db, userId, ideaId)).current!.attributes as Record<string, { value: number; evidence?: string }>).founder_fit!;

describe("Founder fit follows the profile (WP-14 T2)", () => {
  it("a card kept before the profile gets its fit from the quick answers, and sharpening moves it in place", async () => {
    const userId = await hz.h.createUser("quick-fit@test.local");
    const caller = hz.caller({ userId, email: "quick-fit@test.local" });
    // Kept from the idea box: rated with nothing known about the person. One more of another kind, and a committed-like discarded one.
    const saas = await repos.ideas.create(hz.db, userId, { title: "Ledgerline", pitch: "Books for freelancers.", archetype: "b2b_saas", attributes: attributes(11) });
    const media = await repos.ideas.create(hz.db, userId, { title: "Shutter Notes", pitch: "A film camera newsletter.", archetype: "content_media", attributes: attributes(9) });
    const gone = await repos.ideas.create(hz.db, userId, { title: "Gone", pitch: "Discarded.", archetype: "b2b_saas", attributes: attributes(11) });
    await repos.ideas.discard(hz.db, userId, gone.id);

    // The first profile: "Building software" and "Finding and winning customers" picked.
    const quick = quickSkillRatings(["Building software", "Finding and winning customers"]);
    await caller.founder.profile.update({ confirmAdult: true, displayName: "Quinn", skills: quick });
    // b2b_saas leans on engineering and sales: both 14, against neutral 10. content_media on domain and design: both 7.
    expect(await fitOf(userId, saas.id)).toEqual({ value: 15, evidence: FIT_EVIDENCE.quick });
    expect(await fitOf(userId, media.id)).toEqual({ value: 6, evidence: FIT_EVIDENCE.quick });
    // In place: no new version, and nothing else on the card changed.
    const after = await repos.ideas.get(hz.db, userId, saas.id);
    expect(after.current!.version).toBe(1);
    expect((after.current!.attributes as Record<string, { value: number; evidence?: string }>).market_pull).toEqual({ value: 10, evidence: "Unverified: market_pull." });
    expect(await repos.ideas.versions(hz.db, userId, saas.id)).toHaveLength(1);

    // The Ideation agent is told what the ratings rest on.
    expect(await founderBrief(hz.db, userId)).toMatchObject({ skills: quick, skills_basis: "quick_answers" });

    // A save that changes no rating changes no card.
    await caller.founder.profile.update({ displayName: "Quinn R" });
    expect((await fitOf(userId, saas.id)).value).toBe(15);

    // Sharpen: the long profile sets the ratings one by one (and the experience answer).
    const sharp = { engineering: 4, sales: 6, design: 18, finance: 10, domain: 16 };
    await caller.founder.profile.update({ experience: "first_time", timeCommitment: "part_time", skills: sharp });
    expect(await fitOf(userId, saas.id)).toEqual({ value: 15 + skillsFit(sharp, "b2b_saas") - skillsFit(quick, "b2b_saas"), evidence: FIT_EVIDENCE.full });
    expect((await fitOf(userId, saas.id)).value).toBe(6);
    expect((await fitOf(userId, media.id)).value).toBe(6 + 17 - 7);
    expect(await founderBrief(hz.db, userId)).toMatchObject({ skills_basis: "rated_by_founder" });

    // A discarded card is left alone.
    const restored = await repos.ideas.restore(hz.db, userId, gone.id);
    expect((restored.current!.attributes as Record<string, { value: number }>).founder_fit!.value).toBe(11);
  });

  it("another person's ideas are never touched", async () => {
    const a = await hz.h.createUser("fit-a@test.local");
    const b = await hz.h.createUser("fit-b@test.local");
    const theirs = await repos.ideas.create(hz.db, b, { title: "Theirs", pitch: "Not mine.", archetype: "b2b_saas", attributes: attributes(11) });
    await hz.caller({ userId: a }).founder.profile.update({ confirmAdult: true, displayName: "Ada", skills: quickSkillRatings(["Building software"]) });
    expect((await fitOf(b, theirs.id)).value).toBe(11);
  });
});

describe("time and where you live before take charge (A5)", () => {
  const commit = (ideaId: string, extra: Record<string, unknown> = {}) => ({ ideaId, name: "Ledgerline", archetype: "b2b_saas" as const, gameMode: "personal" as const, ...extra });

  it("refuses to start without both, names what is missing, and creates nothing", async () => {
    const userId = await hz.h.createUser("no-about@test.local");
    const caller = hz.caller({ userId, email: "no-about@test.local" });
    await caller.founder.profile.update({ confirmAdult: true, displayName: "Nia" });
    const idea = await repos.ideas.create(hz.db, userId, { title: "Ledgerline", pitch: "Books for freelancers.", archetype: "b2b_saas", attributes: attributes(11) });

    await expect(caller.idea.commit(commit(idea.id))).rejects.toMatchObject({ message: TAKE_CHARGE_NEEDS_MESSAGE });
    // One of the two is not enough either, and a blank answer is no answer.
    await expect(caller.idea.commit(commit(idea.id, { timeCommitment: "few_hours" }))).rejects.toMatchObject({ message: TAKE_CHARGE_NEEDS_MESSAGE });
    await expect(caller.idea.commit(commit(idea.id, { timeCommitment: "few_hours", residence: "   " }))).rejects.toThrow();
    expect((await repos.ideas.get(hz.db, userId, idea.id)).committedAt).toBeNull();
    expect((await caller.founder.profile.get()).businesses).toHaveLength(0);
    // A refused press saved nothing to the profile.
    expect(await repos.founders.get(hz.db, userId)).toMatchObject({ timeCommitment: null, residence: null });
  });

  it("starts with the answers given on that press, and saves them to the profile", async () => {
    const userId = await hz.h.createUser("with-about@test.local");
    const caller = hz.caller({ userId, email: "with-about@test.local" });
    await caller.founder.profile.update({ confirmAdult: true, displayName: "Wes", residence: "Canada" });
    const idea = await repos.ideas.create(hz.db, userId, { title: "Ledgerline", pitch: "Books for freelancers.", archetype: "b2b_saas", attributes: attributes(11) });
    // The profile's own answer stands; the press fills only what is missing.
    const result = await caller.idea.commit(commit(idea.id, { timeCommitment: "evenings_weekends", residence: "Mexico" }));
    expect(result.business.name).toBe("Ledgerline");
    expect(await repos.founders.get(hz.db, userId)).toMatchObject({ timeCommitment: "evenings_weekends", residence: "Canada" });
  });

  it("asks nothing of a profile that has both", async () => {
    const userId = await hz.h.createUser("has-about@test.local");
    const caller = hz.caller({ userId, email: "has-about@test.local" });
    await caller.founder.profile.update({ confirmAdult: true, displayName: "Hal", timeCommitment: "full_time", residence: "United States" });
    const idea = await repos.ideas.create(hz.db, userId, { title: "Ledgerline", pitch: "Books for freelancers.", archetype: "b2b_saas", attributes: attributes(11) });
    expect((await caller.idea.commit(commit(idea.id))).alreadyCommitted).toBe(false);
  });
});
