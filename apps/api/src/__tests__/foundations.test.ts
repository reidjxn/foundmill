/**
 * Foundations on the first open (BUILD §11.1 "Take charge" → first open, §11.5): commit leaves them pending, the first
 * `product.foundations.ensure` claims them exactly once, the drafting runs on Temporal or in the api, writes the vision,
 * every outline section and the roadmap, and a failure can be retried. Door A drafts from the idea and the founder
 * profile; Door B from the Import report and the imported sources linked at commit.
 */
import { getArchetypeSeed } from "@foundmill/agents";
import { businessFoundations, repos } from "@foundmill/db";
import { MockModelClient, ModelUnavailableError, type ModelClient, type StreamStructuredRequest } from "@foundmill/models";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { encodeJobId, importJobKey } from "../services/import";
import { FOUNDATIONS_LOCAL_CONCURRENCY, FOUNDATIONS_LOCAL_TIMEOUT_MS, FOUNDATIONS_STALE_MS, acquireFoundationsSlot, foundationsSlots, importJobIdOf, runFoundationsLocally, settleFoundationRuns } from "../services/foundations";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const docText = (doc: unknown) => JSON.stringify(doc).match(/"text":"([^"]*)"/g)?.join(" ") ?? "";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "found" });
}, 120_000);
afterAll(() => hz?.close());

async function founder(email: string) {
  const userId = await hz.h.createUser(email);
  const caller = hz.caller({ userId, email });
  await caller.founder.profile.update({ displayName: "Reid", experience: "first-time", skills: { engineering: 14, sales: 8 }, targetMarkets: ["Nordics"], constraints: ["bootstrapped"], riskAppetite: "medium", budgetMinor: 2_500_000 });
  return { userId, caller };
}

async function commitDoorA(email: string) {
  const f = await founder(email);
  const generated = await f.caller.idea.generate({ prompt: "bookkeeping for independent accountants in the Nordics" });
  const idea = generated.ideas[0]!;
  const result = await f.caller.idea.commit({ ideaId: idea.id, name: "Ledgerly Found", archetype: "b2b_saas", gameMode: "personal" });
  return { ...f, idea, result, businessId: result.business.id };
}

describe("product.foundations — Door A (Ideation Studio)", () => {
  let a: Awaited<ReturnType<typeof commitDoorA>>;
  beforeAll(async () => {
    a = await commitDoorA("door-a@test.local");
  });

  it("commit leaves the foundations pending, from the ideation door, and drafts nothing yet", async () => {
    expect(a.result.foundations).toEqual({ status: "pending", door: "ideation", importSourceIds: [] });
    const view = await a.caller.product.foundations.get({ businessId: a.businessId });
    expect(view).toMatchObject({ status: "pending", door: "ideation", attempt: 0, vision: null, importLinked: false });
    const blocks = await repos.product.listBlocks(hz.db, a.businessId);
    expect(blocks.every((b) => JSON.stringify(b.content) === '{"type":"doc","content":[]}')).toBe(true);
    expect(await repos.product.listRoadmap(hz.db, a.businessId)).toEqual([]);
  });

  it("the first open claims the drafting exactly once, even from two tabs at the same time", async () => {
    const [one, two] = await Promise.all([a.caller.product.foundations.ensure({ businessId: a.businessId }), a.caller.product.foundations.ensure({ businessId: a.businessId })]);
    expect([one.started, two.started].filter(Boolean)).toHaveLength(1);
    const started = one.started ? one : two;
    // Without Temporal the drafting runs in the api, in the background: the call returns while it is drafting.
    expect(started).toMatchObject({ status: "drafting", attempt: 1 });
    // ensure says where it stands and nothing more (L3): the rest is read through `get`.
    expect(Object.keys(started).sort()).toEqual(["attempt", "door", "finishedAt", "started", "startedAt", "status"]);
    expect(await a.caller.product.foundations.get({ businessId: a.businessId })).toMatchObject({ runner: "local" });
    const reload = await a.caller.product.foundations.ensure({ businessId: a.businessId });
    expect(reload.started).toBe(false);
    await settleFoundationRuns();
    const again = await a.caller.product.foundations.ensure({ businessId: a.businessId });
    expect(again).toMatchObject({ status: "ready", started: false, attempt: 1 });
    const audit = await repos.audit.list(hz.db, a.businessId, { limit: 50 });
    expect(audit.items.filter((e) => e.action === "foundations.start")).toHaveLength(1);
  });

  it("ready: the vision is stored, every outline section is written as Tiptap JSON by the Product lead, the roadmap links blocks", async () => {
    const view = await a.caller.product.foundations.get({ businessId: a.businessId });
    expect(view.status).toBe("ready");
    expect(view.vision).toMatchObject({ statement: expect.stringContaining("Ledgerly Found"), northStar: { label: expect.stringMatching(/Forecast|Estimate/) } });
    expect(view.vision!.principles.length).toBeGreaterThanOrEqual(3);
    expect(view.vision!.northStar.target).toMatch(/\((Forecast|Estimate)\)/);

    const seed = getArchetypeSeed("b2b_saas");
    const blocks = await repos.product.listBlocks(hz.db, a.businessId);
    expect(blocks.map((b) => b.section).sort()).toEqual([...seed.specOutline].sort());
    const productLead = (await repos.departments.list(hz.db, a.businessId)).find((d) => d.moduleKeys.includes("product"))!.leadAgentId;
    for (const b of blocks) {
      expect(b.authoredByKind, b.section).toBe("agent");
      expect(b.authoredBy, b.section).toBe(productLead);
      expect((b.content as { type: string }).type).toBe("doc");
      expect(docText(b.content).length, b.section).toBeGreaterThan(20);
    }
    expect(docText(blocks.find((b) => b.section === "Pricing")!.content)).toMatch(/\(Estimate\)/);

    const roadmap = await repos.product.listRoadmap(hz.db, a.businessId);
    expect(new Set(roadmap.map((i) => i.horizon))).toEqual(new Set(["now", "next", "later"]));
    const ids = new Set(blocks.map((b) => b.id));
    expect(roadmap.some((i) => i.specBlockIds.length > 0)).toBe(true);
    expect(roadmap.every((i) => i.specBlockIds.every((id) => ids.has(id)))).toBe(true);
    expect(roadmap.some((i) => i.descriptionMd.includes("**Acceptance criteria**"))).toBe(true);
    expect(view.summary).toMatchObject({ sectionsWritten: seed.specOutline.length, model: { route: "foundations", mode: "mock", costLabel: "Estimate" } });
    // The in-process run books its model call to the business's usage ledger (L2).
    const usage = await repos.usage.list(hz.db, a.businessId, { kind: "tokens" });
    expect(usage.items.filter((u) => (u.details as { kind?: string }).kind === "foundations")).toHaveLength(1);
  });

  it("posts one Inbox update from the Product lead with the vision, and writes inbox.item_created", async () => {
    const inbox = await a.caller.inbox.list({ businessId: a.businessId, limit: 50 });
    const notes = inbox.items.filter((i) => i.subject === "Vision, specification and roadmap drafted");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "update", blocksContinue: false });
    const words = notes[0]!.bodyMd.split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(60);
    expect(words).toBeLessThanOrEqual(180);
    const events = await repos.events.list(hz.db, a.businessId, { type: "inbox.item_created" });
    expect(events.items.some((e) => (e.payload as { inboxItemId?: string }).inboxItemId === notes[0]!.id)).toBe(true);
    // The Board's decision is still there and still blocks Continue.
    expect(inbox.items.some((i) => i.id === a.result.boardItem.id && i.blocksContinue)).toBe(true);
  });

  it("a business without foundations (committed before them, or seeded) reports none and starts nothing", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await owner.product.foundations.ensure({ businessId: hz.A.businessId })).toMatchObject({ status: "none", started: false });
    expect(await owner.product.foundations.get({ businessId: hz.A.businessId })).toMatchObject({ status: "none" });
    await expect(owner.product.foundations.retry({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("members of another business cannot read or start it", async () => {
    const outsider = hz.caller({ userId: hz.B.ownerId });
    await expect(outsider.product.foundations.get({ businessId: a.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.product.foundations.ensure({ businessId: a.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("product.foundations — a pinned block is never overwritten", () => {
  it("the founder's edit before the drafting survives it", async () => {
    const a = await commitDoorA("pinned@test.local");
    const pricing = (await repos.product.listBlocks(hz.db, a.businessId)).find((b) => b.section === "Pricing")!;
    const mine = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "€39 per practice per month, decided by the founder." }] }] };
    await a.caller.product.spec.editBlock({ businessId: a.businessId, blockId: pricing.id, patch: { content: mine } });
    await a.caller.product.foundations.ensure({ businessId: a.businessId });
    await settleFoundationRuns();
    const after = await repos.product.getBlock(hz.db, a.businessId, pricing.id);
    expect(after.content).toEqual(mine);
    expect(after).toMatchObject({ pinned: true, authoredByKind: "user" });
    const view = await a.caller.product.foundations.get({ businessId: a.businessId });
    expect(view.status).toBe("ready");
    expect(view.summary).toMatchObject({ sectionsKept: [{ section: "Pricing", reason: "pinned" }] });
  });
});

describe("product.foundations — failure and retry", () => {
  it("a failed drafting shows a readable reason; viewers cannot retry; a retry drafts it", async () => {
    const a = await commitDoorA("retry@test.local");
    const working = hz.deps.models;
    hz.deps.models = new MockModelClient({ failWith: { foundations: new ModelUnavailableError("upstream 529 overloaded, request req_123") } });
    try {
      const caller = hz.caller({ userId: a.userId });
      await caller.product.foundations.ensure({ businessId: a.businessId });
      await settleFoundationRuns();
      const failed = await caller.product.foundations.get({ businessId: a.businessId });
      expect(failed).toMatchObject({ status: "failed", attempt: 1, error: "The model service did not answer. Try again in a few minutes." });
      expect(failed.error).not.toContain("req_123");
      // Opening it again does not retry by itself.
      expect(await caller.product.foundations.ensure({ businessId: a.businessId })).toMatchObject({ status: "failed", started: false });
    } finally {
      hz.deps.models = working;
    }
    const viewerId = await hz.h.createUser("retry-viewer@test.local");
    await repos.memberships.add(hz.db, a.businessId, { userId: viewerId, role: "viewer" });
    await expect(hz.caller({ userId: viewerId }).product.foundations.retry({ businessId: a.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const owner = hz.caller({ userId: a.userId });
    const retried = await owner.product.foundations.retry({ businessId: a.businessId });
    expect(retried).toMatchObject({ status: "drafting", attempt: 2, started: true, error: null });
    await settleFoundationRuns();
    expect(await owner.product.foundations.get({ businessId: a.businessId })).toMatchObject({ status: "ready", attempt: 2 });
    await expect(owner.product.foundations.retry({ businessId: a.businessId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("an attempt that never finished is reported as interrupted so it can be retried", async () => {
    const a = await commitDoorA("stale@test.local");
    await hz.db.update(businessFoundations).set({ status: "drafting", attempt: 1, runner: "local", startedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(businessFoundations.businessId, a.businessId));
    const view = await a.caller.product.foundations.get({ businessId: a.businessId });
    expect(view).toMatchObject({ status: "drafting", stale: true });
    const ensured = await a.caller.product.foundations.ensure({ businessId: a.businessId });
    expect(ensured).toMatchObject({ status: "failed", started: false });
    expect(await a.caller.product.foundations.get({ businessId: a.businessId })).toMatchObject({ error: expect.stringMatching(/interrupted/) });
    const retried = await a.caller.product.foundations.retry({ businessId: a.businessId });
    expect(retried).toMatchObject({ started: true, attempt: 2 });
    await settleFoundationRuns();
    expect(await a.caller.product.foundations.get({ businessId: a.businessId })).toMatchObject({ status: "ready" });
  });
});

describe("product.foundations — on Temporal", () => {
  it("starts the businessFoundations workflow once with a deterministic id and does not draft in the api", async () => {
    const temporal = fakeTemporalClient();
    const tz = await createApiHarness({ prefix: "found-tmp", temporalClient: temporal });
    try {
      const userId = await tz.h.createUser("temporal@test.local");
      const caller = tz.caller({ userId });
      await caller.founder.profile.update({ displayName: "Reid", targetMarkets: ["EU"] });
      const idea = (await caller.idea.generate({ prompt: "a newsletter for climate operators" })).ideas[0]!;
      const { business } = await caller.idea.commit({ ideaId: idea.id, name: "Climate Weekly", archetype: "content_media", gameMode: "personal" });
      const [one, two] = await Promise.all([caller.product.foundations.ensure({ businessId: business.id }), caller.product.foundations.ensure({ businessId: business.id })]);
      const started = one.started ? one : two;
      expect(started).toMatchObject({ status: "drafting", attempt: 1 });
      const starts = temporal.starts.filter((s) => s.type === "businessFoundations");
      expect(starts).toEqual([{ type: "businessFoundations", workflowId: `foundations:${business.id}:1`, args: [{ businessId: business.id, attempt: 1 }] }]);
      await settleFoundationRuns();
      const row = await repos.foundations.get(tz.db, business.id);
      expect(row).toMatchObject({ status: "drafting", runner: "temporal", workflowId: `foundations:${business.id}:1` });
    } finally {
      await tz.close();
    }
  }, 120_000);
});

describe("product.foundations — Door B (Import)", () => {
  it("links the Import job at commit and drafts from the report and the imported sources; every open issue lands on the roadmap", async () => {
    const f = await founder("door-b@test.local");
    const sources = [
      { key: "github" as const, value: "acme/ledgerly" },
      { key: "stripe" as const, value: "" },
    ];
    const started = await f.caller.import.start({ sources, stepMs: 1 });
    await sleep(40);
    const status = await f.caller.import.status({ jobId: started.job.id });
    expect(status.report).not.toBeNull();
    const report = status.report!;

    // Import's "Continue to Commit": one card, with the job recorded on the idea.
    const generated = await f.caller.idea.generate({ prompt: report.summary, archetypeHint: report.archetypeHint, single: true, importJobId: started.job.id });
    const idea = generated.ideas[0]!;
    expect(importJobIdOf(idea.current?.research)).toBe(started.job.id);
    const result = await f.caller.idea.commit({ ideaId: idea.id, name: report.suggestedName, archetype: report.archetypeHint, gameMode: "personal" });
    const bid = result.business.id;
    expect(result.foundations).toMatchObject({ status: "pending", door: "import" });
    expect(result.foundations.importSourceIds).toHaveLength(2);

    const row = await repos.foundations.get(hz.db, bid);
    expect(row).toMatchObject({ door: "import", importJobId: started.job.id, ideaId: idea.id });
    expect(row!.importReport).toMatchObject({ title: report.title, roadmapSeeds: report.roadmapSeeds });
    const imported = (await repos.product.listSources(hz.db, bid)).items;
    expect(imported.map((s) => s.uri).sort()).toEqual(["https://dashboard.stripe.com/", "https://github.com/acme/ledgerly"]);
    expect(imported.every((s) => (s.relevance as { import?: { summary?: string } }).import?.summary)).toBe(true);

    // The Board's first item carries the import's suggested first decisions.
    expect(result.boardItem.subject).toBe("Where should the team start with what you imported?");
    const decision = result.boardItem.decision as { options: { id: string; recommended: boolean }[] } | null;
    expect(decision?.options.map((o) => o.id)).toEqual(report.firstDecisions.map((d) => d.id));
    expect(decision?.options.filter((o) => o.recommended)).toHaveLength(1);

    await f.caller.product.foundations.ensure({ businessId: bid });
    await settleFoundationRuns();
    const view = await f.caller.product.foundations.get({ businessId: bid });
    expect(view).toMatchObject({ status: "ready", door: "import", importLinked: true });
    expect(view.vision!.whyNow).toMatch(/imported sources/);
    const roadmap = await repos.product.listRoadmap(hz.db, bid);
    for (const seed of report.roadmapSeeds) {
      const item = roadmap.find((i) => i.title === seed.title);
      expect(item, seed.title).toBeDefined();
      expect(item!.descriptionMd).toContain(seed.source);
    }
    expect(view.summary).toMatchObject({ importedIssues: report.roadmapSeeds.length });
    const features = (await repos.product.listBlocks(hz.db, bid)).find((b) => b.section === "Features")!;
    expect(docText(features.content)).toContain(report.roadmapSeeds[0]!.title);
  });

  it("refuses an Import job that is unsigned, someone else's, unfinished or another business's own (L1)", async () => {
    const f = await founder("door-b-crafted@test.local");
    const key = importJobKey(hz.deps.env);
    const link = (importJobId: string) => f.caller.idea.generate({ prompt: "x", single: true, importJobId });
    const sources = [{ k: "github" as const, v: "acme/secret", id: null }];
    // Unsigned (the old format: base64url JSON only), and signed with another key.
    const unsigned = Buffer.from(JSON.stringify({ v: 1, m: "local", u: f.userId, b: null, w: null, t: 0, ms: 1, s: sources })).toString("base64url");
    await expect(link(unsigned)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(link(encodeJobId("another-secret-0123456789", { v: 1, m: "local", u: f.userId, b: null, w: null, t: 0, ms: 1, s: sources }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Signed here, but started by another account.
    await expect(link(encodeJobId(key, { v: 1, m: "local", u: hz.A.ownerId, b: null, w: null, t: 0, ms: 1, s: sources }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Signed for this founder, but still running.
    await expect(link(encodeJobId(key, { v: 1, m: "local", u: f.userId, b: null, w: null, t: Date.now(), ms: 60_000, s: sources }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Signed for this founder, but another business's own import.
    await expect(link(encodeJobId(key, { v: 1, m: "temporal", u: f.userId, b: hz.B.businessId, w: "import:x", t: 0, ms: 1, s: sources }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // A finished job of this founder links.
    const done = encodeJobId(key, { v: 1, m: "local", u: f.userId, b: null, w: null, t: 0, ms: 1, s: [{ k: "github", v: "acme/ledgerly", id: null }] });
    const generated = await link(done);
    expect(importJobIdOf(generated.ideas[0]!.current?.research)).toBe(done);
  });

  it("commit re-checks the job: a source value import would refuse is never stored", async () => {
    const f = await founder("door-b-recheck@test.local");
    const key = importJobKey(hz.deps.env);
    // Signed with the api's key (as if a bug or an older api had signed it) but carrying a value import refuses.
    const bad = encodeJobId(key, { v: 1, m: "local", u: f.userId, b: null, w: null, t: 0, ms: 1, s: [{ k: "website", v: "javascript:alert(1)", id: null }] });
    const generated = await f.caller.idea.generate({ prompt: "x", single: true, importJobId: bad });
    const result = await f.caller.idea.commit({ ideaId: generated.ideas[0]!.id, name: "Recheck Co", archetype: "b2b_saas", gameMode: "personal" });
    expect(result.foundations).toMatchObject({ door: "ideation", importSourceIds: [] });
    expect((await repos.product.listSources(hz.db, result.business.id)).items).toEqual([]);
  });
});

describe("product.foundations — only a member with product write starts it (L3)", () => {
  it("a viewer or a read-only member who opens the business first leaves it pending; the founder's open starts it", async () => {
    const a = await commitDoorA("viewer-first@test.local");
    const viewerId = await hz.h.createUser("viewer-first-viewer@test.local");
    await repos.memberships.add(hz.db, a.businessId, { userId: viewerId, role: "viewer" });
    const readerId = await hz.h.createUser("viewer-first-reader@test.local");
    await repos.memberships.add(hz.db, a.businessId, { userId: readerId, role: "member", sectionPermissions: { product: "read" } });
    for (const userId of [viewerId, readerId]) {
      expect(await hz.caller({ userId }).product.foundations.ensure({ businessId: a.businessId })).toEqual({ status: "pending", door: "ideation", attempt: 0, startedAt: null, finishedAt: null, started: false });
    }
    expect(await repos.foundations.get(hz.db, a.businessId)).toMatchObject({ status: "pending", attempt: 0 });
    expect(await a.caller.product.foundations.ensure({ businessId: a.businessId })).toMatchObject({ status: "drafting", started: true });
    await settleFoundationRuns();
    expect(await hz.caller({ userId: viewerId }).product.foundations.ensure({ businessId: a.businessId })).toMatchObject({ status: "ready", started: false });
  });
});

describe("product.foundations — the in-process fallback is bounded (L2)", () => {
  it("each run is aborted after its time limit and the attempt fails with a readable reason", async () => {
    const a = await commitDoorA("bounded@test.local");
    await repos.foundations.claim(hz.db, a.businessId);
    await repos.foundations.setRunner(hz.db, a.businessId, 1, { runner: "local", workflowId: null });
    const seen: (AbortSignal | undefined)[] = [];
    const hanging = {
      mode: "mock" as const,
      complete: (req: { signal?: AbortSignal }) => {
        seen.push(req.signal);
        return new Promise((_resolve, reject) => req.signal?.addEventListener("abort", () => reject(req.signal!.reason), { once: true }));
      },
    } as unknown as ModelClient;
    await runFoundationsLocally({ db: hz.db, models: hanging, temporal: hz.deps.temporal, log: hz.deps.log }, a.businessId, 1, { timeoutMs: 50 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.aborted).toBe(true);
    expect(await repos.foundations.get(hz.db, a.businessId)).toMatchObject({ status: "failed", error: "The drafting took too long and was stopped. Try again." });
    expect(FOUNDATIONS_LOCAL_TIMEOUT_MS).toBeLessThan(FOUNDATIONS_STALE_MS.local);
  });

  it("at most a few runs at once per process: the rest wait for a slot, or give up when their time runs out", async () => {
    const releases = await Promise.all(Array.from({ length: FOUNDATIONS_LOCAL_CONCURRENCY }, () => acquireFoundationsSlot(AbortSignal.timeout(5_000))));
    expect(foundationsSlots()).toEqual({ active: FOUNDATIONS_LOCAL_CONCURRENCY, waiting: 0 });
    let got = false;
    const waiting = acquireFoundationsSlot(AbortSignal.timeout(5_000)).then((release) => {
      got = true;
      return release;
    });
    const givesUp = acquireFoundationsSlot(AbortSignal.timeout(30));
    await sleep(5);
    expect(foundationsSlots().waiting).toBe(2);
    await expect(givesUp).rejects.toBeTruthy();
    expect(foundationsSlots().waiting).toBe(1);
    expect(got).toBe(false);
    releases[0]!();
    releases[0]!(); // a second release is a no-op
    const handed = await waiting;
    expect(got).toBe(true);
    expect(foundationsSlots()).toEqual({ active: FOUNDATIONS_LOCAL_CONCURRENCY, waiting: 0 });
    handed();
    releases.slice(1).forEach((r) => r());
    expect(foundationsSlots()).toEqual({ active: 0, waiting: 0 });
  });
});

/** The sections a staged section call asked for (its `write_sections` block); null for the plan, the roadmap and other routes. */
function writeSections(req: { messages: readonly { content: string }[] }): string[] | null {
  const m = /\{"write_sections":(\[[^\]]*\])\}/.exec(req.messages[req.messages.length - 1]?.content ?? "");
  return m ? (JSON.parse(m[1]!) as string[]) : null;
}

/** The mock client, with section calls that can wait on a gate or fail; records every streamed call. */
function stagedClient(opts: { gate?: Promise<void>; fail?: (sections: string[]) => Error | null } = {}) {
  const mock = new MockModelClient();
  const calls: { route: string; sections: string[] | null }[] = [];
  const client: ModelClient = {
    mode: "mock",
    complete: mock.complete.bind(mock) as ModelClient["complete"],
    async streamStructured<T, E>(req: StreamStructuredRequest<T, E>) {
      const sections = req.route === "foundations" ? writeSections(req) : null;
      if (req.route === "foundations" || req.route === "foundationsSkeleton") calls.push({ route: req.route, sections });
      if (sections && opts.gate) await opts.gate;
      const err = sections ? (opts.fail?.(sections) ?? null) : null;
      if (err) throw err;
      return mock.streamStructured(req);
    },
  };
  return { client, calls };
}

/** Runs with another models client; callers made inside `run` (`hz.caller`) use it (a caller keeps the client it was made with). */
async function withModels<T>(client: ModelClient, run: () => Promise<T>): Promise<T> {
  const working = hz.deps.models;
  hz.deps.models = client;
  try {
    return await run();
  } finally {
    hz.deps.models = working;
  }
}

describe("product.foundations — staged drafting (audit P3)", () => {
  it("the vision is readable while the sections are still being written; each part is stored with a foundations.progressed event; ready clears the progress", async () => {
    const a = await commitDoorA("staged@test.local");
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { client, calls } = stagedClient({ gate });
    await withModels(client, async () => {
      const caller = hz.caller({ userId: a.userId });
      await caller.product.foundations.ensure({ businessId: a.businessId });
      // The plan has landed; the section batches wait at the gate (opened whatever happens, so no run is left waiting).
      onTestFinished(() => open());
      await vi.waitFor(async () => expect((await caller.product.foundations.get({ businessId: a.businessId })).progress?.stage).toBe("specification"), { timeout: 10_000 });
      const drafting = await caller.product.foundations.get({ businessId: a.businessId });
      expect(drafting.status).toBe("drafting");
      expect(drafting.vision).toMatchObject({ statement: expect.stringContaining("Ledgerly Found"), northStar: { target: expect.stringMatching(/\((Forecast|Estimate)\)/) } });
      const seed = getArchetypeSeed("b2b_saas");
      expect(drafting.progress).toMatchObject({ stage: "specification", sectionsDone: 0, sectionsTotal: seed.specOutline.length });
      expect(drafting.progress!.sections.map((s) => s.section)).toEqual(expect.arrayContaining([...seed.specOutline]));
      expect(drafting.progress!.sections.every((s) => !s.done && s.content === null)).toBe(true);
      expect(drafting.progress!.sections.some((s) => s.thesis)).toBe(true);
      expect(drafting.progress!.author).toMatchObject({ agentId: expect.any(String), name: expect.any(String) });
      // Nothing is applied while drafting: the blocks are still empty.
      const blocks = await repos.product.listBlocks(hz.db, a.businessId);
      expect(blocks.every((b) => JSON.stringify(b.content) === '{"type":"doc","content":[]}')).toBe(true);
      open();
      await settleFoundationRuns();
    });
    const ready = await a.caller.product.foundations.get({ businessId: a.businessId });
    expect(ready).toMatchObject({ status: "ready", progress: null, summary: { model: { route: "foundations", staged: true } } });
    expect((await repos.foundations.get(hz.db, a.businessId))!.progress).toBeNull();
    // One plan; the sections in batches; one roadmap call.
    expect(calls.filter((c) => c.route === "foundationsSkeleton")).toHaveLength(1);
    const batches = calls.filter((c) => c.sections);
    expect(batches.every((c) => c.sections!.length <= 3)).toBe(true);
    expect(batches.flatMap((c) => c.sections!).sort()).toEqual([...(await repos.product.listBlocks(hz.db, a.businessId)).map((b) => b.section)].sort());
    expect(calls.filter((c) => c.route === "foundations" && !c.sections)).toHaveLength(1);

    const events = (await repos.events.list(hz.db, a.businessId, { type: "foundations.progressed", limit: 200 })).items;
    const steps = events.map((e) => (e.payload as { step: string }).step);
    for (const step of ["started", "vision", "plan", "section", "roadmap", "ready"]) expect(steps, step).toContain(step);
    expect(steps.filter((x) => x === "section")).toHaveLength(getArchetypeSeed("b2b_saas").specOutline.length);
    expect(events.every((e) => (e.payload as { attempt: number }).attempt === 1)).toBe(true);
  });

  it("a failed section batch is retried section by section, and the drafting still finishes", async () => {
    const a = await commitDoorA("staged-retry@test.local");
    let failures = 0;
    const { client, calls } = stagedClient({
      fail: (sections) => {
        if (sections.length > 1 && sections.includes("Pricing")) {
          failures++;
          return new ModelUnavailableError("upstream 529 overloaded");
        }
        return null;
      },
    });
    await withModels(client, async () => {
      const caller = hz.caller({ userId: a.userId });
      await caller.product.foundations.ensure({ businessId: a.businessId });
      await settleFoundationRuns();
    });
    expect(failures).toBe(1);
    const pricingBatch = calls.find((c) => c.sections && c.sections.length > 1 && c.sections.includes("Pricing"))!.sections!;
    for (const name of pricingBatch) expect(calls.filter((c) => c.sections?.length === 1 && c.sections[0] === name), name).toHaveLength(1);
    const view = await a.caller.product.foundations.get({ businessId: a.businessId });
    expect(view.status).toBe("ready");
    const blocks = await repos.product.listBlocks(hz.db, a.businessId);
    expect(blocks.every((b) => b.authoredByKind === "agent")).toBe(true);
    expect(docText(blocks.find((b) => b.section === "Pricing")!.content)).toMatch(/\(Estimate\)/);
  });

  it("a section that keeps failing fails the attempt but keeps what was drafted; Try again drafts only what is missing", async () => {
    const a = await commitDoorA("staged-resume@test.local");
    const broken = stagedClient({ fail: (sections) => (sections.includes("Pricing") ? new ModelUnavailableError("upstream 529 overloaded") : null) });
    await withModels(broken.client, async () => {
      const caller = hz.caller({ userId: a.userId });
      await caller.product.foundations.ensure({ businessId: a.businessId });
      await settleFoundationRuns();
    });
    const failed = await a.caller.product.foundations.get({ businessId: a.businessId });
    expect(failed).toMatchObject({ status: "failed", error: "The model service did not answer. Try again in a few minutes." });
    // What was drafted is kept and shown: the vision and every section but the failing one.
    expect(failed.vision).not.toBeNull();
    expect(failed.progress!.sections.find((s) => s.section === "Pricing")).toMatchObject({ done: false });
    expect(failed.progress!.sectionsDone).toBeGreaterThan(0);

    const working = stagedClient();
    await withModels(working.client, async () => {
      const caller = hz.caller({ userId: a.userId });
      expect(await caller.product.foundations.retry({ businessId: a.businessId })).toMatchObject({ started: true, attempt: 2 });
      await settleFoundationRuns();
    });
    expect(working.calls.filter((c) => c.route === "foundationsSkeleton")).toHaveLength(0);
    expect(working.calls.filter((c) => c.sections).flatMap((c) => c.sections!)).toEqual(["Pricing"]);
    expect(await a.caller.product.foundations.get({ businessId: a.businessId })).toMatchObject({ status: "ready", attempt: 2, progress: null });
    expect(docText((await repos.product.listBlocks(hz.db, a.businessId)).find((b) => b.section === "Pricing")!.content).length).toBeGreaterThan(20);
  });
});

