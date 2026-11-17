/**
 * One identity for a person on the network, and Find people (docs/NETWORK.md F16; a9 A9-P1-3): a person who published
 * /u/<handle> is found by Network search and opens on the network's person page with what their page says; Find people
 * filters by words, "good at" and the answers to "What are you here for?"; the order ignores those answers (the solo
 * guard); everything stays closed while the people layer is.
 */
import { repos } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_CLOSED_MESSAGE } from "../trpc";
import { createApiHarness, type ApiHarness } from "./harness";

const content = (over: Record<string, unknown> = {}) => ({
  headline: "",
  about: "",
  strengths: [] as string[],
  wantsToLearn: [] as string[],
  lookingFor: "on_my_own" as const,
  place: "",
  ...over,
});

describe("find people (layer open)", () => {
  let hz: ApiHarness;
  let ana: string;
  let ben: string;
  let cai: string;

  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "findpeople", env: { LIVE_MODE: "1" } });
    ana = hz.A.ownerId;
    ben = hz.B.ownerId;
    cai = await hz.h.createUser("cai@findpeople.test");
    for (const [id, name] of [
      [ana, "Ana Finder"],
      [ben, "Ben Baker"],
      [cai, "Cai Coder"],
    ] as const) {
      await repos.founders.upsert(hz.db, id, { displayName: name });
      await repos.adults.confirm(hz.db, id);
    }
    await repos.personProfiles.save(hz.db, ben, {
      handle: "ben-baker",
      content: content({
        headline: "Sourdough by bike",
        strengths: ["Baking", "Sales"],
        lookingFor: "on_my_own",
        place: "Leeds",
      }),
    });
    await repos.personProfiles.publish(hz.db, ben, { at: new Date("2026-11-10T10:00:00Z") });
    await repos.personProfiles.save(hz.db, cai, {
      handle: "cai-coder",
      content: content({
        headline: "Builds apps",
        strengths: ["Code"],
        lookingFor: "looking_to_join",
      }),
    });
    await repos.personProfiles.publish(hz.db, cai, { at: new Date("2026-11-09T10:00:00Z") });
  }, 120_000);
  afterAll(() => hz.close());

  it("Network search finds a person who published /u/<handle>, as their page", async () => {
    const { hits } = await hz.caller({ userId: ana }).live.people.search({ q: "Ben Baker" });
    const ben_ = hits.filter((h) => h.userId === ben);
    expect(ben_).toHaveLength(1);
    expect(ben_[0]).toMatchObject({
      kind: "founder",
      name: "Ben Baker",
      handle: "ben-baker",
      headline: "Sourdough by bike",
    });
  });

  it("the network's person page shows what the person's page says", async () => {
    const page = await hz.caller({ userId: ana }).live.people.profile({ kind: "founder", id: ben });
    expect(page.profile).toMatchObject({ kind: "founder", userId: ben, handle: "ben-baker" });
    expect(page.person).toMatchObject({
      handle: "ben-baker",
      headline: "Sourdough by bike",
      strengths: ["Baking", "Sales"],
      lookingFor: "on_my_own",
      place: "Leeds",
    });
    expect(page.isSelf).toBe(false);
    expect(
      (await hz.caller({ userId: ben }).live.people.profile({ kind: "founder", id: ben })).isSelf,
    ).toBe(true);
  });

  it("Find people: newest first whatever people answered; words, good at and the answers filter", async () => {
    const me = hz.caller({ userId: ana });
    expect((await me.live.people.find()).items.map((p) => p.handle)).toEqual([
      "ben-baker",
      "cai-coder",
    ]);
    expect((await me.live.people.find({ goodAt: "code" })).items.map((p) => p.handle)).toEqual([
      "cai-coder",
    ]);
    expect((await me.live.people.find({ q: "leeds" })).items.map((p) => p.handle)).toEqual([
      "ben-baker",
    ]);
    expect(
      (
        await me.live.people.find({ lookingFor: ["looking_to_join", "looking_for_cofounder"] })
      ).items.map((p) => p.handle),
    ).toEqual(["cai-coder"]);
    const first = (await me.live.people.find({ limit: 1 })).items[0]!;
    expect(first).toEqual({
      userId: ben,
      name: "Ben Baker",
      handle: "ben-baker",
      headline: "Sourdough by bike",
      about: "",
      strengths: ["Baking", "Sales"],
      wantsToLearn: [],
      lookingFor: "on_my_own",
      place: "Leeds",
      projects: [],
    });
    // Never oneself.
    expect(
      (await hz.caller({ userId: ben }).live.people.find()).items.map((p) => p.handle),
    ).toEqual(["cai-coder"]);
  });

  it("a block either way: not found by search or Find people, and the person page reads as no profile", async () => {
    const me = hz.caller({ userId: ana });
    await repos.social.blockPerson(hz.db, ben, ana);
    expect((await me.live.people.find()).items.map((p) => p.handle)).not.toContain("ben-baker");
    expect(
      (await me.live.people.search({ q: "Ben Baker" })).hits.filter((h) => h.userId === ben),
    ).toEqual([]);
    await expect(me.live.people.profile({ kind: "founder", id: ben })).rejects.toThrow(
      /not found/i,
    );
    const [row] = await repos.social.listConnections(hz.db, ben, { status: "blocked" });
    await repos.social.removeConnection(hz.db, ben, row!.id);
    expect((await me.live.people.profile({ kind: "founder", id: ben })).person?.handle).toBe(
      "ben-baker",
    );
  });

  it("searches are limited per person in the shared store; wildcards in a name search are literal", async () => {
    hz.limits.reset();
    const me = hz.caller({ userId: cai });
    expect((await me.live.people.search({ q: "%%" })).hits).toEqual([]);
    let last = "OK";
    for (let i = 0; i < 31; i++)
      last = await me.live.people.find().then(
        () => "OK",
        (e: TRPCError) => e.code,
      );
    expect(last).toBe("TOO_MANY_REQUESTS");
    hz.limits.reset();
  });

  it("a person taken down is not found and has no page", async () => {
    await repos.personProfiles.unpublish(hz.db, cai);
    const me = hz.caller({ userId: ana });
    expect((await me.live.people.find()).items.map((p) => p.handle)).toEqual(["ben-baker"]);
    await expect(me.live.people.profile({ kind: "founder", id: cai })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("find people (layer closed)", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "findclosed" });
  }, 120_000);
  afterAll(() => hz.close());

  it("answers 403 like every live.* procedure", async () => {
    const err = await hz
      .caller({ userId: hz.A.ownerId })
      .live.people.find()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).message).toBe(LIVE_CLOSED_MESSAGE);
  });
});
