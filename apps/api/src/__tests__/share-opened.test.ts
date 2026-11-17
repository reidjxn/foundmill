/**
 * `share.opened` (services/shares.ts; docs/NETWORK.md F3 "Tap-to-post"): a pressed share control is written through the
 * outbox as a share that was opened. Any member who can read the section the shared thing belongs to may record one;
 * the payload names the control and an id and never the words; the id is checked, never trusted; one person cannot
 * flood the outbox; a sample business and an example membership record nothing; and nothing calls it posted.
 */
import { repos } from "@foundmill/db";
import { EVENTS } from "@foundmill/events";
import type { ProjectPageContent } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SHARE_OPENED_LIMIT, SHARE_SECTIONS, shareControlProblem, shareOpenedLimitKey } from "../services/shares";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "share" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const page = (): ProjectPageContent => ({ pitch: "Candles that smell like a walk in the woods", about: "Small batches.\n\nPoured by hand in Leeds.", forWhom: "", stage: "building", showFounders: false, followForm: true });

let n = 0;
async function project(name: string, options: { demo?: boolean } = {}) {
  n += 1;
  const [ownerId, memberId, viewerId] = await Promise.all(["owner", "member", "viewer"].map((r) => hz.h.createUser(`share-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  for (const [userId, role] of [[ownerId, "owner"], [memberId, "member"], [viewerId, "viewer"]] as const) await repos.memberships.add(hz.db, b.id, { userId: userId!, role });
  const owner = hz.caller({ userId: ownerId! });
  const published = await owner.page.publish({ businessId: b.id, content: page() });
  const pageRow = (await repos.pages.get(hz.db, b.id))!;
  const milestone = (await repos.journeys.listMilestones(hz.db, b.id)).find((m) => (m.ref as { trophyKey?: string } | null)?.trophyKey === "page_live")!;
  if (options.demo) await hz.db.execute(sql`update businesses set is_demo = true where id = ${b.id}`);
  return { id: b.id, ownerId: ownerId!, memberId: memberId!, viewerId: viewerId!, owner, member: hz.caller({ userId: memberId! }), viewer: hz.caller({ userId: viewerId! }), slug: published.page.slug, pageId: pageRow.id, milestoneId: milestone.id };
}

const shares = async (businessId: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type === "share.opened").map((o) => ({ actor: o.event.actor, payload: o.event.payload }));
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "unknown");

describe("share.opened", () => {
  it("records a pressed control through the outbox: the network, the target, the kind and the id, as the person who pressed", async () => {
    const b = await project("Northwood");
    expect(await b.owner.share.opened({ businessId: b.id, kind: "milestone", refId: b.milestoneId, network: "x", target: "tap" })).toEqual({ recorded: true });
    expect(await b.owner.share.opened({ businessId: b.id, kind: "page", network: "linkedin", target: "link_only" })).toEqual({ recorded: true });
    expect(await b.owner.share.opened({ businessId: b.id, kind: "draft", network: null, target: "device" })).toEqual({ recorded: true });
    expect(await b.owner.share.opened({ businessId: b.id, kind: "page", network: "whatsapp", target: "message" })).toEqual({ recorded: true });
    expect(await b.owner.share.opened({ businessId: b.id, kind: "milestone", refId: b.milestoneId, network: "instagram", target: "copy" })).toEqual({ recorded: true });
    expect(await b.owner.share.opened({ businessId: b.id, kind: "page", network: null, target: "copy" })).toEqual({ recorded: true });
    expect(await shares(b.id)).toEqual([
      { actor: { kind: "user", id: b.ownerId }, payload: { network: "x", kind: "milestone", refId: b.milestoneId, target: "tap" } },
      // The page's id is read on the server: the client never sends it.
      { actor: { kind: "user", id: b.ownerId }, payload: { network: "linkedin", kind: "page", refId: b.pageId, target: "link_only" } },
      { actor: { kind: "user", id: b.ownerId }, payload: { network: null, kind: "draft", refId: null, target: "device" } },
      { actor: { kind: "user", id: b.ownerId }, payload: { network: "whatsapp", kind: "page", refId: b.pageId, target: "message" } },
      { actor: { kind: "user", id: b.ownerId }, payload: { network: "instagram", kind: "milestone", refId: b.milestoneId, target: "copy" } },
      { actor: { kind: "user", id: b.ownerId }, payload: { network: null, kind: "page", refId: b.pageId, target: "copy" } },
    ]);
  });

  it("never carries the words: nothing typed fits in the input or the payload", async () => {
    const b = await project("Wordless");
    const loud = { businessId: b.id, kind: "page", network: "x", target: "tap", text: "Northwood is open", link: "https://evil.example", title: "x" } as never;
    expect(await b.owner.share.opened(loud)).toEqual({ recorded: true });
    const [event] = await shares(b.id);
    expect(Object.keys(event!.payload as object).sort()).toEqual(["kind", "network", "refId", "target"]);
    expect(JSON.stringify(event)).not.toMatch(/Northwood is open|evil\.example/);
  });

  it("any member who can read the section may record one; a wall on the section refuses; another business's people cannot", async () => {
    const b = await project("Readers");
    const other = await project("Elsewhere");
    expect(SHARE_SECTIONS).toEqual({ milestone: "distribution", page: "product", draft: "distribution" });
    // A viewer reads every section by default: reading is enough to share what is already public.
    expect(await b.viewer.share.opened({ businessId: b.id, kind: "page", network: "bluesky", target: "tap" })).toEqual({ recorded: true });
    expect(await b.member.share.opened({ businessId: b.id, kind: "milestone", refId: b.milestoneId, network: "threads", target: "tap" })).toEqual({ recorded: true });
    // Walled off Product: no page share; still a milestone share (Distribution), and the other way round.
    await hz.db.execute(sql`update memberships set section_permissions = '{"product":"none"}'::jsonb where business_id = ${b.id} and user_id = ${b.memberId}`);
    expect(await code(b.member.share.opened({ businessId: b.id, kind: "page", network: "x", target: "tap" }))).toBe("FORBIDDEN");
    expect(await b.member.share.opened({ businessId: b.id, kind: "draft", network: "x", target: "tap" })).toEqual({ recorded: true });
    await hz.db.execute(sql`update memberships set section_permissions = '{"distribution":"none"}'::jsonb where business_id = ${b.id} and user_id = ${b.memberId}`);
    expect(await code(b.member.share.opened({ businessId: b.id, kind: "milestone", refId: b.milestoneId, network: "x", target: "tap" }))).toBe("FORBIDDEN");
    expect(await code(b.member.share.opened({ businessId: b.id, kind: "draft", network: "x", target: "tap" }))).toBe("FORBIDDEN");
    expect(await b.member.share.opened({ businessId: b.id, kind: "page", network: "x", target: "tap" })).toEqual({ recorded: true });
    // Not a member: refused before anything is read, and signed out the same.
    expect(await code(other.owner.share.opened({ businessId: b.id, kind: "page", network: "x", target: "tap" }))).toBe("FORBIDDEN");
    expect(await code(hz.caller(null).share.opened({ businessId: b.id, kind: "page", network: "x", target: "tap" }))).toBe("UNAUTHORIZED");
    expect((await shares(b.id)).map((s) => (s.actor as { id: string }).id)).toEqual([b.viewerId, b.memberId, b.memberId, b.memberId]);
    expect(await shares(other.id)).toEqual([]);
  });

  it("checks the id instead of trusting it: another business's milestone, a missing one and a made-up page id record nothing of theirs", async () => {
    const b = await project("Mine");
    const other = await project("Theirs");
    expect(await b.owner.share.opened({ businessId: b.id, kind: "milestone", refId: other.milestoneId, network: "x", target: "tap" })).toEqual({ recorded: false });
    expect(await b.owner.share.opened({ businessId: b.id, kind: "milestone", network: "x", target: "tap" })).toEqual({ recorded: false });
    expect(await b.owner.share.opened({ businessId: b.id, kind: "milestone", refId: "00000000-0000-4000-8000-00000000dead", network: "x", target: "tap" })).toEqual({ recorded: false });
    // A page share ignores whatever id came with it; a draft never carries one.
    expect(await b.owner.share.opened({ businessId: b.id, kind: "page", refId: other.pageId, network: "x", target: "tap" })).toEqual({ recorded: true });
    expect(await b.owner.share.opened({ businessId: b.id, kind: "draft", refId: other.milestoneId, network: "x", target: "tap" })).toEqual({ recorded: true });
    expect((await shares(b.id)).map((s) => (s.payload as { refId: string | null }).refId)).toEqual([b.pageId, null]);
    expect(await shares(other.id)).toEqual([]);
    expect(await code(b.owner.share.opened({ businessId: b.id, kind: "milestone", refId: "not-an-id", network: "x", target: "tap" }))).toBe("BAD_REQUEST");
  });

  it("refuses a control that cannot exist: a share window with no network, a message on a network, a device sheet with one", async () => {
    const b = await project("Shapes");
    expect(shareControlProblem({ network: "x", target: "tap" })).toBeNull();
    expect(shareControlProblem({ network: "reddit", target: "link_only" })).toBeNull();
    expect(shareControlProblem({ network: "tiktok", target: "copy" })).toBeNull();
    expect(shareControlProblem({ network: null, target: "copy" })).toBeNull();
    expect(shareControlProblem({ network: "telegram", target: "message" })).toBeNull();
    expect(shareControlProblem({ network: null, target: "device" })).toBeNull();
    for (const bad of [
      { network: null, target: "tap" },
      { network: "whatsapp", target: "tap" },
      { network: null, target: "link_only" },
      { network: "x", target: "message" },
      { network: null, target: "message" },
      { network: "x", target: "device" },
      { network: "telegram", target: "copy" },
    ] as const) {
      expect(shareControlProblem(bad), JSON.stringify(bad)).not.toBeNull();
      expect(await code(b.owner.share.opened({ businessId: b.id, kind: "page", ...bad })), JSON.stringify(bad)).toBe("BAD_REQUEST");
    }
    expect(await code(b.owner.share.opened({ businessId: b.id, kind: "page", network: "myspace", target: "tap" } as never))).toBe("BAD_REQUEST");
    expect(await code(b.owner.share.opened({ businessId: b.id, kind: "page", network: "x", target: "posted" } as never))).toBe("BAD_REQUEST");
    expect(await code(b.owner.share.opened({ businessId: b.id, kind: "campaign", network: "x", target: "tap" } as never))).toBe("BAD_REQUEST");
    expect(await shares(b.id)).toEqual([]);
  });

  it("is limited per person, across businesses, so a held-down key cannot flood the outbox; over the limit it answers quietly", async () => {
    const b = await project("Flood");
    const answers: boolean[] = [];
    for (let i = 0; i < SHARE_OPENED_LIMIT.limit + 15; i++) answers.push((await b.owner.share.opened({ businessId: b.id, kind: "draft", network: "x", target: "tap" })).recorded);
    expect(answers.filter(Boolean)).toHaveLength(SHARE_OPENED_LIMIT.limit);
    expect(answers.slice(SHARE_OPENED_LIMIT.limit).every((r) => r === false)).toBe(true);
    expect(await shares(b.id)).toHaveLength(SHARE_OPENED_LIMIT.limit);
    // Another person in the same business has their own budget.
    expect(await b.member.share.opened({ businessId: b.id, kind: "draft", network: "x", target: "tap" })).toEqual({ recorded: true });
    expect(shareOpenedLimitKey(b.ownerId)).not.toBe(shareOpenedLimitKey(b.memberId));
    // A new window, a new budget.
    hz.limits.reset();
    expect(await b.owner.share.opened({ businessId: b.id, kind: "draft", network: "x", target: "tap" })).toEqual({ recorded: true });
  });

  it("a sample business records nothing: it shows nothing in public", async () => {
    const b = await project("Sample", { demo: true });
    expect(await b.owner.share.opened({ businessId: b.id, kind: "page", network: "x", target: "tap" })).toEqual({ recorded: false });
    expect(await shares(b.id)).toEqual([]);
  });

  it("is a share that was opened, never a post: metrics only, never narrated, and not a real outcome", async () => {
    const decl = EVENTS["share.opened"];
    expect(decl.narratable).toBe(false);
    expect([...decl.consumers]).toEqual(["metrics"]);
    expect(decl.doc).toMatch(/not an outside result and the north star does not count it/);
    // Recording a share writes nothing else: no milestone, no campaign launch, no page event.
    const b = await project("Quiet");
    const before = (await repos.events.outboxPending(hz.db, b.id)).map((o) => o.event.type);
    await b.owner.share.opened({ businessId: b.id, kind: "page", network: "x", target: "tap" });
    const after = (await repos.events.outboxPending(hz.db, b.id)).map((o) => o.event.type);
    expect(after.slice(before.length)).toEqual(["share.opened"]);
    expect((await repos.journeys.listMilestones(hz.db, b.id)).length).toBe(1);
  });
});
