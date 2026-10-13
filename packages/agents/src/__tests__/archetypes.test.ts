import { describe, expect, it } from "vitest";
import { ARCHETYPES, CHANNEL_KEYS, MODULE_KEYS } from "@foundmill/shared";
import { ARCHETYPE_SEEDS, ARCHETYPE_SEED_LIST, DEPARTMENT_DEFAULTS, getArchetypeSeed, templateKeysForArchetype } from "../archetypes";
import { ArchetypeSeed } from "../types";
import { getTemplate, hasTemplate } from "../registry";

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

  it("every seed has the base outline, a spec task, a channel scoring task, a finance forecast and a legal scan", () => {
    for (const seed of ARCHETYPE_SEED_LIST) {
      for (const s of ["Problem", "Customers", "Value proposition", "Pricing", "Metrics", "Risks"]) expect(seed.specOutline, seed.archetype).toContain(s);
      const kinds = seed.firstCycleTasks.map((t) => t.kind);
      expect(kinds).toContain("research");
      expect(kinds).toContain("channel");
      expect(kinds).toContain("finance");
      expect(kinds).toContain("legal");
      expect(seed.firstCycleTasks.find((t) => t.kind === "finance")!.goal).toMatch(/Forecast/);
    }
  });

  it("the Board decision has 2-4 options with exactly one recommended and no option that moves money automatically", () => {
    for (const seed of ARCHETYPE_SEED_LIST) {
      const d = seed.boardDecision;
      expect(d.options.length).toBeGreaterThanOrEqual(2);
      expect(d.options.length).toBeLessThanOrEqual(4);
      expect(d.options.filter((o) => o.recommended).length).toBe(1);
      expect(d.bodyMd).toContain("The Board");
      expect(d.subject.length).toBeLessThanOrEqual(80);
      for (const o of d.options) {
        expect(o.consequence.length).toBeGreaterThan(10);
        expect(o.consequence).not.toMatch(/\bpay(s|ing)? (the )?(supplier|invoice)\b/i);
      }
      const recommended = d.options.find((o) => o.recommended)!;
      expect(recommended.reversible).toBe(true);
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
    expect(getArchetypeSeed("b2b_saas").firstCycleTasks.find((t) => t.kind === "channel")!.goal).toContain("Channel Board");
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
});
