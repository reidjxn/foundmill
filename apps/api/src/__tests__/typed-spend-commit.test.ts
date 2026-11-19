/**
 * A spend the founder types in a business they just committed (the real Commit path, not a fixture): for an archetype
 * whose first channels do not include the one named (a content business has no paid-ads agent), the typed budget lands
 * on the Distribution strategist, whose template allows no spend of its own. It asks for the founder's go-ahead.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFoundationsLocally } from "../services/foundations";
import { SPEND_ALLOWANCE_ASK } from "../services/plans";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "typed-spend", temporalClient: fakeTemporalClient(), env: { LIVE_MODE: "1" } });
}, 120_000);
afterAll(() => hz.close());

describe("a typed spend in a freshly committed business", () => {
  for (const archetype of ["content_media", "b2b_saas", "consumer_app"] as const) {
    it(`${archetype}: LinkedIn ads asks for the go-ahead, whichever agent runs the channel`, async () => {
      const userId = await hz.h.createUser(`founder-${archetype}@test.local`);
      const caller = hz.caller({ userId, email: `founder-${archetype}@test.local` });
      await caller.founder.profile.update({ confirmAdult: true, displayName: "Reid", timeCommitment: "full_time", residence: "United States", experience: "first-time", skills: { engineering: 14, sales: 8 }, targetMarkets: ["US"], riskAppetite: "medium" });
      const idea = (await caller.idea.generate({ prompt: "tools for climate operators" })).ideas[0]!;
      const { business } = await caller.idea.commit({ ideaId: idea.id, name: `Typed Spend ${archetype}`, archetype, gameMode: "personal", kit: { primary: "#1B4FD8", secondary: "#F5C400" } });

      // The first days are about the product (founder, 2026-10-18): the Board's question is posted once the founder
      // has signed off the specification and the roadmap and started distribution.
      const claimed = await repos.foundations.claim(hz.db, business.id, ["pending"]);
      await runFoundationsLocally({ db: hz.db, models: hz.deps.models, temporal: hz.deps.temporal, log: hz.deps.log }, business.id, claimed!.attempt);
      await caller.product.signoff.decide({ businessId: business.id, kind: "spec", decision: "approve" });
      await caller.product.signoff.decide({ businessId: business.id, kind: "roadmap", decision: "approve" });
      const started = await caller.business.startDistribution({ businessId: business.id });
      expect(started.boardItemId).toBeTruthy();
      const board = await repos.inbox.get(hz.db, business.id, started.boardItemId!);
      expect(board.type).toBe("decision");
      const reply = await caller.agent.conversation.inboxReply({ businessId: business.id, itemId: board.id, text: "Spend up to $500 on LinkedIn ads targeting fintech CFOs next week" });
      expect(reply.route).toBe("decision");
      if (reply.route !== "decision") return;
      const budget = reply.decision.evaluations.find((e) => e.action.type === "set_budget")!;
      expect(budget.outcome, JSON.stringify(budget)).toBe("ask");
      expect(reply.decision.requiresConfirmation).toBe(true);
      expect(reply.decision.plan.status).toBe("pending_confirmation");
      expect(reply.decision.plan.actions.find((a) => a.type === "set_budget")?.result).toMatchObject({ policyReasons: expect.any(Array) });
      if (archetype === "content_media") expect(budget.reasons).toEqual([SPEND_ALLOWANCE_ASK]);
    });
  }
});
