/**
 * Departments, squad and module screens for a demo business, built exactly as `idea.commit` does it (apps/api
 * services/commit.ts + services/squad.ts): departments from the archetype seed (names optionally renamed, slugs
 * stable), agents hired from `@foundmill/agents` templates with a live version 1 and baseline skills, leads set,
 * one screen_definition per module tab rendered by `module:<moduleKey>/<tabSlug>`.
 */
import { getSkillDefinition, getTemplate, type AgentTemplate, type ArchetypeSeed } from "@foundmill/agents";
import { MODULE_TABS, type AgentStatus } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { repos } from "../repos";
import { agents as agentsTable, type Agent, type Department } from "../schema";
import type { SeedCtx } from "./context";

export interface SeededAgent {
  agent: Agent;
  template: AgentTemplate;
  /** Live version 1 id. */
  versionId: string | null;
}

export interface SquadResult {
  departments: Department[];
  departmentBySlug: Map<string, Department>;
  agents: SeededAgent[];
  byTemplate: Map<string, SeededAgent>;
  chief: SeededAgent;
}

export interface SeedSquadOptions {
  currency: string;
  /** Display-name overrides by department slug (the founder renamed them; AC-11.13.1). */
  renames?: Record<string, string>;
  /** Agents to hire in addition to the archetype's squad: template key → department slug. */
  extraMembers?: Array<{ templateKey: string; departmentSlug: string }>;
}

async function hireFromTemplate(ctx: SeedCtx, businessId: string, templateKey: string, opts: { departmentIds?: string[]; lineManagerId?: string | null; currency: string }): Promise<SeededAgent> {
  const template = getTemplate(templateKey);
  const agent = await repos.agents.create(ctx.db, businessId, {
    name: template.name,
    role: template.role,
    agentType: template.agentType,
    layer: template.layer,
    descriptionMd: template.description,
    departmentIds: opts.departmentIds ?? [],
    lineManagerId: opts.lineManagerId ?? null,
    modelKey: template.modelKey,
    status: "idle",
    autonomy: template.autonomy,
    negotiation: template.negotiation ?? {},
    schedule: template.schedule ?? {},
    wageCapMinor: template.wageCapMinor,
    currency: opts.currency,
    avatarSeed: `${businessId}:${template.key}`,
    initialVersion: { instructions: template.instructions, tools: template.tools, modelKey: template.modelKey, createdByKind: "system", createdBy: ctx.owner.userId },
  });
  await repos.skills.upsertForAgent(
    ctx.db,
    businessId,
    agent.id,
    template.skills.map((skillKey) => ({
      skillKey,
      group: getSkillDefinition(skillKey)?.group ?? "craft",
      tested: template.baselineRating,
      proven: null,
      nLive: 0,
      displayed: template.baselineRating,
      potential: template.baselineRating,
    })),
  );
  return { agent, template, versionId: agent.currentVersion?.id ?? null };
}

export async function seedSquad(ctx: SeedCtx, businessId: string, seed: ArchetypeSeed, opts: SeedSquadOptions): Promise<SquadResult> {
  const { db } = ctx;
  const departmentBySlug = new Map<string, Department>();
  const departments: Department[] = [];
  for (const d of seed.departments) {
    const dept = await repos.departments.create(db, businessId, {
      name: opts.renames?.[d.slug] ?? d.name,
      slug: d.slug.replace(/_/g, "-"),
      icon: d.icon,
      colourToken: d.colourToken,
      position: d.position,
      moduleKeys: d.moduleKeys,
      budgetMinor: d.budgetMinor,
      currency: opts.currency,
    });
    departmentBySlug.set(d.slug, dept);
    departments.push(dept);
  }

  const chief = await hireFromTemplate(ctx, businessId, seed.assistantTemplateKey, { currency: opts.currency });
  const byTemplate = new Map<string, SeededAgent>([[seed.assistantTemplateKey, chief]]);
  const hired: SeededAgent[] = [chief];

  const hire = async (templateKey: string, departmentId: string, lineManagerId: string | null): Promise<SeededAgent> => {
    const existing = byTemplate.get(templateKey);
    if (existing) {
      if (!existing.agent.departmentIds.includes(departmentId)) {
        existing.agent = await repos.agents.update(db, businessId, existing.agent.id, { departmentIds: [...existing.agent.departmentIds, departmentId] });
      }
      await repos.departments.addMember(db, businessId, departmentId, { memberKind: "agent", memberId: existing.agent.id });
      return existing;
    }
    const a = await hireFromTemplate(ctx, businessId, templateKey, { departmentIds: [departmentId], lineManagerId, currency: opts.currency });
    byTemplate.set(templateKey, a);
    hired.push(a);
    await repos.departments.addMember(db, businessId, departmentId, { memberKind: "agent", memberId: a.agent.id });
    return a;
  };

  for (const d of seed.departments) {
    const dept = departmentBySlug.get(d.slug)!;
    const lead = await hire(d.leadTemplateKey, dept.id, chief.agent.id);
    const updated = await repos.departments.setLead(db, businessId, dept.id, lead.agent.id);
    departmentBySlug.set(d.slug, updated);
    departments[departments.indexOf(dept)] = updated;
    for (const key of d.memberTemplateKeys) await hire(key, dept.id, lead.agent.id);
  }
  for (const extra of opts.extraMembers ?? []) {
    const dept = departmentBySlug.get(extra.departmentSlug);
    if (!dept) throw new Error(`seedSquad: unknown department slug ${extra.departmentSlug}`);
    await hire(extra.templateKey, dept.id, dept.leadAgentId ?? chief.agent.id);
  }

  const teamDept = seed.departments.find((d) => d.moduleKeys.includes("team"));
  if (teamDept) {
    const dept = departmentBySlug.get(teamDept.slug)!;
    chief.agent = await repos.agents.update(db, businessId, chief.agent.id, { departmentIds: [dept.id] });
    await repos.departments.addMember(db, businessId, dept.id, { memberKind: "agent", memberId: chief.agent.id });
  }

  // Module screens: one tab per module default (BUILD §6.3).
  for (const dept of departments) {
    let position = 0;
    for (const moduleKey of dept.moduleKeys) {
      for (const tab of MODULE_TABS[moduleKey as keyof typeof MODULE_TABS] ?? []) {
        await repos.screens.upsert(db, businessId, {
          departmentId: dept.id,
          tabSlug: tab.slug,
          title: tab.title,
          position: position++,
          layout: { widgets: [{ key: `module:${moduleKey}/${tab.slug}`, x: 0, y: 0, w: 12, h: 60, settings: {} }] },
        });
      }
    }
  }

  return { departments, departmentBySlug, agents: hired, byTemplate, chief };
}

/** Applies a status plan (template key → status); everyone else keeps the default from the plan's fallback. */
export async function applyAgentStatuses(ctx: SeedCtx, businessId: string, squad: SquadResult, plan: { byTemplate: Record<string, AgentStatus>; fallback: AgentStatus }): Promise<void> {
  for (const a of squad.agents) {
    const status = plan.byTemplate[a.template.key] ?? plan.fallback;
    a.agent = await repos.agents.setStatus(ctx.db, businessId, a.agent.id, status);
  }
}

/** Re-reads the agents (statuses, versions) after direct updates. */
export async function reloadAgents(ctx: SeedCtx, businessId: string, squad: SquadResult): Promise<void> {
  const rows = await ctx.db.select().from(agentsTable).where(eq(agentsTable.businessId, businessId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const a of squad.agents) {
    const row = byId.get(a.agent.id);
    if (row) a.agent = row;
  }
}

/** Agents whose first department is `departmentId` (the matview attributes a session to `department_ids[1]`). */
export function agentsInDepartment(squad: SquadResult, departmentId: string): SeededAgent[] {
  return squad.agents.filter((a) => a.agent.departmentIds[0] === departmentId);
}
