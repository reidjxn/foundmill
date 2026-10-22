/**
 * Import a plan through the API (`product.plan.preview` / `product.plan.import`): the vision lands on the foundations
 * row, an existing section is written as the founder's pinned edit, a new section is created after the others,
 * roadmap items join each horizon after the items already there, `replaceUnstarted` retires only items nobody started,
 * the preview writes nothing, and only owners and admins of the business itself can import.
 */
import { repos } from "@foundmill/db";
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "planimp" });
}, 120_000);
afterAll(() => hz?.close());

let fixtures = 0;
const fresh = (): Promise<BusinessFixture> => createBusinessFixture(hz.h, `planimp-${++fixtures}`);

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

const doc = (...paragraphs: string[]) => ({ type: "doc", content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });
const textOf = (d: unknown) => (JSON.stringify(d).match(/"text":"([^"]*)"/g) ?? []).map((m) => m.slice(8, -1)).join("|");

const PLAN = `# Vision
## Statement
Refills without spreadsheets.
## For whom
Small skincare brands.
## Problem
Refills are tracked by hand.
## Why now
Refill programs are growing.
## Principles
- **Customers first**: every change starts with a customer.
## North star
- Metric: Monthly refill orders
- Definition: Refill orders paid in a month.
- Target: 400 refill orders by Mar 2027

# Specification
## problem
Refills are tracked **by hand**.
### What breaks
- Missed orders
## Go to market
Sell through clinics.

# Roadmap
## Now
### Refill reminders
Remind customers before a refill.
Acceptance:
- A reminder goes out 3 days before
### Skip a month
Customers skip one refill.
## Later
### Annual billing
`;

describe("product.plan.import", () => {
  it("writes the vision, rewrites a section as the founder's pinned edit, adds a section last and the items after the existing ones", async () => {
    const F = await fresh();
    const owner = hz.caller({ userId: F.ownerId });
    const problem = await repos.product.createBlock(hz.db, F.businessId, { section: "Problem", content: doc("Agent draft."), authoredByKind: "agent", authoredBy: F.agentId });
    const problem2 = await repos.product.createBlock(hz.db, F.businessId, { section: "Problem", content: doc("A second paragraph.") });
    const pricing = await repos.product.createBlock(hz.db, F.businessId, { section: "Pricing", content: doc("Untouched.") });

    const result = await owner.product.plan.import({ businessId: F.businessId, fileText: PLAN });
    expect(result).toEqual({ sectionsWritten: ["Problem"], sectionsCreated: ["Go to market"], paragraphsRetired: 1, itemsAdded: { now: 2, next: 0, later: 1 }, itemsArchived: 0, visionSet: true });

    // The vision is on the foundations row and reads on the Vision tab; the north star carries its label.
    const foundations = await owner.product.foundations.get({ businessId: F.businessId });
    expect(foundations.status).toBe("ready");
    expect(foundations.vision).toMatchObject({ statement: "Refills without spreadsheets.", principles: [{ title: "Customers first", detail: "every change starts with a customer." }], northStar: { metric: "Monthly refill orders", target: "400 refill orders by Mar 2027", label: "Estimate" } });

    const blocks = (await owner.product.spec.get({ businessId: F.businessId })).blocks;
    // The existing section: the founder's edit, pinned and versioned, headed by the section's own name.
    const written = blocks.find((b) => b.id === problem.id)!;
    expect(written).toMatchObject({ section: "Problem", authoredByKind: "user", authoredBy: F.ownerId, pinned: true, version: problem.version + 1 });
    expect(textOf(written.content)).toBe("Problem|Refills are tracked |by hand|.|What breaks|Missed orders");
    expect((written.content as { content: { type: string; attrs?: { level: number } }[] }).content[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    // Its other paragraph is retired; a section the file does not name is left exactly as it was.
    expect(blocks.some((b) => b.id === problem2.id)).toBe(false);
    expect(blocks.find((b) => b.id === pricing.id)).toMatchObject({ version: pricing.version, pinned: false, content: doc("Untouched.") });
    // The new section: authored by the founder, pinned, after every other block.
    const created = blocks.find((b) => b.section === "Go to market")!;
    expect(created).toMatchObject({ authoredByKind: "user", authoredBy: F.ownerId, pinned: true });
    expect(created.position).toBeGreaterThan(Math.max(...blocks.filter((b) => b.id !== created.id).map((b) => b.position)));

    // Roadmap: each horizon's new items after the ones already there, in the file's order, criteria in the description.
    const now = await repos.product.listRoadmap(hz.db, F.businessId, { horizon: "now" });
    expect(now.map((i) => i.title)).toEqual(["Ship onboarding", "Refill reminders", "Skip a month"]);
    expect(now.find((i) => i.title === "Refill reminders")!.descriptionMd).toBe("Remind customers before a refill.\n\nAcceptance:\n- A reminder goes out 3 days before");
    const later = await repos.product.listRoadmap(hz.db, F.businessId, { horizon: "later" });
    expect(later.at(-1)).toMatchObject({ title: "Annual billing", status: "planned" });
    expect(later.at(-1)!.position).toBeGreaterThan(Math.max(...later.slice(0, -1).map((i) => i.position)));

    // One audit entry.
    const entries = await repos.audit.list(hz.db, F.businessId, { action: ["product.plan.import"] });
    expect(entries.items).toHaveLength(1);
    expect(entries.items[0]).toMatchObject({ actorKind: "user", actorId: F.ownerId, details: { sectionsWritten: ["Problem"], visionSet: true } });
  });

  it("replaceUnstarted retires only items nobody started, and never one with started or finished work", async () => {
    const F = await fresh();
    const admin = hz.caller({ userId: F.adminId });
    // The fixture's "Ship onboarding" has a planned task; give it a running one, and set up the other cases.
    await repos.tasks.create(hz.db, F.businessId, { kind: "code", title: "Started work", roadmapItemId: F.roadmapItemId, status: "running" });
    const finishedWork = await repos.product.upsertRoadmapItem(hz.db, F.businessId, { title: "Finished work", horizon: "next" });
    await repos.tasks.create(hz.db, F.businessId, { kind: "code", title: "Done task", roadmapItemId: finishedWork.id, status: "done" });
    const plannedOnly = await repos.product.upsertRoadmapItem(hz.db, F.businessId, { title: "Planned tasks only", horizon: "next" });
    await repos.tasks.create(hz.db, F.businessId, { kind: "code", title: "Not started", roadmapItemId: plannedOnly.id });
    const doneItem = await repos.product.upsertRoadmapItem(hz.db, F.businessId, { title: "Shipped already", horizon: "later", status: "done" });
    const before = await repos.product.listRoadmap(hz.db, F.businessId);

    const preview = await admin.product.plan.preview({ businessId: F.businessId, fileText: PLAN, replaceUnstarted: true });
    // Billing (next), the 8 fixture Later items and "Planned tasks only".
    expect(preview).toMatchObject({ ok: true, archive: 10 });

    const result = await admin.product.plan.import({ businessId: F.businessId, fileText: PLAN, replaceUnstarted: true });
    expect(result.itemsArchived).toBe(10);
    const after = await repos.product.listRoadmap(hz.db, F.businessId);
    const kept = new Set([F.roadmapItemId, finishedWork.id, doneItem.id]);
    expect(after.filter((i) => before.some((b) => b.id === i.id)).map((i) => i.id).sort()).toEqual([...kept].sort());
    expect(after.some((i) => i.id === plannedOnly.id)).toBe(false);
    // Archived, not deleted.
    expect((await repos.product.getRoadmapItem(hz.db, F.businessId, plannedOnly.id)).archivedAt).not.toBeNull();
    // The new Later item follows the kept done item.
    const later = after.filter((i) => i.horizon === "later");
    expect(later.map((i) => i.title)).toEqual(["Shipped already", "Annual billing"]);
  });

  it("without a roadmap in the file, replaceUnstarted retires nothing", async () => {
    const F = await fresh();
    const owner = hz.caller({ userId: F.ownerId });
    const result = await owner.product.plan.import({ businessId: F.businessId, fileText: "# Specification\n## Risks\nSupply.\n", replaceUnstarted: true });
    expect(result).toMatchObject({ itemsArchived: 0, visionSet: false, sectionsCreated: ["Risks"] });
    expect(await repos.foundations.get(hz.db, F.businessId)).toBeNull();
  });

  it("refuses a file with problems, naming the line, and writes nothing", async () => {
    const F = await fresh();
    const owner = hz.caller({ userId: F.ownerId });
    const before = (await repos.product.listBlocks(hz.db, F.businessId)).length;
    await expect(owner.product.plan.import({ businessId: F.businessId, fileText: "# Specification\n## Risks\nSupply.\n# Appendix\n" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/^Line 4: "# Appendix" is not a part of a plan file/) });
    expect((await repos.product.listBlocks(hz.db, F.businessId)).length).toBe(before);
  });

  it("refuses while the first drafting runs; a pending first drafting is replaced by the founder's vision", async () => {
    const F = await fresh();
    const owner = hz.caller({ userId: F.ownerId });
    await repos.foundations.create(hz.db, F.businessId, { door: "ideation" });
    await repos.foundations.claim(hz.db, F.businessId);
    const preview = await owner.product.plan.preview({ businessId: F.businessId, fileText: PLAN });
    expect(preview).toMatchObject({ ok: false, errors: [{ line: null, message: expect.stringContaining("still being written") }] });
    expect(await code(owner.product.plan.import({ businessId: F.businessId, fileText: PLAN }))).toBe("BAD_REQUEST");
    expect((await repos.product.listRoadmap(hz.db, F.businessId, { horizon: "later" })).some((i) => i.title === "Annual billing")).toBe(false);

    const G = await fresh();
    await repos.foundations.create(hz.db, G.businessId, { door: "ideation" });
    await hz.caller({ userId: G.ownerId }).product.plan.import({ businessId: G.businessId, fileText: PLAN });
    expect(await repos.foundations.get(hz.db, G.businessId)).toMatchObject({ status: "ready", vision: { statement: "Refills without spreadsheets." }, summary: { importedPlan: { importedBy: G.ownerId } } });
  });
});

describe("product.plan.preview", () => {
  it("says what would be written and writes nothing", async () => {
    const F = await fresh();
    const owner = hz.caller({ userId: F.ownerId });
    await repos.product.createBlock(hz.db, F.businessId, { section: "Problem", content: doc("Draft.") });
    const snapshot = async () => ({
      blocks: await repos.product.listBlocks(hz.db, F.businessId),
      roadmap: await repos.product.listRoadmap(hz.db, F.businessId),
      foundations: await repos.foundations.get(hz.db, F.businessId),
      audit: (await repos.audit.list(hz.db, F.businessId, {})).items.length,
    });
    const before = await snapshot();
    // Every fixture item only has planned tasks (or none), so all ten would be retired.
    const preview = await owner.product.plan.preview({ businessId: F.businessId, fileText: PLAN, replaceUnstarted: true });
    expect(preview).toEqual({ ok: true, errors: [], vision: true, sections: { write: ["Problem"], create: ["Go to market"], paragraphsRetired: 0 }, roadmap: { now: 2, next: 0, later: 1 }, archive: 10 });
    expect(await snapshot()).toEqual(before);

    const bad = await owner.product.plan.preview({ businessId: F.businessId, fileText: "# Roadmap\n## Soon\n### A\n" });
    expect(bad).toMatchObject({ ok: false, errors: [{ line: 2, message: expect.stringContaining('"## Soon" is not a roadmap horizon') }] });
    expect(await snapshot()).toEqual(before);
  });
});

describe("who may import", () => {
  it("owners and admins only: members, viewers and example viewers are refused", async () => {
    const { businessId, ownerId, adminId, memberId, viewerId } = hz.A;
    const file = "# Specification\n## Who imports\nOwners and admins.\n";
    for (const userId of [memberId, viewerId]) {
      expect(await code(hz.caller({ userId }).product.plan.preview({ businessId, fileText: file }))).toBe("FORBIDDEN");
      expect(await code(hz.caller({ userId }).product.plan.import({ businessId, fileText: file }))).toBe("FORBIDDEN");
    }
    const explorer = await hz.h.createUser("planimp-explorer@test.local");
    await repos.memberships.openExample(hz.db, businessId, explorer);
    expect(await code(hz.caller({ userId: explorer }).product.plan.import({ businessId, fileText: file }))).toBe("FORBIDDEN");
    expect((await repos.product.listBlocks(hz.db, businessId)).some((b) => b.section === "Who imports")).toBe(false);

    expect(await code(hz.caller({ userId: adminId }).product.plan.preview({ businessId, fileText: file }))).toBe("OK");
    expect(await code(hz.caller({ userId: ownerId }).product.plan.import({ businessId, fileText: file }))).toBe("OK");
    expect((await repos.product.listBlocks(hz.db, businessId)).some((b) => b.section === "Who imports")).toBe(true);
  });

  it("an owner of one business cannot preview or write another (cross-tenant)", async () => {
    const before = { blocks: await repos.product.listBlocks(hz.db, hz.B.businessId), roadmap: await repos.product.listRoadmap(hz.db, hz.B.businessId) };
    const ownerA = hz.caller({ userId: hz.A.ownerId });
    expect(await code(ownerA.product.plan.preview({ businessId: hz.B.businessId, fileText: PLAN }))).toBe("FORBIDDEN");
    expect(await code(ownerA.product.plan.import({ businessId: hz.B.businessId, fileText: PLAN, replaceUnstarted: true }))).toBe("FORBIDDEN");
    expect({ blocks: await repos.product.listBlocks(hz.db, hz.B.businessId), roadmap: await repos.product.listRoadmap(hz.db, hz.B.businessId) }).toEqual(before);
    expect(await repos.foundations.get(hz.db, hz.B.businessId)).toBeNull();
  });
});
