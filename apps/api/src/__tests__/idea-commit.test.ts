import { getArchetypeSeed } from "@foundmill/agents";
import { includedCreditsMinor } from "@foundmill/config";
import { CREDITS_EXHAUSTED_SUBJECT, repos } from "@foundmill/db";
import { CHANNEL_KEYS } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BOARD_FIRST_DECISION_LINE } from "../services/commit";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
const temporal = fakeTemporalClient();
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "commit", temporalClient: temporal, env: { LIVE_MODE: "1" } });
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

    // The first cycle starts groundwork only: no channel or code task at commit (founder, 2026-10-18).
    const tasks = await repos.tasks.list(hz.db, bid, { limit: 100 });
    expect(tasks.items.map((t) => t.kind).sort()).toEqual(seed.firstCycleTasks.map((t) => t.kind).sort());
    expect(tasks.items.some((t) => t.kind === "channel" || t.kind === "code")).toBe(false);

    // The Chief of Staff's welcome note in the Inbox: an Update that blocks nothing; no Board decision yet (it comes with
    // Start distribution) and nothing asks the founder to decide before the foundations are drafted.
    const inbox = await caller.inbox.list({ businessId: bid, limit: 50 });
    expect(inbox.items.map((i) => ({ id: i.id, type: i.type, blocksContinue: i.blocksContinue }))).toEqual([{ id: result.firstItem.id, type: "update", blocksContinue: false }]);
    expect(result.firstItem.fromAgentId).toBe(result.chiefOfStaffId);
    expect(result.firstItem.subject).toBe("Your team is drafting the product foundations");
    // The founder meets the Chief of Staff and what is always theirs in the first note (UX plan §7.19, E5).
    expect(result.firstItem.bodyMd.startsWith("I'm your Chief of Staff. I run the team so you only read and decide. Some things are always yours: money, signatures, contracts, deleting things.")).toBe(true);
    expect(result.firstItem.bodyMd).toContain("Nothing is spent on distribution until you start it");
    expect(inbox.continueState).toEqual({ kind: "idle" });
    expect((await caller.business.get({ businessId: bid })).productStage).toBe("drafting");

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

    // The starter channels are on the board, but no engine starts and none is recorded until the founder starts
    // distribution (founder, 2026-10-18; audit GTM-01 still holds: the Board reads "Waiting for the product").
    const running = await repos.channels.list(hz.db, bid, { enabled: true });
    expect(running.map((c) => c.channelKey).sort()).toEqual([...seed.defaultChannels].sort());
    expect(temporal.starts.some((s) => s.type === "channelEngine" && s.workflowId.startsWith("engine:"))).toBe(false);
    for (const c of running) expect(c.engineWorkflowId).toBeNull();
    expect(result.engines).toEqual([]);
    expect(business.distributionStartedAt).toBeNull();

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
    expect(replay.firstItem.id).toBe(created.firstItem.id);
    expect(replay.chiefOfStaffId).toBe(created.chiefOfStaffId);
    expect(replay.taskIds).toEqual(created.taskIds);
    expect([...replay.departmentIds].sort()).toEqual([...created.departmentIds].sort());
    expect([...replay.agentIds].sort()).toEqual([...created.agentIds].sort());
    expect(replay.cycle.queued).toBe(false);

    // A retry after the fact answers the same way.
    const retry = await caller.idea.commit(input);
    expect(retry).toMatchObject({ alreadyCommitted: true, business: { id: created.business.id }, firstItem: { id: created.firstItem.id } });

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

  it("starts on the free tier with this month's included credits in US dollars, keeps the spend cap, and takes charge of a second business on the free plan: no business limit; the second starts with nothing included (one credit pool a month per founder, SEC2 S6)", async () => {
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

    // No business limit on any plan for now (founder, 2026-10-16): the second commit succeeds while the first is active.
    const again = await caller.idea.commit({ ideaId: second!.id, name: "Tier Two", archetype: "b2b_saas", gameMode: "personal" });
    expect(again.business).toMatchObject({ planTier: "free", spendCapMinor: null });
    expect((await repos.businesses.listForUser(hz.db, userId)).map((b) => b.id).sort()).toEqual([bid, again.business.id].sort());
    expect((await caller.founder.businesses.list()).businesses.map((b) => b.name)).toEqual(["Tier One", "Tier Two"]);
    // Never a second included credit in the same month (SEC2 S6): the new business starts with nothing included,
    // stopped like any team whose credits ran out, and the Inbox says why and what to do.
    expect(await repos.usage.creditBalance(hz.db, again.business.id, period)).toMatchObject({ grantedMinor: 0, balanceMinor: 0 });
    expect(await repos.businesses.stopState(hz.db, again.business.id)).toMatchObject({ stopped: true, reason: "credits_exhausted" });
    const warning = (await repos.inbox.list(hz.db, again.business.id, { limit: 50 })).items.find((i) => i.subject === CREDITS_EXHAUSTED_SUBJECT);
    expect(warning?.bodyMd).toMatch(/this month's already went to another business you took charge of\. Add your own Anthropic key in Settings → Keys/);
    expect((await caller.founder.businesses.allowance()).includedCredits).toMatchObject({ places: 1, taken: 1 });
    expect((await caller.billing.plan({ businessId: again.business.id })).includedCreditsMinor).toBe(0);
  });

  it("a commit that read the idea before another commit landed (READ COMMITTED) still builds nothing and answers with the first business", async () => {
    // PGlite runs one transaction at a time, so the race is replayed the way Postgres interleaves it: the second commit's
    // reads of the idea (before and inside its transaction) still see it uncommitted, as they did on the stack where a
    // double click built two businesses. Only a claim that does not trust an earlier read stops it.
    const userId = await hz.h.createUser("stale@test.local");
    const caller = hz.caller({ userId, email: "stale@test.local" });
    await caller.founder.profile.update({ displayName: "Stale", experience: "first-time", skills: { engineering: 10 }, targetMarkets: ["US"], riskAppetite: "low" });
    const idea = (await caller.idea.generate({ prompt: "rota planning for small kitchens" })).ideas[0]!;
    const input = { ideaId: idea.id, name: "Stale Rota", archetype: "b2b_saas" as const, gameMode: "personal" as const };
    const uncommitted = await repos.ideas.get(hz.db, userId, idea.id);
    const first = await caller.idea.commit(input);

    const get = repos.ideas.get;
    const staleReads = vi.spyOn(repos.ideas, "get").mockImplementationOnce(async () => uncommitted).mockImplementationOnce(async () => uncommitted);
    let second: Awaited<ReturnType<typeof caller.idea.commit>>;
    try {
      second = await caller.idea.commit({ ...input, name: "Stale Rota Again" });
    } finally {
      staleReads.mockRestore();
    }
    expect(repos.ideas.get).toBe(get);
    expect(second).toMatchObject({ alreadyCommitted: true, business: { id: first.business.id } });
    const mine = (await repos.businesses.listForUser(hz.db, userId)).filter((b) => b.name.startsWith("Stale Rota"));
    expect(mine.map((b) => b.id)).toEqual([first.business.id]);
    expect((await repos.ideas.get(hz.db, userId, idea.id)).businessId).toBe(first.business.id);
    expect(temporal.starts.filter((s) => s.type === "businessCycle" && s.workflowId === `cycle:${first.business.id}:1`)).toHaveLength(1);
  });

  it("starting LIVE needs the 18+ attestation (the network is for adults only); Personal asks for nothing (audit GLS2F-09)", async () => {
    const userId = await hz.h.createUser("adult@test.local");
    const caller = hz.caller({ userId, email: "adult@test.local" });
    await caller.founder.profile.update({ displayName: "Ana", experience: "first-time", skills: { sales: 10 }, targetMarkets: ["US"], riskAppetite: "low" });
    const [idea] = (await caller.idea.generate({ prompt: "bookkeeping for tattoo studios" })).ideas;
    await expect(caller.idea.commit({ ideaId: idea!.id, name: "Adult Co", archetype: "b2b_saas", gameMode: "live" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.idea.commit({ ideaId: idea!.id, name: "Adult Co", archetype: "b2b_saas", gameMode: "live", confirmAdult: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await repos.businesses.listForUser(hz.db, userId)).length).toBe(0);
    const result = await caller.idea.commit({ ideaId: idea!.id, name: "Adult Co", archetype: "b2b_saas", gameMode: "live", confirmAdult: true });
    expect(result.business.gameMode).toBe("live");
    // The attestation is on the audit chain next to the commit.
    expect((await repos.audit.list(hz.db, result.business.id, { action: "idea.commit", limit: 1 })).items[0]?.details).toMatchObject({ gameMode: "live", confirmedAdult: true });
  });

  it("preview lists what an archetype seeds, labelled Estimate", async () => {
    const userId = await hz.h.createUser("preview@test.local");
    const preview = await hz.caller({ userId }).idea.preview({ archetype: "dtc_physical" });
    expect(preview.departments.some((d) => d.moduleKeys.includes("development"))).toBe(true);
    expect(preview.agents.every((a) => a.wageLabel === "Estimate")).toBe(true);
    expect(preview.defaultChannels.length).toBeGreaterThanOrEqual(3);
  });

  it("preview names each agent's department as commit hires it, so the Day one list colors agents by department (audit AC-15)", async () => {
    const userId = await hz.h.createUser("preview-depts@test.local");
    const preview = await hz.caller({ userId }).idea.preview({ archetype: "hardware" });
    const seed = getArchetypeSeed("hardware");
    const bySlug = new Map(preview.agents.map((a) => [a.templateKey, a.departmentSlug]));
    for (const d of seed.departments) {
      for (const key of [d.leadTemplateKey, ...d.memberTemplateKeys]) {
        // The first department that leads with or staffs the template (the Chief of Staff aside).
        if (key === seed.assistantTemplateKey) continue;
        const first = seed.departments.find((x) => x.leadTemplateKey === key || x.memberTemplateKeys.includes(key))!;
        expect(bySlug.get(key)).toBe(first.slug);
      }
    }
    const team = seed.departments.find((d) => d.moduleKeys.includes("team"))!;
    expect(bySlug.get(seed.assistantTemplateKey)).toBe(team.slug);
    expect(preview.agents.every((a) => a.departmentSlug !== null)).toBe(true);
    // Product's lead and its researcher share Product's color; the list index plays no part.
    expect(bySlug.get("product_lead")).toBe("product");
    expect(bySlug.get("researcher")).toBe("product");
  });

  it("a Door A business starts with the concept card's citations as sources, labeled Estimate (audit FR-24)", async () => {
    const userId = await hz.h.createUser("commit-sources@test.local");
    const caller = hz.caller({ userId, email: "commit-sources@test.local" });
    await caller.founder.profile.update({ displayName: "Sam", experience: "operator", skills: {}, targetMarkets: ["US"], riskAppetite: "low" });
    const idea = await repos.ideas.create(hz.db, userId, {
      title: "Citewell",
      pitch: "Citations for clinics.",
      research: {
        citations: [
          { title: "Clinic survey 2026", url: "https://example.com/survey", note: "Two in three clinics still book by phone." },
          { title: "Pricing page", url: "https://example.com/pricing", note: "" },
          { title: "Same survey again", url: "https://example.com/survey", note: "duplicate" },
          { title: "Not a web page", url: "mailto:someone@example.com", note: "" },
          { kind: "foundmill:meta", crest_seed: "citewell" },
        ],
      },
    });
    const result = await caller.idea.commit({ ideaId: idea.id, name: "Citewell", archetype: "services", gameMode: "personal" });
    const sources = (await repos.product.listSources(hz.db, result.business.id)).items;
    expect(sources.map((s) => [s.kind, s.uri, s.title]).sort()).toEqual([
      ["doc", "https://example.com/pricing", "Pricing page"],
      ["doc", "https://example.com/survey", "Clinic survey 2026"],
    ]);
    const survey = sources.find((s) => s.uri === "https://example.com/survey")!;
    expect(survey.relevance).toMatchObject({ summary: "Two in three clinics still book by phone.", provenance: "Estimate", origin: { kind: "concept_card", ideaId: idea.id } });
  });

  it("the Board's item never promises that nothing is spent before the decision: the first cycle starts at commit (audit api-services-13)", async () => {
    expect(BOARD_FIRST_DECISION_LINE).toMatch(/started on the basics/);
    expect(BOARD_FIRST_DECISION_LINE).not.toMatch(/spends anything/);
    const archetypeCopy = JSON.stringify(getArchetypeSeed("b2b_saas"));
    expect(archetypeCopy).not.toMatch(/decision before spending/);
  });

  it("refuses a currency code Intl cannot format before anything is created (audit ARB-15)", async () => {
    const userId = await hz.h.createUser("currency@test.local");
    const caller = hz.caller({ userId, email: "currency@test.local" });
    await caller.founder.profile.update({ displayName: "Cur", experience: "first-time", skills: { engineering: 14 }, targetMarkets: ["EU"], riskAppetite: "medium" });
    const { ideas } = await caller.idea.generate({ prompt: "invoicing for freelancers" });
    const idea = ideas[0]!;
    const before = (await repos.memberships.listForUser(hz.db, userId)).length;
    for (const currency of ["1$x", "US", "usdx", "ZZZ"]) {
      await expect(caller.idea.commit({ ideaId: idea.id, name: "Curr Co", archetype: "b2b_saas", gameMode: "personal", currency }), currency).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect((await repos.memberships.listForUser(hz.db, userId)).length).toBe(before);
    // The idea was not consumed by the refused attempts: a valid lower-case code commits, stored upper-cased on every row.
    const { business } = await caller.idea.commit({ ideaId: idea.id, name: "Curr Co", archetype: "b2b_saas", gameMode: "personal", currency: "gbp" });
    const departments = await repos.departments.list(hz.db, business.id);
    expect(departments.length).toBeGreaterThan(0);
    expect(new Set(departments.map((d) => d.currency))).toEqual(new Set(["GBP"]));
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

    // New business amounts follow it: a vacation without a budget ceiling; a hire's wage cap caps metered model cost, so
    // it stays in US dollars (the pricing currency).
    const dept = departments.find((d) => d.moduleKeys.includes("development")) ?? departments[0]!;
    const hired = await caller.team.agents.hire({ businessId: bid, templateKey: "backend_engineer", departmentId: dept.id, name: "Second Engineer" });
    expect(hired.currency).toBe("USD");
    const vacation = await caller.business.startHoliday({ businessId: bid, until: { kind: "return" } });
    expect(vacation.holiday.currency).toBe("GBP");
    // Model spend stays in the pricing currency.
    expect(await caller.dashboard.customMetric.get({ businessId: bid, queryId: "spend_30d" })).toMatchObject({ currency: "USD" });
  });

  it("is not the column default: a pound founder gets pounds, and a currency chosen on the Commit screen wins over the profile's", async () => {
    const userId = await hz.h.createUser("pounds@test.local");
    const caller = hz.caller({ userId, email: "pounds@test.local" });
    await caller.founder.profile.update({ displayName: "Priya", experience: "operator", currency: "GBP", targetMarkets: ["UK"], riskAppetite: "medium" });
    const generated = await caller.idea.generate({ prompt: "payroll for small UK shops" });
    const fromProfile = await caller.idea.commit({ ideaId: generated.ideas[0]!.id, name: "Pound Books", archetype: "b2b_saas", gameMode: "personal" });
    expect(fromProfile.business.currency).toBe("GBP");
    expect((await caller.business.get({ businessId: fromProfile.business.id })).business.currency).toBe("GBP");
    expect((await caller.finance.overview({ businessId: fromProfile.business.id })).cash.currency).toBe("GBP");
    expect(new Set((await repos.departments.list(hz.db, fromProfile.business.id)).map((d) => d.currency))).toEqual(new Set(["GBP"]));

    // Another founder (the free plan holds one business each) picks the currency on the Commit screen.
    const otherId = await hz.h.createUser("kronor@test.local");
    const other = hz.caller({ userId: otherId, email: "kronor@test.local" });
    await other.founder.profile.update({ displayName: "Sven", experience: "operator", currency: "GBP", targetMarkets: ["SE"], riskAppetite: "medium" });
    const otherIdeas = await other.idea.generate({ prompt: "payroll for small Swedish shops" });
    const chosen = await other.idea.commit({ ideaId: otherIdeas.ideas[0]!.id, name: "Krona Books", archetype: "b2b_saas", gameMode: "personal", currency: "sek" });
    expect(chosen.business.currency).toBe("SEK");
    expect((await repos.businesses.get(hz.db, chosen.business.id)).currency).toBe("SEK");
  });
});
