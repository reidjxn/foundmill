import { describe, expect, it } from "vitest";
import { CHANNEL_KEYS } from "@foundmill/shared";
import { AgentTemplate, AgentVersionSpec, ROUTE_DEFAULT_MODEL } from "../types";
import { ALL_TEMPLATES, CHANNEL_TEMPLATES, LEAD_TEMPLATES, SPECIALIST_TEMPLATES, UTILITY_TEMPLATES, WORKER_TEMPLATES, chiefOfStaff } from "../templates";
import { CONNECTOR_KEYS, isConnectorKey } from "../connectors";
import { getChannelTemplate, getTemplate, getTemplateByAgentType, hasTemplate, initialVersionFromTemplate, listTemplates, TEMPLATE_KEYS, UnknownTemplateError } from "../registry";
import { SKILL_DEFINITIONS_BY_KEY } from "../skills/definitions";
import { JUDGEMENT_SKILL_KEYS, EXECUTION_SKILL_KEYS } from "../templates/_shared";
import { TRAIT_LABELS } from "../traits";

const EXPECTED_KEYS = [
  "chief_of_staff",
  "product_lead",
  "engineering_lead",
  "distribution_strategist",
  "finance_lead",
  "legal_lead",
  "operations_lead",
  "backend_engineer",
  "frontend_engineer",
  "data_engineer",
  "infra_engineer",
  "qa_engineer",
  "design_to_code",
  "docs_writer",
  "researcher",
  "product_researcher",
  "review_agent",
  "integration_agent",
  "planner",
  ...CHANNEL_KEYS.map((c) => `channel_${c}`),
  "sourcing_manufacturing",
  "formulation_chemist",
  "pharmacology_regulatory",
  "certification",
  "packaging_design",
  "quality",
  "logistics",
  "costing",
  "entity_linker",
  "classifier",
  "categoriser",
  "triage",
  "moderation",
];

describe("agent templates (BUILD §9.1, §9.2, §11.6, §11.7, §11.10)", () => {
  it("ships every template the assignment names, once", () => {
    const keys = ALL_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of EXPECTED_KEYS) expect(keys, k).toContain(k);
    expect(keys.length).toBe(EXPECTED_KEYS.length);
    expect(TEMPLATE_KEYS).toEqual(keys);
  });

  it.each(ALL_TEMPLATES.map((t) => [t.key, t] as const))("%s validates against the AgentTemplate spec", (_key, template) => {
    const parsed = AgentTemplate.safeParse(template);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
  });

  it("every template's initial version validates against AgentVersionSpec (BUILD §9.2)", () => {
    for (const t of ALL_TEMPLATES) {
      const v = initialVersionFromTemplate(t, "00000000-0000-4000-8000-000000000001");
      const parsed = AgentVersionSpec.safeParse(v);
      expect(parsed.success, `${t.key}: ${JSON.stringify(parsed.success ? null : parsed.error.issues)}`).toBe(true);
      expect(v.version).toBe(1);
    }
  });

  it("the Chief of Staff gives agents their skills itself, never the founder (Nov 6, 2026)", () => {
    expect(chiefOfStaff.tools.find((g) => g.connectorKey === "platform")?.tools).toContain("skills.manage");
    expect(chiefOfStaff.instructions.rules.some((r) => /assign_skill/.test(r) && /never the founder's/i.test(r))).toBe(true);
    // Only the Chief of Staff changes what other agents carry.
    for (const t of ALL_TEMPLATES) if (t.key !== "chief_of_staff") expect(t.tools.flatMap((g) => g.tools), t.key).not.toContain("skills.manage");
  });

  it("models follow §9.1: assistant and leads on Opus, workers/channels/specialists on Sonnet, utilities on Haiku", () => {
    expect(chiefOfStaff.modelKey).toBe("opus");
    for (const t of LEAD_TEMPLATES) expect(t.modelKey, t.key).toBe("opus");
    for (const t of [...Object.values(CHANNEL_TEMPLATES), ...SPECIALIST_TEMPLATES]) expect(t.modelKey, t.key).toBe("sonnet");
    for (const t of UTILITY_TEMPLATES) expect(t.modelKey, t.key).toBe("haiku");
    for (const t of WORKER_TEMPLATES) {
      // Planner and review agent are Opus by route (BUILD §11.6); every other worker is Sonnet.
      const expected = t.route === "planner" || t.route === "codeReview" ? "opus" : "sonnet";
      expect(t.modelKey, t.key).toBe(expected);
      expect(t.modelKey).toBe(ROUTE_DEFAULT_MODEL[t.route]);
    }
  });

  it("has one channel engine agent per CHANNEL_KEYS with the matching channelKey", () => {
    for (const c of CHANNEL_KEYS) {
      const t = getChannelTemplate(c);
      expect(t.channelKey).toBe(c);
      expect(t.family).toBe("channel");
      expect(t.module).toBe("distribution");
      expect(CHANNEL_TEMPLATES[c]).toBe(t);
    }
    expect(Object.keys(CHANNEL_TEMPLATES).length).toBe(15);
  });

  it("offline-tracking channels (print, broadcast) never carry a booking tool and say so", () => {
    for (const c of ["print", "broadcast"] as const) {
      const t = getChannelTemplate(c);
      expect(t.description).toMatch(/offline tracking/i);
      const toolNames = t.tools.flatMap((g) => g.tools.map((x) => `${g.connectorKey}.${x}`));
      expect(toolNames.some((n) => /book|insertion_order|purchase/.test(n))).toBe(false);
    }
  });

  it("never names a department by its default display name: departments are labels the founder renames (AC-11.13.1)", () => {
    // A renamed Development ("Formulation Lab") or Content/media's "Editorial" must not leave "I run the Development
    // department" in the profile and in every system prompt; templates speak of the function ("engineering").
    const DEPT = "(?:Development|Distribution|Product|Finance|Legal|Operations|Team)";
    const patterns = [
      /\bDevelopment\b/,
      new RegExp(`\\b${DEPT} (?:department|flow|merge flow|›)`),
      new RegExp(`\\b(?:notify|brief|with|so) ${DEPT}\\b(?! schema)`),
    ];
    for (const t of ALL_TEMPLATES) {
      const text = [t.description, JSON.stringify(t.instructions)].join("\n");
      for (const re of patterns) expect(text, `${t.key}: ${re}`).not.toMatch(re);
    }
  });

  it("only grants tools on known connector keys (BUILD §13.2)", () => {
    for (const t of ALL_TEMPLATES) {
      for (const g of t.tools) {
        expect(isConnectorKey(g.connectorKey), `${t.key} → ${g.connectorKey}`).toBe(true);
        expect(g.tools.length).toBeGreaterThan(0);
      }
    }
    expect(CONNECTOR_KEYS).toContain("platform");
  });

  it("utilities have no outbound tools and never spend", () => {
    for (const t of UTILITY_TEMPLATES) {
      expect(t.autonomy.spendCapMinor).toBe(0);
      expect(t.tools.every((g) => g.connectorKey === "platform")).toBe(true);
      expect(t.tools.flatMap((g) => g.tools).some((n) => /send|post|publish|pay|create_campaign/.test(n))).toBe(false);
    }
  });

  it("no template grants a money-moving, signing or security tool (BUILD §2.2)", () => {
    const forbidden = /(payouts?\.(create|send)|transfers?\.create|payments?\.(create|send|initiate)|sign\.(send|execute)|signatures?\.create|security\.|terms\.accept|oauth\.grant|\.delete_permanently)/;
    for (const t of ALL_TEMPLATES) {
      for (const g of t.tools) for (const name of g.tools) expect(name, `${t.key} grants ${g.connectorKey}.${name}`).not.toMatch(forbidden);
    }
  });

  it("every template carries the ten judgement + execution skills and at least one craft skill that exists", () => {
    for (const t of ALL_TEMPLATES) {
      for (const k of [...JUDGEMENT_SKILL_KEYS, ...EXECUTION_SKILL_KEYS]) expect(t.skills, `${t.key} missing ${k}`).toContain(k);
      const craft = t.skills.filter((k) => SKILL_DEFINITIONS_BY_KEY[k]?.group === "craft");
      expect(craft.length, `${t.key} has no craft skill`).toBeGreaterThan(0);
      for (const k of t.skills) expect(SKILL_DEFINITIONS_BY_KEY[k], `${t.key} references unknown skill ${k}`).toBeDefined();
      expect(new Set(t.skills).size).toBe(t.skills.length);
    }
  });

  it("instructions are structured per §9.2 and the description reads as 'What I do' with a never-does list", () => {
    for (const t of ALL_TEMPLATES) {
      expect(t.instructions.goals.length).toBeGreaterThanOrEqual(2);
      expect(t.instructions.rules.length).toBeGreaterThanOrEqual(3);
      expect(t.instructions.playbook.length).toBeGreaterThanOrEqual(3);
      expect(t.instructions.examples.length).toBeGreaterThanOrEqual(1);
      expect(t.description).toMatch(/never does/i);
      expect(t.neverDoes.length).toBeGreaterThan(0);
    }
  });

  it("instructions never restate or weaken the house rules (they are prepended by the runtime)", () => {
    for (const t of ALL_TEMPLATES) {
      const text = JSON.stringify(t.instructions);
      expect(text).not.toMatch(/Fixed rules that override any other instruction/);
      expect(text).not.toMatch(/ignore (the )?(club|house) rules/i);
    }
  });

  it("traits are derived labels from the catalogue, 1-8 per template", () => {
    for (const t of ALL_TEMPLATES) {
      expect(t.traits.length).toBeGreaterThanOrEqual(1);
      expect(t.traits.length).toBeLessThanOrEqual(8);
      for (const tr of t.traits) expect([...TRAIT_LABELS, "Follows the playbook"], `${t.key}: ${tr}`).toContain(tr);
    }
    expect(ALL_TEMPLATES.filter((t) => t.traits.includes("Follows the playbook")).length).toBe(0);
  });

  it("sourcing carries a negotiation panel (disabled until the founder sets limits) and the negotiation skill", () => {
    const sourcing = getTemplate("sourcing_manufacturing");
    expect(sourcing.negotiation).toBeDefined();
    expect(sourcing.negotiation!.enabled).toBe(false);
    expect(sourcing.negotiation!.topics.length).toBeGreaterThan(0);
    expect(sourcing.skills).toContain("negotiation");
    for (const t of ALL_TEMPLATES) {
      if (t.negotiation) expect(t.skills, t.key).toContain("negotiation");
      // No template ships with negotiation enabled: walk-away and price limits are the founder's to set (BUILD §11.10 autonomy panel).
      expect(t.negotiation?.enabled ?? false, t.key).toBe(false);
    }
  });

  it("registry lookups work by key, agent type, family, module, channel and task kind", () => {
    expect(getTemplate("chief_of_staff").family).toBe("assistant");
    expect(() => getTemplate("nope")).toThrow(UnknownTemplateError);
    expect(hasTemplate("planner")).toBe(true);
    expect(hasTemplate("goalkeeper")).toBe(false);
    expect(getTemplateByAgentType("channel_seo")?.key).toBe("channel_seo");
    expect(listTemplates({ family: "lead" }).map((t) => t.key)).toEqual(LEAD_TEMPLATES.map((t) => t.key));
    expect(listTemplates({ module: null }).map((t) => t.key)).toContain("chief_of_staff");
    expect(listTemplates({ channelKey: "pr" }).map((t) => t.key)).toEqual(["channel_pr"]);
    expect(listTemplates({ taskKind: "code" }).map((t) => t.key)).toContain("backend_engineer");
    expect(listTemplates({ taskKind: "specialist", family: "specialist" }).length).toBe(SPECIALIST_TEMPLATES.length);
    expect(listTemplates({ taskKind: "specialist" }).map((t) => t.key)).toContain("operations_lead");
  });

  // Goals and playbook render on the profile ("What I do"), so they name what the founder can act on, not plumbing.
  it("the Chief of Staff and Distribution strategist profiles carry no plumbing words", () => {
    const PLUMBING = /\bstarters?\b|\bengine workflows?\b|channel engines|rate limits?|pending events|through tools|\bbranch(es)?\b/i;
    for (const key of ["chief_of_staff", "distribution_strategist"]) {
      const t = getTemplate(key);
      for (const text of [t.description, ...t.instructions.goals, ...t.instructions.playbook]) expect(text, `${key}: ${text}`).not.toMatch(PLUMBING);
    }
  });
});
