/**
 * idea.commit — "Take charge" (BUILD §11.1 Commit screen; AC-11.1.6, AC-11.1.7).
 *
 * In ONE service-role transaction: business + owner membership → idea stamped → departments from the archetype seed →
 * agents hired from templates (versions + baseline skills) → leads set → module screens → channels (all 15, starters
 * enabled) → spec outline blocks → first-cycle tasks → the founder's Home dashboard → the first Board decision in the
 * Inbox → `idea.committed` through the outbox → audit. After commit the first businessCycle is started on Temporal
 * (reported as `{ queued, reason }`; the business is complete without it).
 */
import { randomUUID } from "node:crypto";
import { getArchetypeSeed, getTemplate } from "@foundmill/agents";
import { repos, type Business, type Db, type DbTx, type InboxItem } from "@foundmill/db";
import { writeEventRow } from "./events";
import { CHANNEL_KEYS, CHANNEL_META, DEFAULT_BUSINESS_MODE, MODULE_TABS, slugify, type Archetype, type BusinessMode, type GameMode } from "@foundmill/shared";
import { PRESET_LAYOUTS } from "../presets";
import { checkLogoChoice, toLogoInput, type LogoChoice } from "./logo";
import { hireMany, type PlannedHire } from "./squad";
import type { TemporalService } from "./temporal";
import { WORKFLOWS, workflowIds } from "./temporal";

export interface CommitIdeaInput {
  ideaId: string;
  name: string;
  gameMode: GameMode;
  archetype: Archetype;
  businessMode?: BusinessMode;
  kit?: { primary: string; secondary: string };
  /** The chosen logo; checked before the transaction starts, stored inside it (service role, `business_logos`). */
  logo?: LogoChoice | null;
  currency?: string;
  spendCapMinor?: number | null;
}

export interface CommitIdeaResult {
  business: Business;
  departmentIds: string[];
  agentIds: string[];
  chiefOfStaffId: string;
  boardItem: InboxItem;
  taskIds: string[];
  cycle: { queued: boolean; workflowId: string; reason?: string };
}

function uniqueSlug(name: string): string {
  const base = slugify(name) || "club";
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function commitIdea(db: Db, temporal: TemporalService, userId: string, input: CommitIdeaInput): Promise<CommitIdeaResult> {
  const idea = await repos.ideas.get(db, userId, input.ideaId);
  const seed = getArchetypeSeed(input.archetype);
  const businessMode = input.businessMode ?? DEFAULT_BUSINESS_MODE;
  const currency = (input.currency ?? "EUR").toUpperCase();
  // A logo that does not pass the check fails the commit before anything is created.
  if (input.logo) checkLogoChoice(input.logo);

  const result = await db.transaction(async (tx: DbTx) => {
    const business = await repos.businesses.create(tx, {
      name: input.name,
      slug: uniqueSlug(input.name),
      gameMode: input.gameMode,
      businessMode,
      archetype: input.archetype,
      kitPrimary: input.kit?.primary,
      kitSecondary: input.kit?.secondary,
      createdBy: userId,
      glossary: {},
    });
    const businessId = business.id;
    await repos.memberships.add(tx, businessId, { userId, role: "owner" });
    const logo = input.logo ? (await repos.logos.set(tx, businessId, { source: input.logo.source, logo: toLogoInput(input.logo.dataUrl), createdBy: userId })).meta : null;
    await repos.businesses.commit(tx, businessId, { archetype: input.archetype });
    await repos.ideas.commit(tx, userId, input.ideaId, businessId);

    // Departments (slugs, module keys and template keys; names are defaults the founder renames).
    const departmentIdBySlug = new Map<string, string>();
    for (const d of seed.departments) {
      const dept = await repos.departments.create(tx, businessId, {
        name: d.name,
        slug: d.slug.replace(/_/g, "-"),
        icon: d.icon,
        colourToken: d.colourToken,
        position: d.position,
        moduleKeys: d.moduleKeys,
        budgetMinor: d.budgetMinor,
        currency,
      });
      departmentIdBySlug.set(d.slug, dept.id);
    }

    // Team: Chief of Staff first (line manager of every lead), then leads, then members and utilities. Planned in memory
    // (one agent per template; a template asked for again joins that department too), then hired in a few statements.
    const planned = new Map<string, PlannedHire>();
    const members: { departmentId: string; memberKind: "agent"; memberId: string }[] = [];
    const plan = (templateKey: string, departmentId: string | null, lineManagerId: string | null): string => {
      let p = planned.get(templateKey);
      if (!p) {
        p = { id: randomUUID(), templateKey, departmentIds: departmentId ? [departmentId] : [], lineManagerId };
        planned.set(templateKey, p);
      } else if (departmentId && !p.departmentIds.includes(departmentId)) p.departmentIds.push(departmentId);
      if (departmentId) members.push({ departmentId, memberKind: "agent", memberId: p.id });
      return p.id;
    };
    const chiefId = plan(seed.assistantTemplateKey, null, null);
    const leadByDepartment = new Map<string, string>();
    for (const d of seed.departments) {
      const departmentId = departmentIdBySlug.get(d.slug)!;
      const leadId = plan(d.leadTemplateKey, departmentId, chiefId);
      leadByDepartment.set(departmentId, leadId);
      for (const key of d.memberTemplateKeys) plan(key, departmentId, leadId);
    }
    // The Chief of Staff sits in the department whose module is "team" (if any), never looked up by name.
    const teamDept = seed.departments.find((d) => d.moduleKeys.includes("team"));
    if (teamDept) {
      const deptId = departmentIdBySlug.get(teamDept.slug)!;
      planned.get(seed.assistantTemplateKey)!.departmentIds = [deptId];
      members.push({ departmentId: deptId, memberKind: "agent", memberId: chiefId });
    }
    const hired = await hireMany(tx, businessId, [...planned.values()], { createdBy: userId, currency });
    const chief = hired[0]!;
    const agentIdByTemplate = new Map(hired.map((h) => [h.template.key, h.agent.id] as const));
    const agentIds = hired.map((h) => h.agent.id);
    await repos.departments.addMembers(tx, businessId, members);
    for (const [departmentId, leadId] of leadByDepartment) await repos.departments.setLead(tx, businessId, departmentId, leadId);

    // Module screens: one tab per module default (BUILD §6.3) rendered by the module's full-screen widget.
    const screens = seed.departments.flatMap((d) => {
      const departmentId = departmentIdBySlug.get(d.slug)!;
      let position = 0;
      return d.moduleKeys.flatMap((moduleKey) =>
        MODULE_TABS[moduleKey].map((tab) => ({
          departmentId,
          tabSlug: tab.slug,
          title: tab.title,
          position: position++,
          layout: { widgets: [{ key: `module:${moduleKey}/${tab.slug}`, x: 0, y: 0, w: 12, h: 60, settings: {} }] },
        })),
      );
    });
    await repos.screens.upsertMany(tx, businessId, screens);

    // Channels: all 15 exist; the archetype's starters are enabled and recommended (BUILD §11.7 formation).
    await repos.channels.upsertMany(
      tx,
      businessId,
      CHANNEL_KEYS.map((channelKey) => ({
        channelKey,
        line: CHANNEL_META[channelKey].line,
        enabled: seed.defaultChannels.includes(channelKey),
        recommended: seed.defaultChannels.includes(channelKey),
        kitMode: CHANNEL_META[channelKey].kitModeByDefault,
        ownerAgentId: agentIdByTemplate.get(`channel_${channelKey}`) ?? null,
        currency,
      })),
    );

    // Specification outline (BUILD §11.5 default outline by archetype).
    for (const [position, section] of seed.specOutline.entries()) {
      await repos.product.createBlock(tx, businessId, { section, position, authoredByKind: "system", content: { type: "doc", content: [] } });
    }

    // First-cycle tasks.
    const taskIds: string[] = [];
    for (const t of seed.firstCycleTasks) {
      const task = await repos.tasks.create(tx, businessId, {
        kind: t.kind,
        title: t.title,
        goalMd: t.goal,
        acceptance: t.acceptance,
        departmentId: departmentIdBySlug.get(t.departmentSlug) ?? null,
        assigneeAgentId: agentIdByTemplate.get(t.assigneeTemplateKey) ?? null,
        status: "ready",
        currency,
      });
      taskIds.push(task.id);
    }

    // Founder's Home dashboard.
    await repos.dashboards.create(tx, businessId, { userId, name: "Home", preset: "founder", layout: PRESET_LAYOUTS.founder, isActive: true });

    // The Board's first decision (vision + first decisions), from the Chief of Staff.
    const board = seed.boardDecision;
    const boardItem = await repos.inbox.createItem(tx, businessId, {
      type: "decision",
      from_agent_id: chief.agent.id,
      subject: board.subject,
      body_md: board.bodyMd,
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: { options: board.options.map((o) => ({ id: o.id, label: o.label, recommended: o.recommended, consequence: o.consequence, cost_minor: o.costMinor, reversible: o.reversible })), free_text: true, expires_at: null },
      blocks_continue: true,
      source_event_ids: [],
      entity_ids: [],
    });

    const departmentIds = [...departmentIdBySlug.values()];
    await writeEventRow(tx, {
      businessId,
      type: "idea.committed",
      actor: { kind: "user", id: userId },
      payload: {
        ideaId: idea.id,
        ideaVersionId: idea.current?.id ?? idea.id,
        businessName: business.name,
        archetype: input.archetype,
        gameMode: input.gameMode,
        businessMode,
        departmentIds,
        agentIds,
      },
    });
    await repos.audit.append(tx, businessId, {
      actorKind: "user",
      actorId: userId,
      action: "idea.commit",
      target: { kind: "business", id: businessId },
      details: { ideaId: idea.id, archetype: input.archetype, gameMode: input.gameMode, businessMode, departments: departmentIds.length, agents: agentIds.length, spendCapMinor: input.spendCapMinor ?? null, logo: logo ? { source: logo.source, mime: logo.mime, sha256: logo.sha256, bytes: logo.bytes } : null },
    });

    return { business: { ...business, committedAt: new Date(), archetype: input.archetype }, departmentIds, agentIds, chiefOfStaffId: chief.agent.id, boardItem, taskIds };
  });

  const cycle = await temporal.start(WORKFLOWS.businessCycle, { workflowId: workflowIds.cycle(result.business.id, 1), args: [{ businessId: result.business.id, cycleNumber: 1, trigger: "continue" }] });
  return { ...result, cycle };
}

/** Templates the archetype hires, for the Commit screen preview. */
export function squadPreview(archetype: Archetype) {
  const seed = getArchetypeSeed(archetype);
  const templates = new Set<string>([seed.assistantTemplateKey]);
  for (const d of seed.departments) for (const k of [d.leadTemplateKey, ...d.memberTemplateKeys]) templates.add(k);
  return {
    departments: seed.departments.map((d) => ({ slug: d.slug, name: d.name, icon: d.icon, colourToken: d.colourToken, moduleKeys: d.moduleKeys, budgetMinor: d.budgetMinor, budgetLabel: "Estimate" as const })),
    agents: [...templates].map((key) => {
      const t = getTemplate(key);
      return { templateKey: key, name: t.name, role: t.role, layer: t.layer, modelKey: t.modelKey, wageCapMinor: t.wageCapMinor, wageLabel: "Estimate" as const };
    }),
    defaultChannels: seed.defaultChannels,
    specOutline: seed.specOutline,
  };
}
