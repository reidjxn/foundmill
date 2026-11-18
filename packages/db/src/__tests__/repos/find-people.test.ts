/**
 * Find people (docs/NETWORK.md F16 browse; repos.personProfiles.public.find): public profiles only, never the viewer,
 * never anyone blocked either way, words over name, headline, place and tags, "good at" over the strengths, the answers
 * to "What are you here for?", pages by cursor, and the order is the publish date alone: a person building on their own
 * is never placed lower than someone looking for people (the solo guard, NETWORK §10).
 */
import type { PersonLookingFor } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../client";
import { repos } from "../../repos";
import { createTestDb, type TestHarness } from "../../testing/pglite";

let h: TestHarness;
let db: Db;
const ids: Record<string, string> = {};

async function person(
  key: string,
  name: string,
  at: string,
  content: {
    headline?: string;
    strengths?: string[];
    lookingFor?: PersonLookingFor;
    place?: string;
  },
  publish = true,
) {
  const id = await h.createUser(`${key}@find-people.test`);
  ids[key] = id;
  await repos.founders.upsert(db, id, { displayName: name, confirmAdult: true } as never);
  await repos.adults.confirm(db, id);
  await repos.personProfiles.save(db, id, {
    handle: `${key}-find`,
    content: {
      headline: content.headline ?? "",
      about: "",
      strengths: content.strengths ?? [],
      wantsToLearn: [],
      lookingFor: content.lookingFor ?? "on_my_own",
      place: content.place ?? "",
    },
  });
  if (publish) await repos.personProfiles.publish(db, id, { at: new Date(at) });
}

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  await person("viewer", "Vic Viewer", "2026-11-01T10:00:00Z", {
    headline: "Bakes bread",
    strengths: ["Baking"],
  });
  await person("solo", "Sol Alone", "2026-11-05T10:00:00Z", {
    headline: "Coffee cart in Austin",
    strengths: ["Coffee", "Sales"],
    lookingFor: "on_my_own",
    place: "Austin, TX",
  });
  await person("open", "Opal Open", "2026-11-04T10:00:00Z", {
    headline: "Designs logos",
    strengths: ["Design"],
    lookingFor: "open_to_people",
  });
  await person("cof", "Cora Cofounder", "2026-11-03T10:00:00Z", {
    headline: "Wants a technical partner",
    strengths: ["Sales"],
    lookingFor: "looking_for_cofounder",
  });
  await person("join", "Jo Joiner", "2026-11-02T10:00:00Z", {
    headline: "Ready to help",
    strengths: ["Writing 100%_sure"],
    lookingFor: "looking_to_join",
  });
  await person("hidden", "Hid Private", "2026-11-06T10:00:00Z", { headline: "Not public" }, false);
}, 120_000);
afterAll(() => h?.close());

const handles = async (
  filter: Parameters<typeof repos.personProfiles.public.find>[2] = {},
  viewer = ids.viewer!,
) => (await repos.personProfiles.public.find(db, viewer, filter)).items.map((p) => p.handle);

describe("Find people", () => {
  it("lists public profiles newest first, never the viewer or a private profile; the order ignores what people are looking for", async () => {
    expect(await handles()).toEqual(["solo-find", "open-find", "cof-find", "join-find"]);
    // The person building on their own, published last, is first: the answer never moves anyone.
    const one = (await repos.personProfiles.public.find(db, ids.viewer!, { limit: 1 })).items[0]!;
    expect(one).toMatchObject({
      userId: ids.solo,
      displayName: "Sol Alone",
      content: { lookingFor: "on_my_own", place: "Austin, TX" },
    });
  });

  it("matches words over name, headline, place and tags, and good-at over strengths", async () => {
    expect(await handles({ q: "austin" })).toEqual(["solo-find"]);
    expect(await handles({ q: "cora" })).toEqual(["cof-find"]);
    expect(await handles({ q: "logos" })).toEqual(["open-find"]);
    expect(await handles({ goodAt: "sales" })).toEqual(["solo-find", "cof-find"]);
    expect(await handles({ goodAt: "sales", q: "partner" })).toEqual(["cof-find"]);
    // Wildcards in a word are matched literally.
    expect(await handles({ q: "%" })).toEqual(["join-find"]);
    expect(await handles({ q: "_" })).toEqual(["join-find"]);
  });

  it("filters by the answers to What are you here for", async () => {
    expect(await handles({ lookingFor: ["looking_for_cofounder", "looking_to_join"] })).toEqual([
      "cof-find",
      "join-find",
    ]);
    expect(await handles({ lookingFor: ["on_my_own"] })).toEqual(["solo-find"]);
  });

  it("pages by cursor", async () => {
    const first = await repos.personProfiles.public.find(db, ids.viewer!, { limit: 3 });
    expect(first.items.map((p) => p.handle)).toEqual(["solo-find", "open-find", "cof-find"]);
    const second = await repos.personProfiles.public.find(db, ids.viewer!, {
      limit: 3,
      cursor: first.nextCursor,
    });
    expect(second.items.map((p) => p.handle)).toEqual(["join-find"]);
    expect(second.nextCursor).toBeNull();
  });

  it("leaves out anyone blocked either way", async () => {
    await repos.social.blockPerson(db, ids.viewer!, ids.open!);
    await repos.social.blockPerson(db, ids.cof!, ids.viewer!);
    expect(await handles()).toEqual(["solo-find", "join-find"]);
  });

  it("reads one account's public profile, and nothing for a private one", async () => {
    expect((await repos.personProfiles.public.byUserId(db, ids.solo!))?.handle).toBe("solo-find");
    expect(await repos.personProfiles.public.byUserId(db, ids.hidden!)).toBeNull();
  });
});
