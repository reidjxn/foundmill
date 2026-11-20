import { describe, expect, it } from "vitest";
import { ARCHETYPES, BACKGROUND_HELPER_AGENT_TYPES, CHANNEL_KEYS, MODULE_KEYS, MODULE_TABS } from "@foundmill/shared";
import { ARCHETYPE_SEEDS, ARCHETYPE_SEED_LIST, CHANNEL_SCORING_TASK, DEPARTMENT_DEFAULTS, STARTING_TEAM_TEMPLATE_KEYS, UTILITY_TEMPLATE_KEYS, departmentTabs, firstCycleTasksFor, getArchetypeSeed, startingTeam, templateKeysForArchetype } from "../archetypes";
import { ArchetypeSeed } from "../types";
import { getTemplate, hasTemplate } from "../registry";

describe("background helpers (One name everywhere, Nov 8, 2026)", () => {
  it("the display rule's helper list is the utility templates, each on the utility layer; the Planner is not one", () => {
    expect([...BACKGROUND_HELPER_AGENT_TYPES].sort()).toEqual([...UTILITY_TEMPLATE_KEYS].sort());
    for (const key of UTILITY_TEMPLATE_KEYS) expect(getTemplate(key).layer, key).toBe("utility");
    expect(BACKGROUND_HELPER_AGENT_TYPES).not.toContain("planner");
  });
});

describe("archetype seeds (BUILD §11.1, AC-11.1.6)", () => {
  it("covers all seven archetypes and validates", () => {
    expect(Object.keys(ARCHETYPE_SEEDS).sort()).toEqual([...ARCHETYPES].sort());
    expect(ARCHETYPE_SEED_LIST.length).toBe(7);
    for (const seed of ARCHETYPE_SEED_LIST) {
      const parsed = ArchetypeSeed.safeParse(seed);
      expect(parsed.success, `${seed.archetype}: ${JSON.stringify(parsed.success ? null : parsed.error.issues)}`).toBe(true);
    }
  });

  it.each(ARCHETYPES)("%s: departments cover every module 1:1, ordered, with distinct slugs and colours", (archetype) => {
    const seed = getArchetypeSeed(archetype);
    const slugs = seed.departments.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(seed.departments.map((d) => d.position)).toEqual(seed.departments.map((_, i) => i));
    const covered = new Set(seed.departments.flatMap((d) => d.moduleKeys));
    for (const m of MODULE_KEYS) expect(covered.has(m), `${archetype} lacks module ${m}`).toBe(true);
    const colours = seed.departments.map((d) => d.colourToken);
    expect(new Set(colours).size).toBe(colours.length);
    for (const d of seed.departments) {
      expect(d.icon).toMatch(/^[a-z0-9-]+$/);
      expect(d.budgetMinor).toBeGreaterThan(0);
    }
  });

  it.each(ARCHETYPES)("%s: every lead, member and assignee template exists and leads are leads", (archetype) => {
    const seed = getArchetypeSeed(archetype);
    expect(getTemplate(seed.assistantTemplateKey).family).toBe("assistant");
    for (const d of seed.departments) {
      const lead = getTemplate(d.leadTemplateKey);
      expect(["lead", "assistant"], `${archetype}/${d.slug} lead ${lead.key}`).toContain(lead.family);
      for (const m of d.memberTemplateKeys) {
        expect(hasTemplate(m), `${archetype}/${d.slug} member ${m}`).toBe(true);
        expect(getTemplate(m).family).not.toBe("lead");
      }
      expect(new Set(d.memberTemplateKeys).size).toBe(d.memberTemplateKeys.length);
    }
    for (const t of seed.firstCycleTasks) {
      expect(hasTemplate(t.assigneeTemplateKey), `${archetype} task ${t.title}`).toBe(true);
      expect(seed.departments.some((d) => d.slug === t.departmentSlug), `${archetype} task ${t.title} department`).toBe(true);
      const assignee = getTemplate(t.assigneeTemplateKey);
      expect(assignee.taskKinds, `${archetype}: ${assignee.key} cannot take ${t.kind}`).toContain(t.kind);
    }
  });

  it.each(ARCHETYPES)("%s: default channels are 3-6 real channel keys whose engine agents are hired", (archetype) => {
    const seed = getArchetypeSeed(archetype);
    expect(seed.defaultChannels.length).toBeGreaterThanOrEqual(3);
    expect(seed.defaultChannels.length).toBeLessThanOrEqual(6);
    const hired = new Set(templateKeysForArchetype(archetype));
    for (const c of seed.defaultChannels) {
      expect(CHANNEL_KEYS).toContain(c);
      expect(hired.has(`channel_${c}`), `${archetype} enables ${c} without hiring its engine`).toBe(true);
    }
  });

  it("physical archetypes add the physical outline sections and an Operations department with specialists", () => {
    for (const a of ["dtc_physical", "hardware"] as const) {
      const seed = getArchetypeSeed(a);
      for (const s of ["Formulation / BOM", "Manufacturing", "Packaging", "Compliance", "Fulfillment"]) expect(seed.specOutline).toContain(s);
      const ops = seed.departments.find((d) => d.slug === "operations");
      expect(ops).toBeDefined();
      expect(ops!.leadTemplateKey).toBe("operations_lead");
      expect(ops!.memberTemplateKeys).toContain("sourcing_manufacturing");
      expect(seed.firstCycleTasks.some((t) => t.kind === "specialist")).toBe(true);
    }
    for (const a of ["b2b_saas", "consumer_app", "marketplace", "services", "content_media"] as const) {
      const seed = getArchetypeSeed(a);
      expect(seed.departments.some((d) => d.slug === "operations")).toBe(false);
      expect(seed.specOutline).not.toContain("Manufacturing");
    }
  });

  it("Operations shows the development module's Specialists and Plan, never a second copy of Development (DB-11)", () => {
    for (const a of ["dtc_physical", "hardware"] as const) {
      const seed = getArchetypeSeed(a);
      const ops = seed.departments.find((d) => d.slug === "operations")!;
      expect(departmentTabs(ops)).toEqual([
        { moduleKey: "development", slug: "specialists", title: "Specialists" },
        { moduleKey: "development", slug: "plan", title: "Plan" },
      ]);
      const dev = seed.departments.find((d) => d.slug === "development")!;
      expect(departmentTabs(dev).map((t) => t.slug)).toEqual(MODULE_TABS.development.map((t) => t.slug));
    }
    // Every other department shows all of its modules' tabs; an unknown slug in a subset is skipped.
    for (const seed of ARCHETYPE_SEED_LIST) for (const d of seed.departments.filter((x) => x.slug !== "operations")) expect(departmentTabs(d)).toHaveLength(d.moduleKeys.reduce((n, k) => n + MODULE_TABS[k].length, 0));
    expect(departmentTabs({ moduleKeys: ["development"], tabSlugs: ["plan", "nope"] }).map((t) => t.slug)).toEqual(["plan"]);
  });

  it("every seed has the base outline; the first round of work starts groundwork only (open questions, finance, legal), never a channel or code task (founder, 2026-10-18)", () => {
    for (const seed of ARCHETYPE_SEED_LIST) {
      for (const s of ["Problem", "Customers", "Value proposition", "Pricing", "Metrics", "Risks"]) expect(seed.specOutline, seed.archetype).toContain(s);
      const kinds = seed.firstCycleTasks.map((t) => t.kind);
      expect(kinds).toContain("research");
      expect(kinds).toContain("finance");
      expect(kinds).toContain("legal");
      // Distribution waits for a product to show; the Planner's first build waits for the founder's sign-off.
      expect(kinds, seed.archetype).not.toContain("channel");
      expect(kinds, seed.archetype).not.toContain("code");
      expect(seed.firstCycleTasks[0]!.title).toBe("Answer the specification's open questions");
      expect(seed.firstCycleTasks.find((t) => t.kind === "finance")!.goal).toMatch(/Forecast/);
      expect(seed.firstBuild.goal.length).toBeGreaterThan(20);
      expect(seed.firstBuild.acceptance.length).toBeGreaterThan(0);
    }
    // The channel-scoring task is created when the founder starts distribution; it names the Channel Board.
    expect(CHANNEL_SCORING_TASK.kind).toBe("channel");
    expect(CHANNEL_SCORING_TASK.goal).toContain("Channel Board");
    for (const seed of ARCHETYPE_SEED_LIST) expect(getTemplate(CHANNEL_SCORING_TASK.assigneeTemplateKey).taskKinds, seed.archetype).toContain("channel");
  });

  it("the Board decision has 2-4 options with exactly one recommended and no option that moves money automatically", () => {
    for (const seed of ARCHETYPE_SEED_LIST) {
      const d = seed.boardDecision;
      expect(d.options.length).toBeGreaterThanOrEqual(2);
      expect(d.options.length).toBeLessThanOrEqual(4);
      expect(d.options.filter((o) => o.recommended).length).toBe(1);
      expect(d.bodyMd).toMatch(/\bI need\b/);
      expect(d.subject.length).toBeLessThanOrEqual(80);
      for (const o of d.options) {
        expect(o.consequence.length).toBeGreaterThan(10);
        expect(o.consequence).not.toMatch(/\bpay(s|ing)? (the )?(supplier|invoice)\b/i);
      }
      const recommended = d.options.find((o) => o.recommended)!;
      expect(recommended.reversible).toBe(true);
      // The recommended option says why, in one plain sentence from the founder's seat (UX plan §7.19 "because").
      expect(recommended.because, seed.archetype).toMatch(/^Recommended because .+\.$/);
      expect(recommended.because!.length).toBeLessThanOrEqual(400);
      for (const o of d.options) if (!o.recommended) expect(o.because, `${seed.archetype}/${o.id}`).toBeUndefined();
    }
    // The shape refuses a recommended option without its reason.
    const seed = ARCHETYPE_SEED_LIST[0]!;
    const stripped = { ...seed, boardDecision: { ...seed.boardDecision, options: seed.boardDecision.options.map((o) => (o.recommended ? { ...o, because: undefined } : o)) } };
    expect(ArchetypeSeed.safeParse(stripped).success).toBe(false);
  });

  it("every Board option runs typed actions its own team can carry out, and budgets exactly what it costs (audit IAE-20, AC-01, FR-10)", () => {
    for (const seed of ARCHETYPE_SEED_LIST) {
      const hired = new Set(templateKeysForArchetype(seed.archetype));
      for (const o of seed.boardDecision.options) {
        const where = `${seed.archetype}/${o.id}`;
        expect(o.actions.length, where).toBeGreaterThan(0);
        // Never a hard gate dressed as work, never a payment, never a hire nobody asked for.
        for (const a of o.actions) expect(["create_task", "enable_channel", "disable_channel", "set_budget", "approve_spend"], where).toContain(a.type);
        for (const a of o.actions) {
          if (a.assignee) expect(hired.has(a.assignee), `${where}: ${a.assignee} is not hired by ${seed.archetype}`).toBe(true);
          const channel = a.params.channel;
          if (typeof channel === "string") expect(hired.has(`channel_${channel}`), `${where}: nobody runs ${channel}`).toBe(true);
          if (a.type === "create_task") expect(typeof a.params.title === "string" && typeof a.params.goal === "string", where).toBe(true);
        }
        const spend = o.actions.filter((a) => a.type === "set_budget" || a.type === "approve_spend").reduce((n, a) => n + Number(a.params.amount_minor), 0);
        expect(spend, where).toBe(o.costMinor);
        // A channel is budgeted only once it runs (or already runs as a starter).
        for (const a of o.actions.filter((x) => x.type === "set_budget")) {
          const channel = a.params.channel as (typeof CHANNEL_KEYS)[number];
          expect(o.actions.some((x) => x.type === "enable_channel" && x.params.channel === channel) || seed.defaultChannels.includes(channel), where).toBe(true);
        }
      }
    }
  });

  it("first-cycle tasks and the Board decision use the product's words, not football (CLAUDE.md 2026-10-08)", () => {
    // Task goals become tasks.goal_md (Live sessions goal line, the agent's task prompt); the Board body is an Inbox item.
    const FOOTBALL = /\b(?:formations?|squads?|clubs?|bench|captains?|match[\s-]?days?|kick[\s-]?offs?|pitch|troph(?:y|ies)|seasons?|injured)\b/i;
    for (const seed of ARCHETYPE_SEED_LIST) {
      for (const t of seed.firstCycleTasks) {
        for (const text of [t.title, t.goal, ...t.acceptance]) expect(text, `${seed.archetype}/${t.kind}`).not.toMatch(FOOTBALL);
      }
      const d = seed.boardDecision;
      for (const text of [d.subject, d.bodyMd, ...d.options.flatMap((o) => [o.label, o.consequence])]) expect(text, seed.archetype).not.toMatch(FOOTBALL);
    }
    for (const text of [CHANNEL_SCORING_TASK.title, CHANNEL_SCORING_TASK.goal, ...CHANNEL_SCORING_TASK.acceptance]) expect(text).not.toMatch(FOOTBALL);
    for (const seed of ARCHETYPE_SEED_LIST) for (const text of [seed.firstBuild.title, seed.firstBuild.goal, ...seed.firstBuild.acceptance]) expect(text, seed.archetype).not.toMatch(FOOTBALL);
  });

  it("task titles and option labels the founder sees carry no jargon; the technical detail stays in the goals (UX plan §7.19, §8.2)", () => {
    // The replace tier of the jargon table, as the Board's labels, the first build's title and the task titles reach the screen.
    const JARGON = /\b(?:ICP|CPA|CAC|COGS|RLS|Cedar|named query|exhibit|request_human_action|concurrency|time box|counterparty|webhook|OAuth|BYOK|unit economics|hunk|triage|hard gate|engine|pipeline|vertical slice)\b/;
    const titles: string[] = [CHANNEL_SCORING_TASK.title];
    const labels: string[] = [];
    for (const seed of ARCHETYPE_SEED_LIST) {
      titles.push(seed.firstBuild.title, ...seed.firstCycleTasks.map((t) => t.title));
      for (const o of seed.boardDecision.options) {
        labels.push(o.label, o.consequence);
        for (const a of o.actions) if (a.type === "create_task") titles.push(a.params.title as string);
      }
      labels.push(seed.boardDecision.subject, seed.boardDecision.bodyMd);
    }
    for (const text of [...titles, ...labels]) expect(text).not.toMatch(JARGON);
    // The plain titles the plan asks for, with the engineering detail kept where the engineer agent reads it.
    const b2b = ARCHETYPE_SEEDS.b2b_saas;
    expect(b2b.firstBuild.title).toBe("Plan the first build: signup, first value, payment");
    expect(b2b.firstBuild.goal).toContain("task graph");
    expect(b2b.boardDecision.options[0]!.label).toBe("Reach the one kind of customer we target first");
    expect(ARCHETYPE_SEEDS.consumer_app.boardDecision.options[0]!.label).toBe("Small paid test with a cost-per-customer limit");
    const outboundGoals = b2b.boardDecision.options[0]!.actions.filter((a) => a.type === "create_task").map((a) => a.params.goal as string);
    expect(outboundGoals.some((g) => /ideal customer profile/.test(g))).toBe(true);
  });

  it("templateKeysForArchetype starts with the Chief of Staff, hires the utilities and never repeats a key", () => {
    for (const a of ARCHETYPES) {
      const keys = templateKeysForArchetype(a);
      expect(keys[0]).toBe("chief_of_staff");
      expect(new Set(keys).size).toBe(keys.length);
      for (const u of ["entity_linker", "classifier", "categoriser", "triage", "moderation"]) expect(keys).toContain(u);
      expect(keys).toContain("distribution_strategist");
      expect(keys).toContain("finance_lead");
      expect(keys).toContain("legal_lead");
    }
  });

  it("department defaults route by module key, not by display name", () => {
    for (const m of MODULE_KEYS) {
      expect(DEPARTMENT_DEFAULTS[m].moduleKeys).toEqual([m]);
      expect(hasTemplate(DEPARTMENT_DEFAULTS[m].leadTemplateKey)).toBe(true);
    }
    // Renamed departments keep the same slug and module (AC-11.13.1).
    expect(getArchetypeSeed("content_media").departments[0]).toMatchObject({ slug: "product", name: "Editorial", moduleKeys: ["product"] });
  });

  // The first decision note comes from the Chief of Staff in the first person (voice guide §8.1 #7): there is no
  // board of directors, and the old "starters" label is gone from what the founder reads (UX plan §5 #11).
  it.each(ARCHETYPES)("%s: the first decision note is first person, with no 'The Board' and no 'starters'", (archetype) => {
    const { subject, bodyMd, options } = getArchetypeSeed(archetype).boardDecision;
    const text = [subject, bodyMd, ...options.flatMap((o) => [o.label, o.consequence ?? ""])].join("\n");
    expect(text).not.toMatch(/\bThe Board\b/);
    expect(text).not.toMatch(/\bstarters?\b/i);
    expect(bodyMd).toMatch(/\bI need\b/);
  });

  it("the channel-scoring task never says 'starters' in its title or acceptance", () => {
    for (const text of [CHANNEL_SCORING_TASK.title, ...CHANNEL_SCORING_TASK.acceptance]) expect(text).not.toMatch(/\bstarters?\b/i);
    expect(CHANNEL_SCORING_TASK.title).toBe("Score the 15 channels and pick 3 to 6 to start with");
  });
});

describe("firstCycleTasksFor (WP-04 T3; founder, 2026-11-16 D1)", () => {
  it("without a budget, seeds no finance or legal task: b2b_saas keeps only the open-questions task", () => {
    const seed = getArchetypeSeed("b2b_saas");
    expect(firstCycleTasksFor(seed, { hasBudget: false }).map((t) => t.kind)).toEqual(["research"]);
    expect(firstCycleTasksFor(seed, { hasBudget: false })[0]!.title).toBe("Answer the specification's open questions");
  });

  it("with a budget, returns the seed's own list", () => {
    const seed = getArchetypeSeed("b2b_saas");
    expect(firstCycleTasksFor(seed, { hasBudget: true })).toEqual(seed.firstCycleTasks);
    expect(seed.firstCycleTasks.map((t) => t.kind)).toEqual(["research", "finance", "legal"]);
  });

  it("drops only finance and legal, for every archetype", () => {
    for (const seed of ARCHETYPE_SEED_LIST) {
      const kept = firstCycleTasksFor(seed, { hasBudget: false });
      expect(kept, seed.archetype).toEqual(seed.firstCycleTasks.filter((t) => t.kind !== "finance" && t.kind !== "legal"));
      expect(kept.some((t) => t.title === "Answer the specification's open questions"), seed.archetype).toBe(true);
    }
  });
});

describe("startingTeam (WP-04 T4; founder decision 2: everyone is hired, three are shown)", () => {
  it("splits the b2b_saas team into the three starters, in the constant's order, and the 24 who join later", () => {
    const agents = templateKeysForArchetype("b2b_saas").map((templateKey) => ({ templateKey }));
    const { starting, later } = startingTeam(agents);
    expect(starting.map((a) => a.templateKey)).toEqual(["chief_of_staff", "product_lead", "researcher"]);
    expect(starting).toHaveLength(3);
    expect(later).toHaveLength(24);
    expect(later.some((a) => STARTING_TEAM_TEMPLATE_KEYS.includes(a.templateKey))).toBe(false);
  });

  it("every starting key is hired by every archetype seed", () => {
    for (const seed of ARCHETYPE_SEED_LIST) {
      const keys = templateKeysForArchetype(seed.archetype);
      for (const key of STARTING_TEAM_TEMPLATE_KEYS) expect(keys, `${seed.archetype} hires ${key}`).toContain(key);
    }
  });
});
