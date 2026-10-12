import { getArchetypeSeed } from "@foundmill/agents";
import { includedCreditsMinor } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { CHANNEL_KEYS } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
const temporal = fakeTemporalClient();
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "commit", temporalClient: temporal });
}, 120_000);
afterAll(() => hz.close());

describe("idea.commit (AC-11.1.6, AC-11.1.7)", () => {
  it("creates the full structure with default mode assisted and starts the first cycle", async () => {
    const userId = await hz.h.createUser("founder@test.local");
    const caller = hz.caller({ userId, email: "founder@test.local" });
    await caller.founder.profile.update({ displayName: "Reid", experience: "first-time", skills: { engineering: 14, sales: 8 }, targetMarkets: ["EU"], riskAppetite: "medium" });

    const generated = await caller.idea.generate({ prompt: "bookkeeping for freelancers in the EU" });
    expect(generated.ideas.length).toBeGreaterThanOrEqual(6);
    expect(generated.ideas.length).toBeLessThanOrEqual(12);
    const idea = generated.ideas[0]!;
    expect(Object.keys(idea.current!.attributes as Record<string, unknown>)).toHaveLength(10);

    const result = await caller.idea.commit({ ideaId: idea.id, name: "Ledgerly Test", archetype: "b2b_saas", gameMode: "personal", kit: { primary: "#1B4FD8", secondary: "#F5C400" } });
    const seed = getArchetypeSeed("b2b_saas");
    const bid = result.business.id;

    // Business + membership + mode (AC-11.1.7).
    const business = await repos.businesses.get(hz.db, bid);
    expect(business.businessMode).toBe("assisted");
    expect(business.archetype).toBe("b2b_saas");
    expect(business.committedAt).not.toBeNull();
    expect(business.kitPrimary.toLowerCase()).toBe("#1b4fd8");
    const membership = await repos.memberships.get(hz.db, bid, userId);
    expect(membership?.role).toBe("owner");

    // Departments 1:1 with the seed; every one has its module tabs as screen definitions.
    const departments = await repos.departments.list(hz.db, bid);
    expect(departments.map((d) => d.slug).sort()).toEqual(seed.departments.map((d) => d.slug.replace(/_/g, "-")).sort());
    for (const d of departments) {
      expect(d.leadAgentId).not.toBeNull();
      const screens = await repos.screens.list(hz.db, bid, d.id);
      expect(screens.length).toBeGreaterThan(0);
    }

    // Agents with a live version and baseline skills (AC-11.1.6).
    const agents = await repos.agents.list(hz.db, bid, { limit: 500 });
    expect(agents.items.length).toBe(result.agentIds.length);
    expect(agents.items.some((a) => a.agentType === "chief_of_staff")).toBe(true);
    for (const a of agents.items) {
      expect(a.currentVersionId).not.toBeNull();
      const skills = await repos.skills.listForAgent(hz.db, bid, a.id);
      expect(skills.length).toBeGreaterThan(0);
      expect(skills.every((s) => s.displayed >= 1 && s.displayed <= 20)).toBe(true);
    }

    // All 15 channels exist; the archetype's starters are enabled and recommended.
    const channels = await repos.channels.list(hz.db, bid);
    expect(channels).toHaveLength(CHANNEL_KEYS.length);
    expect(channels.filter((c) => c.enabled).map((c) => c.channelKey).sort()).toEqual([...seed.defaultChannels].sort());

    // Spec outline, first tasks, dashboard.
    const blocks = await repos.product.listBlocks(hz.db, bid);
    expect(blocks.map((b) => b.section).sort()).toEqual([...seed.specOutline].sort());
    expect(blocks.sort((a, b) => a.position - b.position).map((b) => b.section)).toEqual(seed.specOutline);
    expect(result.taskIds.length).toBe(seed.firstCycleTasks.length);
    const dashboards = await repos.dashboards.list(hz.db, bid, userId);
    expect(dashboards).toHaveLength(1);

    // The Board's first decision in the Inbox, blocking Continue.
    const inbox = await caller.inbox.list({ businessId: bid, tab: "respond" });
    expect(inbox.items.some((i) => i.id === result.boardItem.id && i.type === "decision" && i.blocksContinue)).toBe(true);
    expect(result.boardItem.fromAgentId).toBe(result.chiefOfStaffId);
    expect(inbox.continueState).toEqual({ kind: "blocked", count: 1 });

    // Event through the outbox + audit + idea stamped.
    const events = await repos.events.list(hz.db, bid, { type: "idea.committed" });
    expect(events.items).toHaveLength(1);
    expect((events.items[0]!.payload as { businessMode: string }).businessMode).toBe("assisted");
    expect((await repos.events.outboxCountPending(hz.db, bid)) >= 1).toBe(true);
    const audit = await repos.audit.list(hz.db, bid, { action: "idea.commit" });
    expect(audit.items).toHaveLength(1);
    const committed = await repos.ideas.get(hz.db, userId, idea.id);
    expect(committed.businessId).toBe(bid);

    // First businessCycle started on (fake) Temporal with the deterministic id.
    expect(result.cycle.queued).toBe(true);
    expect(temporal.starts.find((s) => s.type === "businessCycle")?.workflowId).toBe(`cycle:${bid}:1`);

    // Every starter channel on the board runs its engine from the start, its id recorded on the channel (audit GTM-01).
    const running = await repos.channels.list(hz.db, bid, { enabled: true });
    expect(running.map((c) => c.channelKey).sort()).toEqual([...seed.defaultChannels].sort());
    for (const c of running) {
      expect(temporal.starts.some((s) => s.type === "channelEngine" && s.workflowId === `engine:${c.id}`)).toBe(true);
      expect(c.engineWorkflowId).toBe(`engine:${c.id}`);
    }
    expect(result.engines.map((e) => e.workflowId).sort()).toEqual(running.map((c) => `engine:${c.id}`).sort());

    // The new owner can read the business and departments through the business procedures.
    const me = await caller.business.get({ businessId: bid });
    expect(me.role).toBe("owner");
    expect(me.departments.length).toBe(departments.length);
    const squad = await caller.team.agents.list({ businessId: bid });
    expect(squad.agents.length).toBe(agents.items.length);
  });

  it("Take charge twice (a double click, a second tab, a retry) builds one business and answers both with it", async () => {
    const userId = await hz.h.createUser("twice@test.local");
    const caller = hz.caller({ userId, email: "twice@test.local" });
    await caller.founder.profile.update({ displayName: "Twice", experience: "first-time", skills: { engineering: 10 }, targetMarkets: ["US"], riskAppetite: "low" });
    const idea = (await caller.idea.generate({ prompt: "invoicing for dog walkers" })).ideas[0]!;
    const input = { ideaId: idea.id, name: "Twice Walks", archetype: "b2b_saas" as const, gameMode: "personal" as const };

    // Two calls in one batched request (what a double click sent): both succeed, with the same business.
    const [first, second] = await Promise.all([caller.idea.commit(input), caller.idea.commit({ ...input, name: "Twice Walks Again" })]);
    expect(second.business.id).toBe(first.business.id);
    expect([first.alreadyCommitted, second.alreadyCommitted].sort()).toEqual([false, true]);
    const created = first.alreadyCommitted ? second : first;
    const replay = first.alreadyCommitted ? first : second;
    expect(replay.business.name).toBe(created.business.name);
    expect(replay.boardItem.id).toBe(created.boardItem.id);
    expect(replay.chiefOfStaffId).toBe(created.chiefOfStaffId);
    expect(replay.taskIds).toEqual(created.taskIds);
    expect([...replay.departmentIds].sort()).toEqual([...created.departmentIds].sort());
    expect([...replay.agentIds].sort()).toEqual([...created.agentIds].sort());
    expect(replay.cycle.queued).toBe(false);

    // A retry after the fact answers the same way.
    const retry = await caller.idea.commit(input);
    expect(retry).toMatchObject({ alreadyCommitted: true, business: { id: created.business.id }, boardItem: { id: created.boardItem.id } });

    // Exactly one business, one team, one Board item, one first cycle.
    const mine = (await repos.businesses.listForUser(hz.db, userId)).filter((b) => b.name.startsWith("Twice Walks"));
    expect(mine.map((b) => b.id)).toEqual([created.business.id]);
    expect((await repos.agents.list(hz.db, created.business.id, { limit: 500 })).items).toHaveLength(created.agentIds.length);
    expect((await repos.events.list(hz.db, created.business.id, { type: "idea.committed" })).items).toHaveLength(1);
    expect(temporal.starts.filter((s) => s.type === "businessCycle" && s.workflowId === `cycle:${created.business.id}:1`)).toHaveLength(1);
    expect((await repos.ideas.get(hz.db, userId, idea.id)).businessId).toBe(created.business.id);

    // Another founder cannot reach the business through the idea.
    const otherId = await hz.h.createUser("other-twice@test.local");
    const other = hz.caller({ userId: otherId, email: "other-twice@test.local" });
    await other.founder.profile.update({ displayName: "Other", experience: "first-time", skills: { engineering: 10 }, targetMarkets: ["US"], riskAppetite: "low" });
    await expect(other.idea.commit(input)).rejects.toThrow(/not found/);
  });

  it("starts on the free tier with this month's included credits in US dollars, keeps the spend cap, and refuses a second business", async () => {
    const userId = await hz.h.createUser("tier@test.local");
    const caller = hz.caller({ userId, email: "tier@test.local" });
    await caller.founder.profile.update({ displayName: "Ada", experience: "first-time", skills: { engineering: 10 }, targetMarkets: ["US"], riskAppetite: "low" });
    const generated = await caller.idea.generate({ prompt: "invoicing for dog groomers" });
    const [first, second] = generated.ideas;

    const result = await caller.idea.commit({ ideaId: first!.id, name: "Tier One", archetype: "b2b_saas", gameMode: "personal", currency: "USD", spendCapMinor: 5_000 });
    const bid = result.business.id;
    expect(await repos.businesses.get(hz.db, bid)).toMatchObject({ planTier: "free", modelBilling: "credits", spendCapMinor: 5_000 });
    const period = new Date().toISOString().slice(0, 7);
    expect(await repos.usage.creditBalance(hz.db, bid, period)).toMatchObject({ grantedMinor: includedCreditsMinor("free"), balanceMinor: includedCreditsMinor("free"), currency: "USD" });
    const plan = await caller.billing.plan({ businessId: bid });
    expect(plan).toMatchObject({ tier: "free", modelBilling: "credits", creditsCurrency: "USD", includedCreditsMinor: includedCreditsMinor("free"), credits: { currency: "USD", exhausted: false }, usage: { currency: "USD" } });
    expect((await repos.audit.list(hz.db, bid, { action: "idea.commit" })).items[0]?.details).toMatchObject({ spendCapMinor: 5_000, planTier: "free", modelBilling: "credits", includedCreditsMinor: includedCreditsMinor("free") });

    // The free plan holds one business: the second commit is refused with a typed error and creates nothing.
    await expect(caller.idea.commit({ ideaId: second!.id, name: "Tier Two", archetype: "b2b_saas", gameMode: "personal" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: { code: "tier_limit", details: { limit: "businesses", tier: "free", allowed: 1, used: 1, planBusinessId: bid } },
    });
    expect((await repos.businesses.listForUser(hz.db, userId)).map((b) => b.id)).toEqual([bid]);
    expect((await repos.ideas.get(hz.db, userId, second!.id)).businessId).toBeNull();

    // An archived business frees its place.
    await caller.business.archive({ businessId: bid, reason: "trying another idea" });
    const again = await caller.idea.commit({ ideaId: second!.id, name: "Tier Two", archetype: "b2b_saas", gameMode: "personal" });
    expect(again.business).toMatchObject({ planTier: "free", spendCapMinor: null });
  });

  it("preview lists what an archetype seeds, labelled Estimate", async () => {
    const userId = await hz.h.createUser("preview@test.local");
    const preview = await hz.caller({ userId }).idea.preview({ archetype: "dtc_physical" });
    expect(preview.departments.some((d) => d.moduleKeys.includes("development"))).toBe(true);
    expect(preview.agents.every((a) => a.wageLabel === "Estimate")).toBe(true);
    expect(preview.defaultChannels.length).toBeGreaterThanOrEqual(3);
  });
});
