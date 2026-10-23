/**
 * idea.commit — "Take charge" (BUILD §11.1 Commit screen; AC-11.1.6, AC-11.1.7).
 *
 * In ONE service-role transaction: business + owner membership → idea stamped → departments from the archetype seed →
 * agents hired from templates (versions + baseline skills) → leads set → module screens → channels (all 15, starters
 * enabled, their engines waiting) → spec outline blocks → the foundations row (pending; Door B also links its Import
 * job: the report is snapshotted and the chosen sources become `sources`, not read yet) → the first cycle's groundwork
 * tasks → the founder's Home dashboard → the Chief of Staff's welcome note in the Inbox → `idea.committed` through the
 * outbox → audit. After commit the first businessCycle is started on Temporal, and for Door B the `importBusiness`
 * workflow that reads the sources through the gateway (both reported as `{ queued, reason }`; the business is complete
 * without them, and a source nothing will read is marked not read). The vision, specification content and roadmap are
 * drafted on the first open (services/foundations.ts), and the founder is asked to sign them off; the channel engines,
 * the channel-scoring task and the Board's question wait for the founder's Start distribution (founder, 2026-10-18;
 * services/signoff.ts).
 *
 * One business per idea: the transaction claims the idea (`ideas.claimForCommit`, one conditional statement) before
 * anything is created, so a double click, a second tab or a retried request never builds a second business; it
 * answers with the business the first commit created (`alreadyCommitted: true`), read back from that commit's audit row.
 *
 * Anthropomorphic agents (Launch step, 0067): when the founder chose on or off there, the choice is written to their
 * account preferences once the business exists. It is a display preference, so a failure to save it is logged and never
 * fails the commit (Settings › Preferences changes it any time).
 */
import { randomUUID } from "node:crypto";
import { departmentTabs, getArchetypeSeed, getTemplate, prompts } from "@foundmill/agents";
import { initialModelBilling } from "@foundmill/config";
import { assertBusinessAllowance, autopilotChangedPayload, creditsUsedUp, includedCreditsFor, periodOf, repos, type Business, type Db, type DbTx, type InboxItem } from "@foundmill/db";
import { writeEventRow } from "./events";
import { CHANNEL_KEYS, CHANNEL_META, CurrencyCode, DEFAULT_BUSINESS_CURRENCY, DEFAULT_BUSINESS_MODE, ValidationError, slugify, type Archetype, type BusinessMode, type GameMode, type OptionAction } from "@foundmill/shared";
import { presetLayout } from "../presets";
import { QUEUE_ACTION } from "./cycle";
import { checkLogoChoice, type LogoChoice } from "./logo";
import { hireMany, type PlannedHire } from "./squad";
import { startAutopilotWorkflow } from "./autopilot";
import type { ApiLogger } from "./log";
import type { TemporalService } from "./temporal";
import { WORKFLOWS, workflowIds, type TemporalResult } from "./temporal";
import { importJobIdOf, resolveImportLink, seedFoundations, type ImportLink, type ScoutingReportLike } from "./foundations";
import { queueImportReads } from "./import";
import { seedConceptSources } from "./concept-sources";

export interface CommitIdeaInput {
  ideaId: string;
  name: string;
  gameMode: GameMode;
  /** The 18+ attestation the router requires for LIVE; the audit row records it (BUILD §11.14). */
  confirmAdult?: boolean;
  archetype: Archetype;
  businessMode?: BusinessMode;
  kit?: { primary: string; secondary: string };
  /** The chosen logo; checked before the transaction starts, stored inside it (service role, `business_logos`). */
  logo?: LogoChoice | null;
  /** The business's currency (ISO 4217), chosen on the Commit screen; absent: the founder's profile currency. */
  currency?: string;
  spendCapMinor?: number | null;
  /** "Run on autopilot" (Commit): the business starts its own cycles (0055). Off unless chosen. */
  autopilot?: boolean;
  /** The Launch step's "Anthropomorphic agents" switch: written to the founder's account preferences when given (0067). */
  anthropomorphicAgents?: boolean;
}

export interface CommitIdeaResult {
  business: Business;
  departmentIds: string[];
  agentIds: string[];
  chiefOfStaffId: string;
  /** The Chief of Staff's welcome note: the team is drafting the foundations, two sign-off notes follow (non-blocking). */
  firstItem: InboxItem;
  taskIds: string[];
  cycle: { queued: boolean; workflowId: string; reason?: string };
  /** Door B: the `importBusiness` workflow reading the imported sources through the gateway (null for Door A). */
  import: { queued: boolean; workflowId: string; reason?: string } | null;
  /** Always empty since 2026-10-18: the starter channels' engines start with the founder's Start distribution. */
  engines: TemporalResult[];
  /** The Autopilot workflow start, when the founder chose to run on autopilot. */
  autopilot?: { queued: boolean; workflowId: string; reason?: string } | null;
  /** The vision, specification and roadmap wait for the first open (BUILD §11.1, §11.5). */
  foundations: { status: "pending"; door: "ideation" | "import"; importSourceIds: string[] };
  /** True when the idea was already a business (a second Take charge): nothing was created and no cycle started. */
  alreadyCommitted: boolean;
}

/** What the `idea.commit` audit row records beyond counts: enough to answer a second commit of the same idea. */
interface CommitReceipt {
  firstItemId?: string;
  /** Receipts written before 2026-10-18 named the Board's decision; read as the first item. */
  boardItemId?: string;
  chiefOfStaffId?: string;
  taskIds?: string[];
  door?: "ideation" | "import";
  importSourceIds?: string[];
}

const COMMIT_AUDIT_ACTION = "idea.commit";

/**
 * What the Board's item says about money. The first cycle starts the moment the founder takes charge, so the team has
 * already started on the basics (model calls included); the decision comes before any budget is committed.
 */
export const BOARD_FIRST_DECISION_LINE = "The team has started on the basics; the Board asks for one decision before committing any budget:";

/**
 * Door B's Board item: the Import report's suggested first decisions (the Import screen promises they arrive as a
 * Board item). Posted when the build starts (both sign-offs approved; services/signoff.ts `startBuilding`), from the
 * report snapshotted on the foundations row.
 */
/** The report the Board item is built from; a first decision may say why it is recommended (`because`, UX plan §7.19). */
export type ImportReportLike = ScoutingReportLike;

export function importBoardDecisionFromReport(name: string, report: ImportReportLike | null, sourceCount: number): { subject: string; bodyMd: string; options: { id: string; label: string; recommended: boolean; consequence: string; because?: string; costMinor: number; reversible: boolean; actions?: OptionAction[] }[] } | null {
  if (!report || report.firstDecisions.length < 2) return null;
  // Each option carries what choosing it runs, so the click never parses its words (audit IAE-20), and the report's
  // reason for recommending it ("because", UX plan §7.19) travels with it when the report wrote one.
  const options = report.firstDecisions.slice(0, 4).map((d) => ({ id: d.id.slice(0, 40), label: d.label.slice(0, 120), recommended: d.recommended, consequence: d.consequence, ...(d.because?.trim() ? { because: d.because.trim().slice(0, 400) } : {}), costMinor: 0, reversible: d.reversible, ...(d.actions?.length ? { actions: d.actions } : {}) }));
  if (options.filter((o) => o.recommended).length !== 1) options.forEach((o, i) => (o.recommended = i === 0));
  return {
    subject: "Where should the team start with what you imported?",
    bodyMd: [
      `**The Board** welcomes ${name}, imported from ${sourceCount} source${sourceCount === 1 ? "" : "s"}.`,
      "",
      report.summary,
      "",
      `The specification and the roadmap are signed off. ${BOARD_FIRST_DECISION_LINE} which of the import's first decisions comes first?`,
    ].join("\n"),
    options,
  };
}

/** The same decision from a live Import link (tests and the Import screen's preview). */
export function importBoardDecision(name: string, link: ImportLink): ReturnType<typeof importBoardDecisionFromReport> {
  return importBoardDecisionFromReport(name, link.report, link.status.job.sources.length);
}

/**
 * The Chief of Staff's welcome note at Take charge (non-blocking): who the Chief of Staff is and what is always the
 * founder's (the house rules' founder line, UX plan §7.19), the team is hired, the Product lead is drafting the
 * foundations, two sign-off notes follow, and nothing is spent on distribution until the founder starts it.
 */
export function welcomeNote(input: { agents: number; departments: number; productLeadName: string | null; door: "ideation" | "import" }): { subject: string; bodyMd: string } {
  const from = input.door === "import" ? "the Import report" : "your idea and your founder profile";
  const who = input.productLeadName ?? "The Product lead";
  return {
    subject: "Your team is drafting the product foundations",
    bodyMd: [
      prompts.HOUSE_RULES_FOUNDER_LINE,
      `The team is hired: ${input.agents} agents in ${input.departments} departments.`,
      `${who} is drafting the vision, the specification and the roadmap from ${from}; you will get two notes asking you to sign off each. Building starts when both are approved.`,
      "Nothing is spent on distribution until you start it from Distribution › Board.",
    ].join("\n\n"),
  };
}

function uniqueSlug(name: string): string {
  const base = slugify(name) || "business";
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * `importKey` returns the key import job ids are signed with (`importJobKey(env)`); it is only called for an idea that
 * Import drafted, so a Door A commit never needs it.
 */
export async function commitIdea(db: Db, temporal: TemporalService, userId: string, input: CommitIdeaInput, importKey: () => string, deps: { log?: Pick<ApiLogger, "warn"> } = {}): Promise<CommitIdeaResult> {
  const idea = await repos.ideas.get(db, userId, input.ideaId);
  if (idea.committedAt) return committedIdeaResult(db, userId, input.ideaId);
  // Door B: the Import job this idea was drafted from (recorded by idea.generate), verified again (signed for this
  // founder, finished, valid sources) and rebuilt before the transaction.
  const importJobId = importJobIdOf(idea.current?.research);
  const importLink = importJobId ? await resolveImportLink(db, importKey(), importJobId, userId) : null;
  const seed = getArchetypeSeed(input.archetype);
  const businessMode = input.businessMode ?? DEFAULT_BUSINESS_MODE;
  // The business keeps its money in the currency the founder chose (their profile's unless they changed it): stored on
  // the business itself (0025), which every business amount and every screen reads, and on the rows created here. Every
  // money field of the new business carries this code, so it is checked here too (callers other than idea.commit).
  const parsedCurrency = CurrencyCode.safeParse(input.currency ?? (await repos.founders.get(db, userId))?.currency ?? DEFAULT_BUSINESS_CURRENCY);
  if (!parsedCurrency.success) throw new ValidationError("Use a three-letter currency code, such as USD, GBP or EUR.", { currency: "Not a currency code" });
  const currency = parsedCurrency.data;
  // A logo that does not pass the check fails the commit before anything is created. Checked once: storage recognises
  // the result and does not run the sanitiser again.
  const checkedLogo = input.logo ? checkLogoChoice(input.logo) : null;

  const result = await db.transaction(async (tx: DbTx) => {
    // Claim the idea before anything is created. Of two concurrent commits only one gets past this line; the other has
    // waited for the winner's row lock, finds the idea committed and creates nothing (answered below).
    if (!(await repos.ideas.claimForCommit(tx, userId, input.ideaId))) return null;
    // Tier limits (BUILD §10.5): no business limit on any plan for now (founder, 2026-10-16); the check stays so one can
    // return (TierLimitError past it, which the Commit screen turns into an upgrade prompt). A new business starts on the
    // free tier; its included credits come from the founder's monthly pool (SEC2 S6, billing.ts `includedCreditsFor`).
    await assertBusinessAllowance(tx, userId);
    const planTier = "free" as const;
    const modelBilling = initialModelBilling(planTier);
    const business = await repos.businesses.create(tx, {
      name: input.name,
      slug: uniqueSlug(input.name),
      gameMode: input.gameMode,
      businessMode,
      archetype: input.archetype,
      kitPrimary: input.kit?.primary,
      kitSecondary: input.kit?.secondary,
      planTier,
      modelBilling,
      // The founder's "Spend cap per action": every agent asks above it, whatever the mode (the gateway applies it).
      spendCapMinor: input.spendCapMinor ?? null,
      createdBy: userId,
      glossary: {},
      currency,
    });
    const businessId = business.id;
    await repos.memberships.add(tx, businessId, { userId, role: "owner", source: "founder" });
    // "Run on autopilot": on from the first minute, audited like turning it on in Settings.
    if (input.autopilot) {
      const on = await repos.autopilot.set(tx, businessId, { enabled: true });
      await repos.audit.append(tx, businessId, { actorKind: "user", actorId: userId, action: "autopilot.turn_on", target: { kind: "business", id: businessId }, details: { enabled: true, cadence: on.business.autopilotCadence, maxCyclesPerDay: on.business.autopilotMaxCyclesPerDay, via: "commit" } });
      await writeEventRow(tx, { businessId, type: "autopilot.changed", actor: { kind: "user", id: userId }, payload: autopilotChangedPayload(on.business, "turned_on", null) });
    }
        // This month's included credits (USD), so the first cycle already runs against a balance that pauses the team. They
    // come from the founder's monthly pool (`includedCreditsFor`): once its places are taken this month (archived
    // businesses included), a new business starts with nothing included, never a second grant.
    const period = periodOf(new Date());
    const credits = modelBilling === "credits" ? (await repos.usage.ensurePeriodCredits(tx, businessId, period, await includedCreditsFor(tx, business, period, { lock: true }))).balance : null;
    const logo = input.logo && checkedLogo ? (await repos.logos.set(tx, businessId, { source: input.logo.source, logo: checkedLogo, createdBy: userId })).meta : null;
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
    const hired = await hireMany(tx, businessId, [...planned.values()], { createdBy: userId });
    const chief = hired[0]!;
    const agentIdByTemplate = new Map(hired.map((h) => [h.template.key, h.agent.id] as const));
    const agentIds = hired.map((h) => h.agent.id);
    await repos.departments.addMembers(tx, businessId, members);
    for (const [departmentId, leadId] of leadByDepartment) await repos.departments.setLead(tx, businessId, departmentId, leadId);

    // Module screens: one tab per module default (BUILD §6.3) rendered by the module's full-screen widget, or the
    // department's own subset (Operations: Specialists and Plan, not a copy of Development).
    const screens = seed.departments.flatMap((d) => {
      const departmentId = departmentIdBySlug.get(d.slug)!;
      return departmentTabs(d).map((tab, position) => ({
        departmentId,
        tabSlug: tab.slug,
        title: tab.title,
        position,
        layout: { widgets: [{ key: `module:${tab.moduleKey}/${tab.slug}`, x: 0, y: 0, w: 12, h: 60, settings: {} }] },
      }));
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

    // Foundations (vision, specification content, roadmap) wait for the first open; Door B links its Import job.
    const { sources: importSources } = await seedFoundations(tx, businessId, { ideaId: idea.id, link: importLink });
    // Door A: the card's citations become the business's first sources (Product › Sources, the Source Watcher).
    if (!importLink) await seedConceptSources(tx, businessId, { ideaId: idea.id, research: idea.current?.research });

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

    // Founder's Home dashboard: a department card for every department the archetype seeds (all visible).
    await repos.dashboards.create(tx, businessId, { userId, name: "Home", preset: "founder", layout: presetLayout("founder", { departments: seed.departments.length }), isActive: true });

    // The Chief of Staff's welcome note (founder, 2026-10-18): the product comes first. The Board's question waits for
    // Start distribution and Door B's import decisions for the build start (services/signoff.ts).
    const productDept = seed.departments.find((d) => d.moduleKeys.includes("product"));
    const productLeadId = productDept ? leadByDepartment.get(departmentIdBySlug.get(productDept.slug)!) : undefined;
    const welcome = welcomeNote({ agents: agentIds.length, departments: seed.departments.length, productLeadName: hired.find((h) => h.agent.id === productLeadId)?.agent.name ?? null, door: importLink ? "import" : "ideation" });
    const firstItem = await repos.inbox.createItem(tx, businessId, {
      type: "update",
      from_agent_id: chief.agent.id,
      subject: welcome.subject,
      body_md: welcome.bodyMd,
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: null,
      blocks_continue: false,
      source_event_ids: [],
      entity_ids: [],
    });

    // The founder's included credits for this month already went to another business they took charge of (SEC2 S6):
    // this one starts with nothing included, so it is stopped like any team whose credits ran out, and told why.
    if (credits && Number(credits.balanceMinor) <= 0) await creditsUsedUp(tx, business, period, credits);

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
      action: COMMIT_AUDIT_ACTION,
      target: { kind: "business", id: businessId },
      details: {
        ideaId: idea.id,
        archetype: input.archetype,
        gameMode: input.gameMode,
        ...(input.gameMode === "live" ? { confirmedAdult: true } : {}),
        businessMode,
        departments: departmentIds.length,
        agents: agentIds.length,
        spendCapMinor: input.spendCapMinor ?? null,
        autopilot: input.autopilot === true,
        planTier,
        modelBilling,
        includedCreditsMinor: credits ? Number(credits.grantedMinor) : null,
        logo: logo ? { source: logo.source, mime: logo.mime, sha256: logo.sha256, bytes: logo.bytes } : null,
        door: importLink ? "import" : "ideation",
        importSources: importSources.length,
        // The receipt a second commit of this idea answers with (committedIdeaResult).
        firstItemId: firstItem.id,
        chiefOfStaffId: chief.agent.id,
        taskIds,
        importSourceIds: importSources.map((s) => s.id),
      } satisfies CommitReceipt & Record<string, unknown>,
    });

    const foundations = { status: "pending" as const, door: importLink ? ("import" as const) : ("ideation" as const), importSourceIds: importSources.map((s) => s.id) };
    return { business: { ...business, committedAt: new Date(), archetype: input.archetype }, departmentIds, agentIds, chiefOfStaffId: chief.agent.id, firstItem, taskIds, foundations };
  });

  if (!result) return committedIdeaResult(db, userId, input.ideaId);

  // The Launch step's display choice goes on the founder's account (every business they run reads it). Best effort: the
  // business is already committed, and a preference that did not save is one switch away in Settings.
  if (input.anthropomorphicAgents !== undefined) {
    try {
      await repos.preferences.update(db, userId, { anthropomorphicAgents: input.anthropomorphicAgents });
    } catch (err) {
      deps.log?.warn({ businessId: result.business.id, err: err instanceof Error ? err.message : String(err) }, "commit: could not save the anthropomorphic agents preference");
    }
  }

  const cycle = await temporal.start(WORKFLOWS.businessCycle, { workflowId: workflowIds.cycle(result.business.id, 1), args: [{ businessId: result.business.id, cycleNumber: 1, trigger: "continue" }] });
  // The first cycle exists from here on, even while the orchestrator has not picked it up: Continue shows it and Pause reaches it.
  if (cycle.queued && !cycle.alreadyStarted) await repos.audit.append(db, result.business.id, { actorKind: "user", actorId: userId, action: QUEUE_ACTION, target: { kind: "cycle", id: cycle.workflowId }, details: { cycleNumber: 1, workflowId: cycle.workflowId, trigger: "continue" } });
  // Door B: the sign-up job read nothing; this is the import that reads the sources (or marks them not read).
  const imported = result.foundations.importSourceIds.length ? await queueImportReads({ db, temporal }, result.business.id, result.foundations.importSourceIds) : null;
  // The starters are on the board, but their engines wait for the founder's Start distribution (services/signoff.ts).
  // Autopilot starts after the first cycle, which it waits for (and for the sign-off notes, which block Continue).
  const autopilot = input.autopilot ? await startAutopilotWorkflow({ businessId: result.business.id, temporal }) : null;
  return { ...result, cycle, import: imported, engines: [], autopilot, alreadyCommitted: false };
}

/**
 * The answer to Take charge on an idea that is already a business (a double click, a second tab, a retried request):
 * the business the first commit created, with its first note, read back from that commit's audit row. Nothing is
 * created and the first cycle is not started again. Refused like before when the founder no longer belongs to that
 * business or the commit predates the receipt.
 */
async function committedIdeaResult(db: Db, userId: string, ideaId: string): Promise<CommitIdeaResult> {
  const idea = await repos.ideas.get(db, userId, ideaId);
  const businessId = idea.businessId;
  const member = businessId ? await repos.memberships.get(db, businessId, userId) : null;
  const audit = member && businessId ? await repos.audit.list(db, businessId, { action: COMMIT_AUDIT_ACTION, limit: 1 }) : null;
  const receipt = (audit?.items[0]?.details ?? {}) as CommitReceipt;
  const firstItemId = receipt.firstItemId ?? receipt.boardItemId;
  if (!businessId || !firstItemId || !receipt.chiefOfStaffId) throw new ValidationError("Idea is already committed", { ideaId });
  const [business, departments, agents, firstItem] = await Promise.all([
    repos.businesses.get(db, businessId),
    repos.departments.list(db, businessId),
    repos.agents.list(db, businessId, { limit: 500 }),
    repos.inbox.get(db, businessId, firstItemId),
  ]);
  return {
    business,
    departmentIds: departments.map((d) => d.id),
    agentIds: agents.items.map((a) => a.id),
    chiefOfStaffId: receipt.chiefOfStaffId,
    firstItem,
    taskIds: receipt.taskIds ?? [],
    cycle: { queued: false, workflowId: workflowIds.cycle(businessId, 1), reason: "already committed: the first commit started this cycle" },
    import: null,
    engines: [],
    foundations: { status: "pending", door: receipt.door ?? "ideation", importSourceIds: receipt.importSourceIds ?? [] },
    alreadyCommitted: true,
  };
}

/** Templates the archetype hires, for the Commit screen preview. */
export function squadPreview(archetype: Archetype) {
  const seed = getArchetypeSeed(archetype);
  const templates = new Set<string>([seed.assistantTemplateKey]);
  for (const d of seed.departments) for (const k of [d.leadTemplateKey, ...d.memberTemplateKeys]) templates.add(k);
  // Each agent's department, as commit hires it: the Chief of Staff sits in the department over the Team module; anyone
  // else in the first department that leads with or staffs the template (the Commit preview colors agents by it).
  const teamDept = seed.departments.find((d) => d.moduleKeys.includes("team"));
  const departmentOf = (key: string) => ((key === seed.assistantTemplateKey ? teamDept : undefined) ?? seed.departments.find((d) => d.leadTemplateKey === key || d.memberTemplateKeys.includes(key)))?.slug ?? null;
  return {
    departments: seed.departments.map((d) => ({ slug: d.slug, name: d.name, icon: d.icon, colourToken: d.colourToken, moduleKeys: d.moduleKeys, budgetMinor: d.budgetMinor, budgetLabel: "Estimate" as const })),
    agents: [...templates].map((key) => {
      const t = getTemplate(key);
      return { templateKey: key, name: t.name, role: t.role, layer: t.layer, modelKey: t.modelKey, wageCapMinor: t.wageCapMinor, wageLabel: "Estimate" as const, departmentSlug: departmentOf(key) };
    }),
    defaultChannels: seed.defaultChannels,
    specOutline: seed.specOutline,
  };
}
