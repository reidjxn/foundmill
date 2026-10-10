/**
 * inbox.decide under a race (security review 2026-10-10): two answers to one decision that arrive together, from two
 * tabs, two members, or the DecisionBar and an agent conversation's "Go with: …" chip.
 *
 * Under READ COMMITTED both transactions read the item as open before either commits; the second one's update then waits
 * for the first's row lock and, when it re-checks the row, must find it answered and write nothing. PGlite runs one
 * connection, so the interleaving is reproduced by handing the second call the stale read it would have made: the item
 * as it was before the first answer committed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { repos, type ComposerItem } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("inbox-race");
});
afterAll(() => r?.close());

const decisionNote = (): ComposerItem => ({
  type: "decision",
  from_agent_id: r.A.agentId,
  subject: "Approve the supplier deposit",
  body_md: "The supplier needs an answer today.",
  status_strip: [],
  exhibit: { kind: "none", spec_ref: null },
  decision: {
    options: [
      { id: "pay", label: "Pay the deposit", recommended: true, consequence: "€400 leaves the account", cost_minor: 40000, reversible: false },
      { id: "wait", label: "Wait a week", recommended: false, consequence: "Nothing happens", cost_minor: 0, reversible: true },
    ],
    free_text: true,
    expires_at: null,
  },
  blocks_continue: true,
  source_event_ids: [],
  entity_ids: [],
});

describe("inbox.decide answers an item exactly once", () => {
  it("a second answer that read the item before the first committed writes nothing and is refused", async () => {
    const item = await repos.inbox.createItem(r.db, r.A.businessId, decisionNote());
    const stale = await repos.inbox.get(r.db, r.A.businessId, item.id);
    expect(stale.state).toBe("unread");

    // The first answer commits.
    await repos.inbox.decide(r.db, r.A.businessId, item.id, { chosenOption: "pay", decidedBy: r.A.ownerId });

    // The second had already read the item as open (the race): it must still not answer it again.
    const get = vi.spyOn(repos.inbox, "get").mockResolvedValueOnce(stale);
    try {
      await expect(repos.inbox.decide(r.db, r.A.businessId, item.id, { chosenOption: "wait", decidedBy: r.A.adminId })).rejects.toThrow(/already answered/);
    } finally {
      get.mockRestore();
    }

    const decisions = await repos.inbox.decisionsFor(r.db, r.A.businessId, item.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.chosenOption).toBe("pay");
  });

  it("an archived item cannot be answered either, even from a stale read", async () => {
    const item = await repos.inbox.createItem(r.db, r.A.businessId, decisionNote());
    const stale = await repos.inbox.get(r.db, r.A.businessId, item.id);
    await repos.inbox.archive(r.db, r.A.businessId, item.id);
    const get = vi.spyOn(repos.inbox, "get").mockResolvedValueOnce(stale);
    try {
      await expect(repos.inbox.decide(r.db, r.A.businessId, item.id, { chosenOption: "pay" })).rejects.toThrow(/already (answered|archived)/);
    } finally {
      get.mockRestore();
    }
    expect(await repos.inbox.decisionsFor(r.db, r.A.businessId, item.id)).toHaveLength(0);
  });
});
