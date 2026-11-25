/**
 * Two inbox rules from the review of the UX plan build:
 *   - F38: the first-week flag "Read a note from an agent" ticks only when a founder (an owner or admin, never an
 *     example viewer) opens an agent's note. A note answered without being opened (a sign-off approved from the
 *     Product tab, the Chief of Staff on vacation) and other people's openings do not count.
 *   - F36: a decision option's model-written "because" longer than the stored 400 characters, or carrying entity
 *     markup, no longer fails the whole note: createItem reduces the markup to its name and clamps it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos, withPlainOptionLines, type ComposerItem } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("inbox-first-week");
}, 120_000);
afterAll(() => r?.close());

const ENT = "11111111-1111-4111-8111-111111111111";

const note = (agentId: string, over: Partial<ComposerItem> = {}): ComposerItem => ({
  type: "update",
  from_agent_id: agentId,
  subject: "Week 1 shipped",
  body_md: "The first landing page is live.",
  status_strip: [],
  exhibit: { kind: "none", spec_ref: null },
  decision: null,
  blocks_continue: false,
  source_event_ids: [],
  entity_ids: [],
  ...over,
});

const decisionNote = (agentId: string, because: string): ComposerItem =>
  note(agentId, {
    type: "decision",
    subject: "Sign off the specification",
    decision: {
      options: [
        { id: "approve", label: "Approve", recommended: true, consequence: "Building starts", cost_minor: 0, reversible: true, because },
        { id: "changes", label: "Ask for changes", recommended: false, consequence: "The lead revises it", cost_minor: 0, reversible: true },
      ],
      free_text: true,
      expires_at: null,
    },
    blocks_continue: true,
  });

const noteRead = (userId: string, businessId: string) => r.as(userId, (tx) => repos.inbox.anyAgentNoteOpened(tx, businessId));

describe("first-week 'Read a note from an agent' counts a founder's opening only (review F38)", () => {
  it("stays false when a note is answered unopened, read by the system, or opened by staff, a viewer or an example viewer", async () => {
    const { businessId, agentId, ownerId, memberId, viewerId } = r.B;
    expect(await noteRead(ownerId, businessId)).toBe(false);

    // A sign-off approved from the Product tab answers its note without anyone opening it.
    const signoff = await repos.inbox.createItem(r.db, businessId, decisionNote(agentId, "Recommended because the build can start."));
    await repos.inbox.decide(r.db, businessId, signoff.id, { chosenOption: "approve", decidedBy: ownerId });
    // The Chief of Staff reads a note for the whole business on vacation (no user).
    const update = await repos.inbox.createItem(r.db, businessId, note(agentId));
    await repos.inbox.markRead(r.db, businessId, update.id, null);
    // Staff and a viewer open it; so does someone exploring the business as an example.
    const explorer = await r.h.createUser("first-week-explorer@test.local");
    await repos.memberships.openExample(r.db, businessId, explorer);
    const fresh = await repos.inbox.createItem(r.db, businessId, note(agentId, { subject: "Fresh note" }));
    for (const u of [memberId, viewerId, explorer]) await r.as(u, (tx) => repos.inbox.markRead(tx, businessId, fresh.id, u));

    expect(await noteRead(ownerId, businessId)).toBe(false);
    expect(await repos.inbox.anyAgentNoteOpened(r.db, businessId)).toBe(false);

    // The founder opens it: now it counts.
    await r.as(ownerId, (tx) => repos.inbox.markRead(tx, businessId, fresh.id, ownerId));
    expect(await noteRead(ownerId, businessId)).toBe(true);
  });

  it("counts an admin's opening, and never a person's own message", async () => {
    const { businessId, adminId, ownerId, agentId } = r.A;
    const message = await repos.inbox.createHumanMessage(r.db, businessId, { fromUserId: ownerId, subject: "Hello", bodyMd: "A note from a person." });
    await r.as(adminId, (tx) => repos.inbox.markRead(tx, businessId, message.id, adminId));
    expect(await repos.inbox.anyAgentNoteOpened(r.db, businessId)).toBe(false);
    const agentNote = await repos.inbox.createItem(r.db, businessId, note(agentId, { subject: "Admin reads" }));
    await r.as(adminId, (tx) => repos.inbox.markRead(tx, businessId, agentNote.id, adminId));
    expect(await repos.inbox.anyAgentNoteOpened(r.db, businessId)).toBe(true);
  });
});

describe("a decision option's 'because' is a bounded plain line (review F36)", () => {
  it("clamps a 450-character because to 400 instead of failing the note, and reduces entity markup to its name", async () => {
    const long = `Recommended because ${"the supplier ships sooner and ".repeat(15)}it is reversible.`;
    expect(long.length).toBeGreaterThan(400);
    const item = await repos.inbox.createItem(r.db, r.A.businessId, decisionNote(r.A.agentId, long));
    const stored = (item.decision as { options: { id: string; because?: string }[] }).options;
    expect(stored[0]!.because!.length).toBeLessThanOrEqual(400);
    expect(stored[0]!.because!.length).toBeGreaterThan(390);
    expect(stored[0]!.because!.endsWith("…")).toBe(true);
    expect(stored[1]!.because).toBeUndefined();

    const linked = await repos.inbox.createItem(r.db, r.A.businessId, decisionNote(r.A.agentId, `Recommended because [[ent:${ENT}|Acme Ltd]] pays on time.`));
    expect((linked.decision as { options: { because?: string }[] }).options[0]!.because).toBe("Recommended because Acme Ltd pays on time.");
  });

  it("drops an empty because, clamps a long label, and leaves a note without a decision as it is", () => {
    const blank = withPlainOptionLines(decisionNote(r.A.agentId, "   "));
    expect(blank.decision!.options[0]).not.toHaveProperty("because");
    const longLabel = withPlainOptionLines({ ...decisionNote(r.A.agentId, "Why"), decision: { ...decisionNote(r.A.agentId, "Why").decision!, options: decisionNote(r.A.agentId, "Why").decision!.options.map((o, i) => (i === 0 ? { ...o, label: "x".repeat(130) } : o)) } });
    expect(longLabel.decision!.options[0]!.label).toHaveLength(120);
    const plain = note(r.A.agentId);
    expect(withPlainOptionLines(plain)).toBe(plain);
  });
});

describe("a Chief of Staff report never replaces the welcome note (the build choice, Nov 25, 2026)", () => {
  it("keeps the Chief of Staff's current update open beside a report; a newer update still replaces it", async () => {
    const chief = (await repos.agents.chiefOfStaff(r.db, r.A.businessId))!;
    const welcome = await repos.inbox.createItem(r.db, r.A.businessId, note(chief.id, { subject: "Northwind has started" }), { state: "unread" });
    const report = await repos.inbox.createItem(r.db, r.A.businessId, note(chief.id, { type: "report", subject: "No separate app needed: your page covers it" }), { state: "unread" });
    expect((await repos.inbox.get(r.db, r.A.businessId, welcome.id)).state).toBe("unread");
    expect((await repos.inbox.get(r.db, r.A.businessId, report.id)).state).toBe("unread");
    // The rule the report avoids: one current update per agent.
    await repos.inbox.createItem(r.db, r.A.businessId, note(chief.id, { subject: "A newer update" }), { state: "unread" });
    expect((await repos.inbox.get(r.db, r.A.businessId, welcome.id)).state).toBe("archived");
    expect((await repos.inbox.get(r.db, r.A.businessId, report.id)).state).toBe("unread");
  });
});
