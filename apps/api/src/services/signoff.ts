/**
 * The founder's sign-offs and the start of distribution (founder, 2026-10-18: the first days are about the product).
 *
 * - `decideProductSignoff` is the one implementation of Approve / Request changes for the specification and the
 *   roadmap, from the Inbox note (`decideSignoffItem`, which `decideInboxItem` hands a note tied to a `product_signoffs`
 *   round) or from the Product screens (`product.signoff.decide`). Approving the specification publishes it as a
 *   numbered version; approving the roadmap keeps a snapshot; Request changes needs the founder's words and gives the
 *   Product lead a revision task. The second approval starts the build (`startBuilding`): the Planner's task graph for
 *   the first Now items through the same service as Development › Plan, then the next cycle exactly as Continue does.
 * - `startDistribution` is the explicit step before any channel engine runs: `businesses.distribution_started_at`,
 *   the channel-scoring task, the archetype's Board question, the engines, one note from the Distribution strategist.
 * - `reopenSpecSignoffAfterPublish`: a specification published while its round was sent back asks for sign-off again.
 *
 * Nothing here calls a model except the Planner (through `planTaskGraph`); no plan compiler runs for a sign-off.
 */
import { CHANNEL_SCORING_TASK, getArchetypeSeed } from "@foundmill/agents";
import { LIMITS } from "@foundmill/config";
import { bothSignedOff, loadProductStage, repos, signoffDecisionBlock, type Decision, type DbTx, type InboxItem, type PlanWithActions, type ProductSignoff, type Task } from "@foundmill/db";
import { AppError, CHANNEL_META, ConflictError, ForbiddenError, ValidationError, type ProductStage, type SignoffKind, type SignoffStatus } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { importBoardDecisionFromReport } from "./commit";
import { startCycle, type StartCycleResult } from "./cycle";
import type { DecideItemResult } from "./decide";
import { ensureChannelEngines } from "./engines";
import { assertAgentsRunning } from "./stop-guard";
import { planTaskGraph } from "./task-graph";
import type { TemporalResult } from "./temporal";

// ---------------------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------------------

export interface SignoffView {
  id: string;
  kind: SignoffKind;
  round: number;
  status: SignoffStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedBy: { kind: "user" | "system"; id: string | null } | null;
  notes: string | null;
  /** The specification version an approval published (spec rounds). */
  specVersion: number | null;
  inboxItemId: string | null;
}

export interface SignoffViews {
  stage: ProductStage;
  spec: SignoffView | null;
  roadmap: SignoffView | null;
  readyToSell: SignoffView | null;
}

function viewOf(row: ProductSignoff | null, versions: Map<string, number>): SignoffView | null {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    round: row.round,
    status: row.status,
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedAt ? { kind: row.decidedByKind ?? "user", id: row.decidedBy } : null,
    notes: row.notes,
    specVersion: row.specVersionId ? (versions.get(row.specVersionId) ?? null) : null,
    inboxItemId: row.inboxItemId,
  };
}

/** The latest round of each kind as the screens read it, with the stage. */
export async function signoffViews(tx: DbTx, businessId: string): Promise<SignoffViews> {
  const [{ stage, signoffs }, versions] = await Promise.all([loadProductStage(tx, businessId), repos.product.listVersions(tx, businessId)]);
  const numbers = new Map(versions.map((v) => [v.id, v.version] as const));
  return { stage, spec: viewOf(signoffs.spec, numbers), roadmap: viewOf(signoffs.roadmap, numbers), readyToSell: viewOf(signoffs.readyToSell, numbers) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

const KIND_WORDS: Record<"spec" | "roadmap", { the: string; tab: string }> = { spec: { the: "the specification", tab: "Specification" }, roadmap: { the: "the roadmap", tab: "Roadmap" } };

/** "Oct 18, 2026" in the business's time zone (US dates everywhere a user can read). */
function dayWords(at: Date, timeZone: string | null): string {
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timeZone ?? "UTC" });
}

const clipWords = (s: string, n: number): string => {
  const w = s.split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(" ") : `${w.slice(0, n).join(" ")}…`;
};

/** The Product lead (the department over the product module), else the Chief of Staff: who the product notes come from. */
async function productVoice(tx: DbTx, businessId: string, preferred: string | null): Promise<{ id: string; name: string } | null> {
  if (preferred) {
    const agent = await repos.agents.get(tx, businessId, preferred).catch(() => null);
    if (agent) return { id: agent.id, name: agent.name };
  }
  const departments = await repos.departments.list(tx, businessId, { includeHidden: true });
  const leadId = departments.find((d) => (d.moduleKeys as string[]).includes("product"))?.leadAgentId ?? null;
  const lead = leadId ? await repos.agents.get(tx, businessId, leadId).catch(() => null) : null;
  if (lead) return { id: lead.id, name: lead.name };
  const chief = await repos.agents.chiefOfStaff(tx, businessId);
  return chief ? { id: chief.id, name: chief.name } : null;
}

async function postUpdate(tx: DbTx, ctx: BusinessContext, from: string, subject: string, bodyMd: string): Promise<InboxItem> {
  const item = await repos.inbox.createItem(tx, ctx.businessId, { type: "update", from_agent_id: from, subject: subject.slice(0, 80), body_md: bodyMd, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] }, { state: "unread" });
  await emit(tx, ctx, { type: "inbox.item_created", actor: { kind: "agent", id: from }, payload: { inboxItemId: item.id, type: item.type, fromAgentId: from, subject: item.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
  return item;
}

/**
 * Answer the note a round asked with: a one-action `reply_only` plan for the history (as an approval's answer is
 * recorded), the decision, and `decision.made`. Null when the note is gone or already answered.
 */
async function answerNote(tx: DbTx, ctx: BusinessContext, itemId: string | null, chosenOption: string, freeText: string | null, agentId: string | null, summary: string): Promise<{ item: InboxItem; decision: Decision; plan: PlanWithActions; actionId: string } | null> {
  if (!itemId) return null;
  const item = await repos.inbox.get(tx, ctx.businessId, itemId).catch(() => null);
  if (!item || item.state === "answered" || item.state === "archived") return null;
  const plan = await repos.plans.create(tx, ctx.businessId, { origin: "option", summaryMd: summary, inboxItemId: item.id, status: "executing", actions: [{ type: "reply_only", params: { acknowledgement: summary, signoff_option: chosenOption }, agentId, policyOutcome: "allow" }] });
  const decided = await repos.inbox.decide(tx, ctx.businessId, item.id, { chosenOption, freeText, decidedByKind: "user", decidedBy: ctx.userId, planId: plan.id });
  const action = plan.actions[0]!;
  await repos.plans.startAction(tx, ctx.businessId, action.id);
  await repos.plans.finishAction(tx, ctx.businessId, action.id, { status: "done", result: { signoffOption: chosenOption } });
  await emit(tx, ctx, { type: "decision.made", payload: { decisionId: decided.decision.id, inboxItemId: item.id, chosenOption, freeText, decidedBy: "user", planId: plan.id, planActionCount: 1, hardGateActions: 0 } });
  return { item: decided.item, decision: decided.decision, plan: await repos.plans.get(tx, ctx.businessId, plan.id), actionId: action.id };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sign-offs
// ---------------------------------------------------------------------------------------------------------------------

export interface DecideSignoffInput {
  kind: "spec" | "roadmap";
  decision: "approve" | "request_changes";
  /** The founder's words: required for Request changes, optional with an approval. */
  notes?: string | null;
}

export interface BuildStart {
  /** The tasks the Planner wrote, in order. */
  plannedTaskIds: string[];
  /** The roadmap items (or the archetype's first build) that were planned. */
  planned: string[];
  /** Items the Planner could not plan, with the reason (the founder plans them from Development › Plan). */
  failed: { title: string; reason: string }[];
  /** The next cycle: started on Temporal, run in-process, resumed, or not started (`reason`). */
  cycle: { started: boolean; mode: "temporal" | "local" | null; workflowId: string | null; reason: string | null };
  /** Door B: the import's first decisions, posted when the build starts. */
  importItemId: string | null;
}

export interface SignoffResult {
  signoff: ProductSignoff;
  stage: ProductStage;
  /** The note the round asked with, as answered now (null when it was answered already, or from the screen after the note). */
  item: InboxItem | null;
  decision: Decision | null;
  plan: PlanWithActions | null;
  followUp: InboxItem | null;
  /** The version an approval of the specification published (or confirmed). */
  specVersion: { id: string; version: number } | null;
  /** The revision task Request changes gave the Product lead. */
  task: Task | null;
  /** The first build, when this decision was the second approval. */
  build: BuildStart | null;
}

/** The one implementation of Approve / Request changes for the specification and the roadmap. */
export async function decideProductSignoff(ctx: BusinessContext, input: DecideSignoffInput): Promise<SignoffResult> {
  const notes = input.notes?.trim().slice(0, 2000) || null;
  const words = KIND_WORDS[input.kind];
  if (input.decision === "request_changes" && !notes) throw new ValidationError("Say what should change, in a sentence or two, so the Product lead can revise it.", { route: "conversation", kind: input.kind });

  const written = await ctx.rls(async (tx) => {
    // One decision at a time per business: the other kind approved in another tab at the same moment is seen committed
    // here, so exactly one of the two decisions reads "both approved" and starts the build.
    await repos.productSignoffs.lock(tx, ctx.businessId);
    const before = await repos.productSignoffs.latest(tx, ctx.businessId);
    const round = before[input.kind];
    if (!round) throw new ValidationError(`Nothing to sign off yet: ${words.the} is drafted when the business is first opened.`, { kind: input.kind });
    if (round.status === "approved") throw new ConflictError(`${words.tab} round ${round.round} is already signed off.`, { code: "already_decided", kind: input.kind, round: round.round });
    const voice = await productVoice(tx, ctx.businessId, round.inboxItemId ? ((await repos.inbox.get(tx, ctx.businessId, round.inboxItemId).catch(() => null))?.fromAgentId ?? null) : null);

    // Approving the specification publishes it as a numbered version: what the team builds from.
    let specVersion: { id: string; version: number } | null = null;
    if (input.decision === "approve" && input.kind === "spec") {
      const published = await repos.product.publish(tx, ctx.businessId, { changelogMd: "Signed off by the founder", publishedBy: ctx.userId, unlessUnchanged: true });
      specVersion = { id: published.version.id, version: published.version.version };
      if (published.created) {
        const blocks = (published.version.snapshot as { blocks?: Array<{ id: string }> }).blocks ?? [];
        await emit(tx, ctx, { type: "spec.version_published", payload: { specVersionId: published.version.id, version: published.version.version, previousVersion: published.previousVersion, changedBlockIds: blocks.map((b) => b.id), changelog: "Signed off by the founder", hunksAccepted: 0, hunksRejected: 0, hunksEdited: 0 } });
        await audit(tx, ctx, { action: "product.spec.publish", target: { kind: "spec_version", id: published.version.id }, details: { version: published.version.version, signoff: true } });
      }
    }
    const snapshot = input.decision === "approve" && input.kind === "roadmap" ? { items: (await repos.product.listRoadmap(tx, ctx.businessId)).map((i) => ({ id: i.id, title: i.title, horizon: i.horizon, position: i.position })) } : undefined;
    const status: SignoffStatus = input.decision === "approve" ? "approved" : "changes_requested";
    const decided = await repos.productSignoffs.decide(tx, ctx.businessId, round.id, { status, notes, decidedBy: ctx.userId, decidedByKind: "user", from: ["pending", "changes_requested"], ...(specVersion ? { specVersionId: specVersion.id } : {}), ...(snapshot ? { snapshot } : {}) });
    if (!decided) throw new ConflictError(`${words.tab} round ${round.round} was decided a moment ago.`, { code: "already_decided", kind: input.kind, round: round.round });

    const summary = input.decision === "approve" ? `Approved ${words.the}${specVersion ? ` (version ${specVersion.version})` : ""}.` : `Requested changes to ${words.the}: ${clipWords(notes!, 40)}`;
    const answered = await answerNote(tx, ctx, round.inboxItemId, input.decision === "approve" ? "approve" : "request_changes", notes, voice?.id ?? null, summary);

    // Request changes: the founder's own words become the Product lead's revision task (trusted: they are the founder's).
    let task: Task | null = null;
    if (input.decision === "request_changes") {
      const departments = await repos.departments.list(tx, ctx.businessId, { includeHidden: true });
      const product = departments.find((d) => (d.moduleKeys as string[]).includes("product")) ?? null;
      task = await repos.tasks.create(tx, ctx.businessId, {
        kind: "research",
        title: `Revise ${words.the}: ${notes!.slice(0, 60)}`.slice(0, 200),
        goalMd: `${notes}\n\nReflect these in ${input.kind === "spec" ? "the specification blocks through proposals" : "the roadmap items"}, then tell the founder it is ready to sign off again.`,
        acceptance: ["The founder's requested changes are reflected", "The founder was asked to sign off again"],
        assigneeAgentId: voice?.id ?? null,
        departmentId: product?.id ?? null,
        status: "ready",
        currency: ctx.business.currency,
      });
    }
    const after = await repos.productSignoffs.latest(tx, ctx.businessId);
    await audit(tx, ctx, { action: "product.signoff.decide", target: { kind: "product_signoff", id: decided.id }, details: { kind: input.kind, round: decided.round, decision: status, specVersionId: specVersion?.id ?? null, notes: notes ? notes.slice(0, 500) : null, taskId: task?.id ?? null, bothApproved: bothSignedOff(after) } });
    return { round: decided, voice, specVersion, answered, task, after, bothApproved: input.decision === "approve" && bothSignedOff(after) };
  });

  // The second approval starts the build: the Planner's graph for the first Now items, then the next cycle as Continue does.
  const build = written.bothApproved ? await startBuilding(ctx) : null;

  const followUp = await ctx.rls(async (tx) => {
    const { stage } = await loadProductStage(tx, ctx.businessId);
    const day = dayWords(new Date(), ctx.business.timeZone);
    let note: InboxItem | null = null;
    if (written.voice) {
      if (build) note = await postUpdate(tx, ctx, written.voice.id, `Building starts: ${build.plannedTaskIds.length} task${build.plannedTaskIds.length === 1 ? "" : "s"} planned`, buildingStartsBody(build));
      else if (input.decision === "approve") {
        const other = input.kind === "spec" ? "roadmap" : "specification";
        note = await postUpdate(tx, ctx, written.voice.id, `${words.tab} signed off`, `You approved ${words.the}${written.specVersion ? ` (version ${written.specVersion.version})` : ""} on ${day}. Sign off the ${other} and the build starts.`);
      } else note = await postUpdate(tx, ctx, written.voice.id, `Changes requested: ${words.the}`, `Noted: “${clipWords(notes!, 40)}”. ${written.voice.name} revises it and asks for your sign-off again. You can also edit it yourself on the ${words.tab} tab and approve it there.`);
    }
    await emit(tx, ctx, {
      type: "product.signoff_decided",
      payload: {
        signoffId: written.round.id,
        kind: input.kind,
        round: written.round.round,
        decision: input.decision === "approve" ? "approved" : "changes_requested",
        decidedBy: { kind: "user", id: ctx.userId },
        notes,
        specVersionId: written.specVersion?.id ?? null,
        buildStarted: build !== null,
        plannedTaskIds: build?.plannedTaskIds.slice(0, 64) ?? [],
        cycle: build?.cycle.workflowId ? { queued: build.cycle.started, workflowId: build.cycle.workflowId } : null,
      },
    });
    return { note, stage };
  });

  return { signoff: written.round, stage: followUp.stage, item: written.answered?.item ?? null, decision: written.answered?.decision ?? null, plan: written.answered?.plan ?? null, followUp: followUp.note, specVersion: written.specVersion, task: written.task, build };
}

function buildingStartsBody(build: BuildStart): string {
  const planned = build.planned.length ? `The Planner turned ${build.planned.map((t) => `“${t}”`).join(" and ")} into ${build.plannedTaskIds.length} task${build.plannedTaskIds.length === 1 ? "" : "s"} on Development › Plan.` : "Nothing was planned yet: open Development › Plan and build a task graph for the first roadmap item.";
  const failed = build.failed.length ? ` ${build.failed.map((f) => `“${f.title}” could not be planned (${f.reason}); plan it from Development › Plan.`).join(" ")}` : "";
  const cycle = build.cycle.started ? "The first build cycle is under way." : `Press Continue to start the first build cycle${build.cycle.reason ? `: ${build.cycle.reason}` : "."}`;
  return `Signed off: the specification and the roadmap. ${planned}${failed} ${cycle} Distribution waits until you start it from Distribution › Board.`;
}

/**
 * Both sign-offs approved: plan the first Now items (one Planner call each, audited by `dev.tasks.plan` so a retried
 * sign-off reuses the plan within its repeat window), post Door B's import decisions, start the next cycle the way
 * Continue does. A refused cycle start (blocked Continue, a stopped team) is worded in the follow-up, never swallowed
 * silently; any other failure is the caller's.
 */
export async function startBuilding(ctx: BusinessContext): Promise<BuildStart> {
  const seed = ctx.business.archetype ? getArchetypeSeed(ctx.business.archetype) : null;
  const [now, departments] = await ctx.rls((tx) => Promise.all([repos.product.listRoadmap(tx, ctx.businessId, { horizon: "now" }), repos.departments.list(tx, ctx.businessId, { includeHidden: true })]));
  const items = [...now].sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime()).slice(0, LIMITS.signoffPlanRoadmapItems);
  const development = departments.find((d) => d.slug === "development") ?? departments.find((d) => (d.moduleKeys as string[]).includes("development")) ?? null;
  const plannedTaskIds: string[] = [];
  const planned: string[] = [];
  const failed: { title: string; reason: string }[] = [];
  const requests = items.length ? items.map((i) => ({ title: i.title, input: { roadmapItemId: i.id } })) : seed ? [{ title: seed.firstBuild.title, input: { goal: `${seed.firstBuild.title}: ${seed.firstBuild.goal}\n\nAcceptance:\n${seed.firstBuild.acceptance.map((a) => `- ${a}`).join("\n")}`, ...(development ? { departmentId: development.id } : {}) } }] : [];
  for (const r of requests) {
    try {
      const result = await planTaskGraph(ctx, r.input);
      plannedTaskIds.push(...result.tasks.map((t) => t.id));
      planned.push(r.title);
    } catch (err) {
      ctx.log.warn({ businessId: ctx.businessId, title: r.title, err: (err as Error).message }, "first build: the Planner could not plan a roadmap item");
      failed.push({ title: r.title, reason: err instanceof AppError ? err.message : "the Planner did not answer" });
    }
  }

  // The next cycle first, the way Continue starts it: the build begins on the sign-off. Door B's import decision is
  // posted after it (it blocks Continue, as the Board's question did at commit while the first cycle already ran).
  let cycle: BuildStart["cycle"];
  try {
    const started: StartCycleResult = await startCycle(ctx);
    cycle = { started: started.action !== "already_running" || started.status.running, mode: started.mode, workflowId: started.status.workflowId ?? started.workflow?.workflowId ?? null, reason: started.action === "already_running" ? "a cycle is already running" : null };
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    cycle = { started: false, mode: null, workflowId: null, reason: err.message };
  }

  // Door B: the import's first decisions, posted now that the product is signed off (once per business).
  const importItemId = await ctx.rls(async (tx) => {
    const foundations = await repos.foundations.get(tx, ctx.businessId);
    const report = foundations?.importReport ?? null;
    if (!report) return null;
    const key = `board_import:${ctx.businessId}`;
    if (await repos.events.byIdempotencyKey(tx, ctx.businessId, key)) return null;
    const sources = (await repos.product.listSources(tx, ctx.businessId, { limit: 200 })).items.filter((s) => (s.relevance as Record<string, unknown>)?.import !== undefined).length;
    const board = importBoardDecisionFromReport(ctx.business.name, report as Parameters<typeof importBoardDecisionFromReport>[1], sources);
    const chief = await repos.agents.chiefOfStaff(tx, ctx.businessId);
    if (!board || !chief) return null;
    const item = await repos.inbox.createItem(tx, ctx.businessId, {
      type: "decision",
      from_agent_id: chief.id,
      subject: board.subject,
      body_md: board.bodyMd,
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: { options: board.options.map((o) => ({ id: o.id, label: o.label, recommended: o.recommended, consequence: o.consequence, cost_minor: o.costMinor, reversible: o.reversible, ...(o.actions?.length ? { actions: o.actions } : {}) })), free_text: true, expires_at: null },
      blocks_continue: true,
      source_event_ids: [],
      entity_ids: [],
    });
    await emit(tx, ctx, { type: "inbox.item_created", idempotencyKey: key, actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: item.id, type: "decision", fromAgentId: chief.id, subject: item.subject, blocksContinue: true, sourceEventIds: [], cost: null } });
    return item.id;
  });
  return { plannedTaskIds, planned, failed, cycle, importItemId };
}

// ---------------------------------------------------------------------------------------------------------------------
// The Inbox note's answer
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A sign-off note answered from the Inbox (`decideInboxItem` recognised the item by its round): the option or the free
 * text maps onto `decideProductSignoff` (spec, roadmap) or `startDistribution` (Ready to start selling?). No plan
 * compiler, no model call.
 */
export async function decideSignoffItem(ctx: BusinessContext, item: InboxItem, signoff: ProductSignoff, input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  if (signoff.status !== "pending" && signoff.status !== "changes_requested") throw new ValidationError(`This sign-off was already ${signoff.status === "approved" ? "approved" : "answered"}.`, { itemId: item.id, code: "already_decided" });
  const empty: Pick<DecideItemResult, "evaluations" | "requiresConfirmation" | "deferred" | "denied" | "dispatch"> = { evaluations: [], requiresConfirmation: false, deferred: [], denied: [], dispatch: null };
  if (signoff.kind === "ready_to_sell") {
    if (input.chosenOption === "start" || (!input.chosenOption && input.freeText)) {
      const started = await startDistribution(ctx, { via: "inbox", itemId: item.id });
      const answered = started.answered;
      if (!answered) throw new ConflictError("Distribution has already started.", { itemId: item.id, code: "already_decided" });
      return { ...empty, item: answered.item, decision: answered.decision, plan: answered.plan, executed: [answered.actionId], followUp: started.followUp };
    }
    if (input.chosenOption !== "not_yet") throw new ValidationError("Choose Start distribution now or Not yet.", { itemId: item.id });
    const declined = await ctx.rls(async (tx) => {
      const row = await repos.productSignoffs.decide(tx, ctx.businessId, signoff.id, { status: "declined", notes: input.freeText, decidedBy: ctx.userId, decidedByKind: "user" });
      if (!row) throw new ConflictError("This note was answered a moment ago.", { itemId: item.id, code: "already_decided" });
      const answered = await answerNote(tx, ctx, item.id, "not_yet", input.freeText, item.fromAgentId, "Not yet: distribution waits.");
      const followUp = item.fromAgentId ? await postUpdate(tx, ctx, item.fromAgentId, "Noted: distribution waits", "Noted. Start distribution any time from Distribution › Board.") : null;
      await emit(tx, ctx, { type: "product.signoff_decided", payload: { signoffId: row.id, kind: "ready_to_sell", round: row.round, decision: "declined", decidedBy: { kind: "user", id: ctx.userId }, notes: input.freeText, specVersionId: null, buildStarted: false, plannedTaskIds: [], cycle: null } });
      await audit(tx, ctx, { action: "product.signoff.decide", target: { kind: "product_signoff", id: row.id }, details: { kind: "ready_to_sell", round: row.round, decision: "declined" } });
      return { answered, followUp };
    });
    if (!declined.answered) throw new ConflictError("This note was answered a moment ago.", { itemId: item.id, code: "already_decided" });
    return { ...empty, item: declined.answered.item, decision: declined.answered.decision, plan: declined.answered.plan, executed: [declined.answered.actionId], followUp: declined.followUp };
  }

  const kind = signoff.kind;
  let decision: DecideSignoffInput["decision"];
  if (input.chosenOption === "approve") decision = "approve";
  else if (input.chosenOption === "request_changes" || (!input.chosenOption && input.freeText)) {
    if (!input.freeText) throw new ValidationError("Say what should change, in a sentence or two, so the Product lead can revise it.", { route: "conversation", itemId: item.id });
    decision = "request_changes";
  } else throw new ValidationError(`Choose Approve or Request changes for ${KIND_WORDS[kind].the}.`, { itemId: item.id });
  const result = await decideProductSignoff(ctx, { kind, decision, notes: input.freeText });
  if (!result.item || !result.decision || !result.plan) {
    // The note was answered from the screen a moment before: say so instead of inventing a decision.
    throw new ConflictError("This sign-off was answered a moment ago.", { itemId: item.id, code: "already_decided" });
  }
  return { ...empty, item: result.item, decision: result.decision, plan: result.plan, executed: result.plan.actions.map((a) => a.id), followUp: result.followUp };
}

// ---------------------------------------------------------------------------------------------------------------------
// Start distribution
// ---------------------------------------------------------------------------------------------------------------------

export interface StartDistributionResult {
  started: boolean;
  boardItemId: string | null;
  scoringTaskId: string | null;
  engines: TemporalResult[];
  followUp: InboxItem | null;
  /** The Ready to start selling? note, when this start answered it. */
  answered: { item: InboxItem; decision: Decision; plan: PlanWithActions; actionId: string } | null;
}

/**
 * The explicit step that lets distribution spend effort (Distribution › Board › Start distribution, or the Chief of
 * Staff's Ready to start selling? note): owners and admins only. One transaction sets `distribution_started_at` (a
 * second start changes nothing), approves a pending Ready to start selling round, creates the channel-scoring task and
 * posts the archetype's Board question; then the enabled channels' engines start and the Distribution strategist says so.
 */
export async function startDistribution(ctx: BusinessContext, input: { via: "board" | "inbox"; itemId?: string | null }): Promise<StartDistributionResult> {
  if (ctx.role !== "owner" && ctx.role !== "admin") throw new ForbiddenError("Owners and admins start distribution.");
  await assertAgentsRunning(ctx, "distribution");
  const seed = ctx.business.archetype ? getArchetypeSeed(ctx.business.archetype) : null;

  const written = await ctx.rls(async (tx) => {
    const start = await repos.businesses.startDistribution(tx, ctx.businessId);
    if (!start.changed) return null;
    const [channels, agents, departments, chief, latest] = await Promise.all([repos.channels.list(tx, ctx.businessId, {}), repos.agents.list(tx, ctx.businessId, { limit: 500 }), repos.departments.list(tx, ctx.businessId, { includeHidden: true }), repos.agents.chiefOfStaff(tx, ctx.businessId), repos.productSignoffs.latest(tx, ctx.businessId)]);
    const enabled = channels.filter((c) => c.enabled && !c.archivedAt);

    // The Ready to start selling? round, when it was offered: approved, its note answered.
    let answered: StartDistributionResult["answered"] = null;
    const ready = latest.readyToSell;
    if (ready && ready.status === "pending") {
      await repos.productSignoffs.decide(tx, ctx.businessId, ready.id, { status: "approved", decidedBy: ctx.userId, decidedByKind: "user" });
      answered = await answerNote(tx, ctx, ready.inboxItemId, "start", null, chief?.id ?? null, "Distribution started.");
    }

    // Scoring the channels is the first distribution work; a business whose channels were scored already keeps its scores.
    let scoringTaskId: string | null = null;
    if (!channels.some((c) => c.scoredAt)) {
      const strategist = agents.items.find((a) => a.agentType === CHANNEL_SCORING_TASK.assigneeTemplateKey) ?? null;
      const distribution = departments.find((d) => d.slug === CHANNEL_SCORING_TASK.departmentSlug) ?? departments.find((d) => (d.moduleKeys as string[]).includes("distribution")) ?? null;
      const task = await repos.tasks.create(tx, ctx.businessId, { kind: CHANNEL_SCORING_TASK.kind, title: CHANNEL_SCORING_TASK.title, goalMd: CHANNEL_SCORING_TASK.goal, acceptance: CHANNEL_SCORING_TASK.acceptance, assigneeAgentId: strategist?.id ?? distribution?.leadAgentId ?? null, departmentId: distribution?.id ?? null, status: "ready", currency: ctx.business.currency });
      scoringTaskId = task.id;
    }

    // The Board's question ("Where should the first customer come from?"), from the Chief of Staff, blocking Continue.
    let boardItemId: string | null = null;
    if (seed && chief) {
      const board = seed.boardDecision;
      const item = await repos.inbox.createItem(tx, ctx.businessId, {
        type: "decision",
        from_agent_id: chief.id,
        subject: board.subject,
        body_md: board.bodyMd,
        status_strip: [],
        exhibit: { kind: "none", spec_ref: null },
        decision: { options: board.options.map((o) => ({ id: o.id, label: o.label, recommended: o.recommended, consequence: o.consequence, cost_minor: o.costMinor, reversible: o.reversible, ...(o.actions?.length ? { actions: o.actions } : {}) })), free_text: true, expires_at: null },
        blocks_continue: true,
        source_event_ids: [],
        entity_ids: [],
      });
      boardItemId = item.id;
      await emit(tx, ctx, { type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: item.id, type: "decision", fromAgentId: chief.id, subject: item.subject, blocksContinue: true, sourceEventIds: [], cost: null } });
    }
    await emit(tx, ctx, { type: "distribution.started", payload: { startedBy: { kind: "user", id: ctx.userId }, via: input.via, channelIds: enabled.map((c) => c.id), boardItemId, engines: 0 } });
    await audit(tx, ctx, { action: "distribution.start", target: { kind: "business", id: ctx.businessId }, details: { via: input.via, itemId: input.itemId ?? null, channels: enabled.map((c) => c.channelKey), boardItemId, scoringTaskId } });
    const strategist = agents.items.find((a) => a.agentType === CHANNEL_SCORING_TASK.assigneeTemplateKey) ?? null;
    return { enabled, answered, scoringTaskId, boardItemId, strategist, chief };
  });
  if (!written) return { started: false, boardItemId: null, scoringTaskId: null, engines: [], followUp: null, answered: null };

  // After commit: the engines (each records its id on the channel; the reconciler starts any Temporal could not take now).
  const engines = await ensureChannelEngines({ db: ctx.db, temporal: ctx.temporal, businessId: ctx.businessId }, written.enabled);
  const followUp = await ctx.rls(async (tx) => {
    const from = written.strategist ?? written.chief;
    if (!from) return null;
    const labels = written.enabled.map((c) => CHANNEL_META[c.channelKey as keyof typeof CHANNEL_META]?.label ?? c.channelKey);
    const n = written.enabled.length;
    const body = [
      n ? `${n} channel${n === 1 ? " is" : "s are"} on the board: ${labels.join(", ")}. ${n === 1 ? "Its engine starts" : "Their engines start"} now and ask${n === 1 ? "s" : ""} you before anything launches.` : "No channel is on the board yet: put one on and its engine starts.",
      written.scoringTaskId ? `${from.name} scores the 15 channels first; the Board asks which route to the first customer comes first.` : "The channels keep the scores they have; the Board asks which route to the first customer comes first.",
    ].join(" ");
    return postUpdate(tx, ctx, from.id, "Distribution has started", body);
  });
  return { started: true, boardItemId: written.boardItemId, scoringTaskId: written.scoringTaskId, engines, followUp, answered: written.answered };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reopen after a publish
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A specification version published while the latest spec round was sent back (`changes_requested`) reopens the
 * sign-off: a new round and a new note, "Sign off the revised specification". Inside the publishing transaction.
 */
export async function reopenSpecSignoffAfterPublish(tx: DbTx, ctx: BusinessContext, version: { id: string; version: number; changelogMd: string }): Promise<InboxItem | null> {
  const latest = await repos.productSignoffs.latest(tx, ctx.businessId);
  if (latest.spec?.status !== "changes_requested") return null;
  const voice = await productVoice(tx, ctx.businessId, latest.spec.inboxItemId ? ((await repos.inbox.get(tx, ctx.businessId, latest.spec.inboxItemId).catch(() => null))?.fromAgentId ?? null) : null);
  if (!voice) return null;
  const changelog = version.changelogMd.trim() ? clipWords(version.changelogMd.trim(), 30) : "the changes you asked for";
  const opened = await repos.productSignoffs.open(tx, ctx.businessId, {
    kind: "spec",
    specVersionId: version.id,
    item: { type: "decision", from_agent_id: voice.id, subject: "Sign off the revised specification", body_md: `Version ${version.version} reflects the changes you asked for: ${changelog}. Read it on the Specification tab, then approve it or ask for more changes.`, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: signoffDecisionBlock("spec"), blocks_continue: true, source_event_ids: [], entity_ids: [] },
  });
  if (!opened.created || !opened.item) return null;
  await emit(tx, ctx, { type: "inbox.item_created", actor: { kind: "agent", id: voice.id }, payload: { inboxItemId: opened.item.id, type: "decision", fromAgentId: voice.id, subject: opened.item.subject, blocksContinue: true, sourceEventIds: [], cost: null } });
  return opened.item;
}
