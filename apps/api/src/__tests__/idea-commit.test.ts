import { getArchetypeSeed } from "@foundmill/agents";
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

    // The new owner can read the business and departments through the business procedures.
    const me = await caller.business.get({ businessId: bid });
    expect(me.role).toBe("owner");
    expect(me.departments.length).toBe(departments.length);
    const squad = await caller.team.agents.list({ businessId: bid });
    expect(squad.agents.length).toBe(agents.items.length);
  });

  it("preview lists what an archetype seeds, labelled Estimate", async () => {
    const userId = await hz.h.createUser("preview@test.local");
    const preview = await hz.caller({ userId }).idea.preview({ archetype: "dtc_physical" });
    expect(preview.departments.some((d) => d.moduleKeys.includes("development"))).toBe(true);
    expect(preview.agents.every((a) => a.wageLabel === "Estimate")).toBe(true);
    expect(preview.defaultChannels.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the business currency (0025)", () => {
  it("is the founder's at commit, stored on the business, read by every business amount, and changed in Settings by owners and admins", async () => {
    const userId = await hz.h.createUser("dollars@test.local");
    const caller = hz.caller({ userId, email: "dollars@test.local" });
    await caller.founder.profile.update({ displayName: "Dana", experience: "operator", currency: "USD", targetMarkets: ["US"], riskAppetite: "medium" });
    const generated = await caller.idea.generate({ prompt: "invoicing for contractors in the US" });
    // The Commit screen sends no currency here: the founder's profile currency is the business's.
    const result = await caller.idea.commit({ ideaId: generated.ideas[0]!.id, name: "Dollar Books", archetype: "b2b_saas", gameMode: "personal" });
    const bid = result.business.id;
    expect(result.business.currency).toBe("USD");
    expect((await caller.business.get({ businessId: bid })).business.currency).toBe("USD");
    const departments = await repos.departments.list(hz.db, bid);
    expect(new Set(departments.map((d) => d.currency))).toEqual(new Set(["USD"]));

    // No bank connected: cash reads in the business's currency (it used to fall back to EUR for every business).
    expect((await caller.finance.overview({ businessId: bid })).cash).toMatchObject({ amountMinor: 0, currency: "USD", accounts: 0 });
    expect(await caller.dashboard.customMetric.get({ businessId: bid, queryId: "cash" })).toMatchObject({ value: 0, currency: "USD" });

    // Settings › Business: an admin changes it (audited); a member cannot; a code must be three letters.
    const memberId = await hz.h.createUser("dollars-member@test.local");
    await repos.memberships.add(hz.db, bid, { userId: memberId, role: "member" });
    await expect(hz.caller({ userId: memberId }).business.update({ businessId: bid, currency: "EUR" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.business.update({ businessId: bid, currency: "E1R" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const updated = await caller.business.update({ businessId: bid, currency: "gbp" });
    expect(updated.currency).toBe("GBP");
    const audit = await repos.audit.list(hz.db, bid, { action: "business.update" });
    expect(audit.items[0]!.details).toMatchObject({ currency: { from: "USD", to: "GBP" } });

    // New business amounts follow it: a hire from Recruitment and a vacation without a budget ceiling.
    const dept = departments.find((d) => d.moduleKeys.includes("development")) ?? departments[0]!;
    const hired = await caller.team.agents.hire({ businessId: bid, templateKey: "backend_engineer", departmentId: dept.id, name: "Second Engineer" });
    expect(hired.currency).toBe("GBP");
    const vacation = await caller.business.startHoliday({ businessId: bid, until: { kind: "return" } });
    expect(vacation.holiday.currency).toBe("GBP");
    // Model spend stays in the pricing currency.
    expect(await caller.dashboard.customMetric.get({ businessId: bid, queryId: "spend_30d" })).toMatchObject({ currency: "USD" });
  });
});
