/**
 * "I posted it" (WP-08 T4, D1; services/shares.ts `recordPostPublished`, services/post-attribution.ts): `share.opened`
 * alone writes no `post.published`; the founder's yes writes one; a wrong host is refused; a collaborator cannot say it;
 * a first visit through the post's own link writes the second event with `visited: true`, once.
 */
import { postLinks, repos } from "@foundmill/db";
import type { ProjectPageContent } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "postpub" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const content = (): ProjectPageContent => ({ pitch: "Bike repairs at your door", about: "A van full of parts comes to the bike.", forWhom: "", stage: "idea" } as ProjectPageContent);

let n = 0;
async function project(name: string) {
  n += 1;
  const [ownerId, collabId] = await Promise.all(["owner", "collab"].map((r) => hz.h.createUser(`postpub-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(hz.db, b.id, { userId: collabId!, role: "viewer" });
  const owner = hz.caller({ userId: ownerId! });
  const published = await owner.page.publish({ businessId: b.id, content: content() });
  const pageId = (await repos.pages.get(hz.db, b.id))!.id;
  const out = await repos.teamPosts.write(hz.db, b.id, { ref: { trigger: "page_published", subject: "page_live", refId: pageId }, text: `${name} has a page now. Bike repairs at your door.`, agentId: null, now: new Date() } as never);
  const links = await hz.db.select().from(postLinks).where(eq(postLinks.assetId, out.asset!.id));
  return { id: b.id, slug: published.page.slug, owner, collab: hz.caller({ userId: collabId! }), assetId: out.asset!.id, code: (network: string | null) => links.find((l) => (l.network ?? null) === network)!.code };
}

const published = async (businessId: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type === "post.published").map((o) => o.event.payload as Record<string, unknown>);

describe("share.posted", () => {
  it("writes nothing for a share that was only opened, and one post.published for the founder's yes, once", async () => {
    const b = await project("Opened");
    await b.owner.share.opened({ businessId: b.id, kind: "draft", refId: b.assetId, network: "x", target: "tap" });
    expect(await published(b.id)).toEqual([]);
    await b.owner.share.posted({ businessId: b.id, assetId: b.assetId, network: "x", url: "https://x.com/me/status/1" });
    await b.owner.share.posted({ businessId: b.id, assetId: b.assetId, network: "x", url: "https://x.com/me/status/1" });
    expect(await published(b.id)).toEqual([{ assetId: b.assetId, network: "x", url: "https://x.com/me/status/1", source: "founder", visited: false }]);
    expect((await repos.teamPosts.published(hz.db, b.id, [b.assetId])).get(b.assetId)).toMatchObject({ network: "x", visited: false });
  });

  it("refuses a link on another host, and a collaborator who may not write", async () => {
    const b = await project("Refused");
    await expect(b.owner.share.posted({ businessId: b.id, assetId: b.assetId, network: "x", url: "https://evil.example/x.com" })).rejects.toThrow(/must be on X/);
    await expect(b.collab.share.posted({ businessId: b.id, assetId: b.assetId, network: "x" })).rejects.toThrow();
    expect(await published(b.id)).toEqual([]);
  });

  it("a first visit through the post's own link writes the second event once, visited", async () => {
    const b = await project("Visited");
    await b.owner.share.posted({ businessId: b.id, assetId: b.assetId, network: "x" });
    await hz.caller(null).publicPage.visited({ via: `s.${b.code("x")}` });
    await hz.caller(null).publicPage.visited({ via: `s.${b.code("x")}` });
    expect((await published(b.id)).map((p) => p.visited)).toEqual([false, true]);
  });
});
