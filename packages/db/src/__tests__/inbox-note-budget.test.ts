/**
 * The first week's note budget (WP-04 T8): in a project's first days, an agent's plain update is stored archived and
 * listed in one Chief of Staff note, "What your team did today", which replaces itself. Decisions, warnings and the
 * Chief of Staff's own notes are never folded, and a sample business always gets every note.
 */
import { LIMITS } from "@foundmill/config";
import { DIGEST_SUBJECT } from "@foundmill/shared";
import { and, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos, type ComposerItem } from "../repos";
import { businesses, inboxItems } from "../schema";
import { setupRepoHarness, type RepoHarness } from "./repos/helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("note-budget");
}, 120_000);
afterAll(() => r?.close());

const note = (agentId: string, over: Partial<ComposerItem> = {}): ComposerItem => ({
  type: "update",
  from_agent_id: agentId,
  subject: "Progress",
  body_md: "The team made progress.",
  status_strip: [],
  exhibit: { kind: "none", spec_ref: null },
  decision: null,
  blocks_continue: false,
  source_event_ids: [],
  entity_ids: [],
  ...over,
});

const decision = (agentId: string): ComposerItem =>
  note(agentId, {
    type: "decision",
    subject: "Pick a name for the newsletter",
    decision: {
      options: [
        { id: "a", label: "Weekly notes", recommended: true, consequence: "The lead uses it", cost_minor: 0, reversible: true },
        { id: "b", label: "Field notes", recommended: false, consequence: "The lead uses it", cost_minor: 0, reversible: true },
      ],
      free_text: false,
      expires_at: null,
    },
  });

const openNotes = (businessId: string) => r.db.select().from(inboxItems).where(and(eq(inboxItems.businessId, businessId), ne(inboxItems.state, "archived")));

describe("the first week's note budget", () => {
  it("folds three agent updates on day one into one Chief of Staff note and leaves a decision untouched", async () => {
    const { businessId, agentId: chiefId, agent2Id } = r.A;
    await repos.businesses.commit(r.db, businessId, { archetype: "b2b_saas", committedAt: new Date(Date.now() - 60 * 60 * 1000) });
    const designer = await repos.agents.create(r.db, businessId, { name: "Page Designer", agentType: "designer" });
    const before = (await openNotes(businessId)).length;

    const first = await repos.inbox.createItem(r.db, businessId, note(agent2Id, { subject: "Set up the build" }));
    const question = await repos.inbox.createItem(r.db, businessId, decision(designer.id));
    const second = await repos.inbox.createItem(r.db, businessId, note(designer.id, { subject: "Drafted the page" }));
    const third = await repos.inbox.createItem(r.db, businessId, note(designer.id, { type: "report", subject: "Read three competitors" }));

    for (const folded of [first, second, third]) expect(folded.state).toBe("archived");
    expect(question.state).toBe("unread");

    const open = await openNotes(businessId);
    const digests = open.filter((n) => n.subject === DIGEST_SUBJECT);
    expect(digests).toHaveLength(1);
    const digest = digests[0]!;
    expect(digest.fromAgentId).toBe(chiefId);
    expect(digest.type).toBe("update");
    expect(digest.state).toBe("unread");
    expect(digest.bodyMd).toContain("Set up the build");
    expect(digest.bodyMd).toContain("Page Designer: Drafted the page");
    expect(digest.bodyMd).toContain("Page Designer: Read three competitors");
    expect(digest.bodyMd.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3);

    // The fixture's own note was there before; the day added the decision and the digest, nothing else.
    expect(open.length - before).toBe(2);
    expect(open.map((n) => n.id)).toContain(question.id);
    expect(open.length).toBeLessThanOrEqual(LIMITS.firstWeekNotesPerDay + before);
  });

  it("delivers warnings and the Chief of Staff's own updates", async () => {
    const { businessId, agentId: chiefId, agent2Id } = r.A;
    const warning = await repos.inbox.createItem(r.db, businessId, note(agent2Id, { type: "warning", subject: "The build failed" }));
    const own = await repos.inbox.createItem(r.db, businessId, note(chiefId, { subject: "Welcome aboard" }));
    expect(warning.state).toBe("unread");
    expect(own.state).toBe("unread");
  });

  it("delivers every note after the first week", async () => {
    const { businessId, agent2Id } = r.B;
    await repos.businesses.commit(r.db, businessId, { archetype: "b2b_saas", committedAt: new Date(Date.now() - (LIMITS.firstWeekDays + 2) * 24 * 60 * 60 * 1000) });
    const item = await repos.inbox.createItem(r.db, businessId, note(agent2Id, { subject: "Week two work" }));
    expect(item.state).toBe("unread");
  });

  it("delivers every note in a sample business", async () => {
    const { businessId, agent2Id } = r.B;
    await r.db.update(businesses).set({ isDemo: true, committedAt: new Date() }).where(eq(businesses.id, businessId));
    const item = await repos.inbox.createItem(r.db, businessId, note(agent2Id, { subject: "Sample work" }));
    expect(item.state).toBe("unread");
  });
});
