/**
 * Team call (docs/TEAM_CALL.md §5): a spoken call between the founder and their team of agents (`team`), or one agent
 * (`one_to_one`, Call on the agent's profile). Chat at the agent's desk (services/conversation.ts) is separate.
 *
 * - start      the call row, `team_call.started`, and the opening round (the Chief of Staff, or the called agent, greets).
 * - say        the founder's turn is stored first (idempotent on `clientTurnId`, so a retry never says it twice and the
 *              founder's words survive a failed model call), then one round of the turn director.
 * - continue   an agent-only round ("Let the team discuss"), at most `agentRoundsWithoutFounder` in a row: past it, and
 *              past the call's round ceiling, the answer hands back with no model call.
 * - speech     one agent turn spoken in the agent's accent, with names as this listener reads them (`spokenText`).
 * - transcribe what the founder said (live through the gateway; simulated: empty, the browser recognizes instead).
 * - end        the wrap-up: a summary and action items as typed plan actions, checked by `evaluatePlan` as every decision
 *              is. Filing actions that policy allows (a task in its department, a new roadmap item, a spec suggestion)
 *              run at once in a `team_call` plan; a hard gate becomes the founder's own step; everything else (money,
 *              outside contact, a channel switched on, a hire, a model change) is staged as a plan that waits for the
 *              founder's go-ahead on the Chief of Staff's "Notes from your team call" note in the Inbox. Nothing said on
 *              a call moves money, signs, contacts anyone or acts on untrusted content.
 *
 * Agents are named and pictured the way they are everywhere (the persona rules of the person reading), and every agent
 * sounds the same in every call (`assignSpeechAccents` over every agent the business ever hired).
 */
import {
  buildTeamCallTurnRequest,
  buildTeamCallWrapUpRequest,
  finaliseTeamCallTurns,
  finaliseTeamCallWrapUp,
  getTemplateByAgentType,
  teamCallRemit,
  teamCallTurnsContext,
  teamCallWrapUpContext,
  TEAM_CALL_TURN_USAGE_KIND,
  TEAM_CALL_WRAP_UP_USAGE_KIND,
  type TeamCallParticipantInput,
  type TeamCallTranscriptTurn,
  type TeamCallTurnMode,
} from "@foundmill/agents";
import { repos, type Agent, type Department, type DbTx, type PlanWithActions, type TeamCall, type TeamCallTurn } from "@foundmill/db";
import type { PlanAction } from "@foundmill/models";
import {
  agentDisplayName,
  assignSpeechAccents,
  ConflictError,
  DEFAULT_AGENT_STYLE,
  hasSectionAccess,
  NotFoundError,
  planActionSection,
  spokenText,
  teamCallActionsLine,
  teamTree,
  TEAM_CALL_LIMITS,
  TEAM_CALL_WORDS,
  ValidationError,
  WRITE_ROLES,
  type PlanActionType,
  type TeamCallActionStatus,
  type TeamCallActionView,
  type TeamCallAddressee,
  type TeamCallAudioMime,
  type TeamCallKind,
  type TeamCallParticipantView,
  type TeamCallRoundView,
  type TeamCallSpeechModes,
  type TeamCallSpeechView,
  type TeamCallSummaryView,
  type TeamCallTargetKind,
  type TeamCallTranscriptView,
  type TeamCallTurnView,
  type TeamCallView,
} from "@foundmill/shared";
import { audit, emit, type BusinessContext } from "../trpc";
import { planContextFor } from "./decide";
import { dispatchPlan, evaluatePlan, executePlanActions, ownAgentsOnly, redispatchPlans, stagedAction, type ActionEvaluation } from "./plans";
import { speechModes, synthesizeCallSpeech, transcribeCallSpeech } from "./speech";

// ---------------------------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The plan actions a call files by itself when policy allows them: work written down inside the project. Anything else
 * the call agreed (a channel switched on, a budget, a hire, a message to someone) waits for the founder's go-ahead even
 * where policy alone would allow it: a call is a conversation, and switching things on is a decision.
 */
export const FILED_AT_ONCE: ReadonlySet<PlanActionType> = new Set(["create_task", "update_roadmap", "update_spec", "request_human_action"]);

/** What the founder reads when the call has used its rounds: the call's own spend ceiling. */
export const CALL_ROUNDS_USED = "This call has run long, so the team is holding here. End the call to file what you agreed, then start a new one.";

/** A turn's addressee as stored (`addressed_to`), back to the shared shape. */
function addresseeOf(raw: unknown): TeamCallAddressee | null {
  if (raw === "founder" || raw === "team") return raw;
  if (raw && typeof raw === "object" && typeof (raw as { agentId?: unknown }).agentId === "string") return { agentId: (raw as { agentId: string }).agentId };
  return null;
}

export function toTurnView(t: TeamCallTurn): TeamCallTurnView {
  return {
    id: t.id,
    seq: t.seq,
    speaker: t.speaker,
    agentId: t.agentId,
    userId: t.userId,
    text: t.text,
    to: addresseeOf(t.addressedTo),
    via: t.via ?? null,
    createdAt: new Date(t.createdAt).toISOString(),
  };
}

const canWrite = (ctx: BusinessContext): boolean => (WRITE_ROLES as readonly string[]).includes(ctx.role) && hasSectionAccess(ctx.membership, "team", "write");

const displayNameFor = (ctx: BusinessContext) => (agent: Pick<Agent, "name" | "role" | "personaKey" | "layer" | "agentType">) =>
  agentDisplayName(agent, ctx.anthropomorphicAgents === true, ctx.agentStyle ?? DEFAULT_AGENT_STYLE);

// ---------------------------------------------------------------------------------------------------------------------
// The team as a call sees it
// ---------------------------------------------------------------------------------------------------------------------

interface Roster {
  /** Every agent the business ever hired (released too): accents are assigned over all of them. */
  all: Agent[];
  /** Live, founder-visible agents (no background helpers), in the team's order. */
  visible: Agent[];
  chief: Agent | null;
  departments: Department[];
  accents: Map<string, string>;
}

async function rosterOf(tx: DbTx, businessId: string): Promise<Roster> {
  const [agents, departments] = await Promise.all([repos.agents.list(tx, businessId, { limit: 500, includeArchived: true }), repos.departments.list(tx, businessId)]);
  const all = agents.items;
  const tree = teamTree(all, departments);
  return { all, visible: tree.visible, chief: tree.chief, departments, accents: assignSpeechAccents(all) };
}

/** The default people for a team call: the Chief of Staff and the leads, then specialists, at most eight. */
export function defaultTeamCallAgents(roster: Pick<Roster, "visible" | "chief">, departments: readonly Department[]): string[] {
  const tree = teamTree(roster.visible, departments);
  const heads = tree.groups.map((g) => g.agent.id);
  const rest = tree.visible.map((a) => a.id).filter((id) => !heads.includes(id));
  return [...heads, ...rest].slice(0, TEAM_CALL_LIMITS.maxAgentsInTeamCall);
}

function participantView(agent: Agent, roster: Roster): TeamCallParticipantView {
  const dept = roster.departments.find((d) => d.id === agent.departmentIds[0]) ?? null;
  return {
    agentId: agent.id,
    name: agent.name,
    role: agent.role || getTemplateByAgentType(agent.agentType)?.role || "Agent",
    personaKey: agent.personaKey ?? null,
    avatarSeed: agent.avatarSeed || agent.id,
    layer: agent.layer,
    agentType: agent.agentType,
    colourToken: dept?.colourToken ?? null,
    departmentId: dept?.id ?? null,
    speechAccent: roster.accents.get(agent.id)!,
    isChiefOfStaff: roster.chief?.id === agent.id,
  };
}

function promptParticipant(ctx: BusinessContext, agent: Agent, roster: Roster): TeamCallParticipantInput {
  const template = getTemplateByAgentType(agent.agentType);
  const dept = roster.departments.find((d) => d.id === agent.departmentIds[0]) ?? null;
  return {
    id: agent.id,
    displayName: displayNameFor(ctx)(agent),
    name: agent.name,
    role: agent.role || template?.role || "Agent",
    departmentName: dept?.name ?? null,
    remit: teamCallRemit(agent.descriptionMd || template?.description || agent.role || ""),
    voice: template?.voice ?? null,
    isChiefOfStaff: roster.chief?.id === agent.id,
  };
}

const callAgents = (call: TeamCall, roster: Roster): Agent[] => call.agentIds.map((id) => roster.all.find((a) => a.id === id)).filter((a): a is Agent => !!a);

async function founderNameOf(ctx: BusinessContext): Promise<string> {
  const profile = await repos.founders.get(ctx.db, ctx.userId).catch(() => null);
  return profile?.displayName?.trim() || "the founder";
}

async function briefOf(tx: DbTx, businessId: string) {
  const [roadmap, counts] = await Promise.all([repos.product.listRoadmap(tx, businessId), repos.tasks.countByStatus(tx, businessId)]);
  const open = (["planned", "ready", "running", "in_review", "blocked", "paused"] as const).reduce((n, s) => n + ((counts as Record<string, number>)[s] ?? 0), 0);
  return { roadmap, brief: { roadmapNow: roadmap.filter((r) => r.horizon === "now").map((r) => r.title).slice(0, 10), openTasks: open } };
}

const transcriptOf = (turns: readonly TeamCallTurn[]): TeamCallTranscriptTurn[] => turns.map((t) => ({ speaker: t.speaker, agentId: t.agentId, text: t.text }));

/** Model rounds so far: each round's agent turns are written together, at one instant. */
export function modelRoundsOf(turns: readonly Pick<TeamCallTurn, "speaker" | "createdAt">[]): number {
  return new Set(turns.filter((t) => t.speaker === "agent").map((t) => new Date(t.createdAt).getTime())).size;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------------

export function teamCallSpeechModes(ctx: BusinessContext): TeamCallSpeechModes {
  return speechModes(ctx.env);
}

export async function listTeamCalls(ctx: BusinessContext, limit = 20): Promise<TeamCallSummaryView[]> {
  const rows = await ctx.rls((tx) => repos.teamCalls.list(tx, ctx.businessId, { limit }));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    topic: r.topic,
    startedAt: new Date(r.startedAt).toISOString(),
    endedAt: r.endedAt ? new Date(r.endedAt).toISOString() : null,
    agentIds: r.agentIds,
    turnCount: r.turnCount,
    actionCount: r.actionCount,
    filedCount: r.filedCount,
    awaitingCount: r.awaitingCount,
    summaryLine: r.summary ? (r.summary.split(/(?<=[.!?])\s+/)[0] ?? r.summary).slice(0, 200) : null,
  }));
}

export async function getTeamCall(ctx: BusinessContext, callId: string): Promise<TeamCallView> {
  return ctx.rls(async (tx) => {
    const [call, turns, actions, roster] = await Promise.all([repos.teamCalls.get(tx, ctx.businessId, callId), repos.teamCalls.turns(tx, ctx.businessId, callId), repos.teamCalls.actions(tx, ctx.businessId, callId), rosterOf(tx, ctx.businessId)]);
    return {
      id: call.id,
      kind: call.kind,
      status: call.status,
      topic: call.topic,
      startedAt: new Date(call.startedAt).toISOString(),
      endedAt: call.endedAt ? new Date(call.endedAt).toISOString() : null,
      startedBy: call.startedBy,
      participants: callAgents(call, roster).map((a) => participantView(a, roster)),
      turns: turns.map(toTurnView),
      summary: call.summary,
      actions: actions.map(
        (a): TeamCallActionView => ({
          id: a.id,
          actionType: a.actionType,
          title: a.title,
          detail: a.detail,
          departmentId: a.departmentId,
          agentId: a.agentId,
          status: a.status,
          target: a.targetKind && a.targetId ? { kind: a.targetKind, id: a.targetId } : null,
          planId: a.planId,
          reason: a.reason,
        }),
      ),
      agentRoundsSinceFounder: call.agentRoundsSinceFounder,
      canSpeak: canWrite(ctx),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Start, say, continue
// ---------------------------------------------------------------------------------------------------------------------

export interface StartTeamCallInput {
  kind: TeamCallKind;
  agentIds?: string[];
  topic?: string | null;
}

export async function startTeamCall(ctx: BusinessContext, input: StartTeamCallInput): Promise<TeamCallView> {
  const roster = await ctx.rls((tx) => rosterOf(tx, ctx.businessId));
  const visible = new Set(roster.visible.map((a) => a.id));
  const asked = [...new Set(input.agentIds ?? [])];
  for (const id of asked) if (!visible.has(id)) throw new ValidationError("Only agents on your team can join a call", { agentId: id });
  let agentIds: string[];
  if (input.kind === "one_to_one") {
    if (asked.length !== 1) throw new ValidationError("A call with one agent needs exactly one agent");
    agentIds = asked;
  } else {
    agentIds = asked.length ? asked : defaultTeamCallAgents(roster, roster.departments);
    if (agentIds.length === 0) throw new ValidationError("Your team has no agents to call yet");
    if (agentIds.length > TEAM_CALL_LIMITS.maxAgentsInTeamCall) throw new ValidationError(`A team call has at most ${TEAM_CALL_LIMITS.maxAgentsInTeamCall} agents`);
    // The Chief of Staff leads a team call: first on the call when it is there.
    if (roster.chief && agentIds.includes(roster.chief.id)) agentIds = [roster.chief.id, ...agentIds.filter((id) => id !== roster.chief!.id)];
  }
  const topic = input.topic?.trim().slice(0, TEAM_CALL_LIMITS.maxTopicChars) || null;
  const call = await ctx.rls(async (tx) => {
    const created = await repos.teamCalls.create(tx, ctx.businessId, { kind: input.kind, agentIds, topic, startedBy: ctx.userId });
    await emit(tx, ctx, { type: "team_call.started", payload: { callId: created.id, kind: created.kind, agentIds, topic } });
    await audit(tx, ctx, { action: "team_call.start", target: { kind: "team_call", id: created.id }, details: { kind: created.kind, agentCount: agentIds.length } });
    return created;
  });
  await runRound(ctx, call.id, "opening");
  return getTeamCall(ctx, call.id);
}

export interface SayInput {
  callId: string;
  text: string;
  via: "spoken" | "typed";
  clientTurnId: string;
}

export async function sayOnTeamCall(ctx: BusinessContext, input: SayInput): Promise<TeamCallRoundView> {
  const text = input.text.trim().slice(0, TEAM_CALL_LIMITS.maxFounderChars);
  if (!text) throw new ValidationError("Say something first");
  const appended = await ctx.rls((tx) =>
    repos.teamCalls.appendTurns(tx, ctx.businessId, input.callId, [{ speaker: "founder", userId: ctx.userId, text, via: input.via, clientTurnId: input.clientTurnId }]),
  );
  const founderTurn = appended.turns[0]!;
  if (appended.replayedTurnIds.length > 0) {
    // A retry of a send that already got its answer: the agents' turns after it, without a second model call.
    const turns = await ctx.rls((tx) => repos.teamCalls.turns(tx, ctx.businessId, input.callId));
    const after = turns.filter((t) => t.seq > founderTurn.seq);
    const next = after.findIndex((t) => t.speaker === "founder");
    const replies = (next === -1 ? after : after.slice(0, next)).map(toTurnView);
    if (replies.length > 0) return { founderTurn: toTurnView(founderTurn), turns: replies, handBack: true, agentRoundsSinceFounder: appended.call.agentRoundsSinceFounder };
  }
  const round = await runRound(ctx, input.callId, "founder_spoke");
  return { ...round, founderTurn: toTurnView(founderTurn) };
}

export async function continueTeamCall(ctx: BusinessContext, callId: string): Promise<TeamCallRoundView> {
  return runRound(ctx, callId, "continue");
}

/** One round of the turn director: read the call, ask the model outside any transaction, finalise, store the turns. */
async function runRound(ctx: BusinessContext, callId: string, mode: TeamCallTurnMode): Promise<TeamCallRoundView> {
  const loaded = await ctx.rls(async (tx) => {
    const [call, turns, roster, brief] = await Promise.all([repos.teamCalls.get(tx, ctx.businessId, callId), repos.teamCalls.turns(tx, ctx.businessId, callId), rosterOf(tx, ctx.businessId), briefOf(tx, ctx.businessId)]);
    return { call, turns, roster, brief };
  });
  const { call, turns, roster } = loaded;
  const handBack = (rounds: number): TeamCallRoundView => ({ founderTurn: null, turns: [], handBack: true, agentRoundsSinceFounder: rounds });
  if (call.status !== "live") throw new ConflictError("This call has ended", { callId });
  if (mode === "continue" && call.agentRoundsSinceFounder >= TEAM_CALL_LIMITS.agentRoundsWithoutFounder) return handBack(call.agentRoundsSinceFounder);
  // The call's spend ceiling: rounds and turns are bounded, past them the team holds and asks to end the call.
  if (modelRoundsOf(turns) >= TEAM_CALL_LIMITS.maxModelRoundsPerCall || call.turnCount + TEAM_CALL_LIMITS.maxTurnsPerRound > TEAM_CALL_LIMITS.maxTurnsPerCall) {
    if (mode === "continue") return handBack(call.agentRoundsSinceFounder);
    throw new ConflictError(CALL_ROUNDS_USED, { callId });
  }
  const agents = callAgents(call, roster);
  if (agents.length === 0) throw new ConflictError("Nobody from the team is on this call any more", { callId });
  const input = {
    business: { name: ctx.business.name, currency: ctx.business.currency, stage: "project" },
    founderName: await founderNameOf(ctx),
    participants: agents.map((a) => promptParticipant(ctx, a, roster)),
    kind: call.kind,
    mode,
    topic: call.topic,
    brief: loaded.brief.brief,
    transcript: transcriptOf(turns),
    agentRoundsSinceFounder: call.agentRoundsSinceFounder,
    glossary: (ctx.business as { glossary?: Record<string, string> }).glossary ?? undefined,
  };
  const request = buildTeamCallTurnRequest(input);
  const result = await ctx.models.complete({ ...request, attribution: { businessId: ctx.businessId, kind: TEAM_CALL_TURN_USAGE_KIND }, scope: `team_call:${callId}` });
  const final = finaliseTeamCallTurns(result.json, teamCallTurnsContext(input));
  const at = new Date();
  try {
    const stored = await ctx.rls((tx) =>
      repos.teamCalls.appendTurns(
        tx,
        ctx.businessId,
        callId,
        final.turns.map((t) => ({ speaker: "agent" as const, agentId: t.agentId, text: t.text, to: t.to })),
        { agentRound: mode === "continue", at },
      ),
    );
    const rounds = stored.call.agentRoundsSinceFounder;
    return { founderTurn: null, turns: stored.turns.map(toTurnView), handBack: final.handBack || rounds >= TEAM_CALL_LIMITS.agentRoundsWithoutFounder, agentRoundsSinceFounder: rounds };
  } catch (err) {
    // Two "Let the team discuss" rounds at once: the second finds the limit reached under the row lock and hands back.
    if (mode === "continue" && err instanceof ValidationError) return handBack(TEAM_CALL_LIMITS.agentRoundsWithoutFounder);
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------------------------------------------------

export async function speakTurn(ctx: BusinessContext, input: { callId: string; turnId: string }): Promise<TeamCallSpeechView> {
  const { turn, roster } = await ctx.rls(async (tx) => {
    const [turns, roster] = await Promise.all([repos.teamCalls.turns(tx, ctx.businessId, input.callId), rosterOf(tx, ctx.businessId)]);
    return { turn: turns.find((t) => t.id === input.turnId) ?? null, roster };
  });
  if (!turn || turn.speaker !== "agent" || !turn.agentId) throw new NotFoundError("Agent turn", input.turnId);
  const name = displayNameFor(ctx);
  const words = spokenText(turn.text, (id, stored) => {
    const agent = roster.all.find((a) => a.id === id);
    return agent ? name(agent) : stored;
  });
  const speechAccent = roster.accents.get(turn.agentId) ?? roster.accents.values().next().value!;
  const spoken = await synthesizeCallSpeech({ env: ctx.env, gateway: ctx.gateway }, { businessId: ctx.businessId, callId: input.callId, turnId: turn.id, speechAccent, text: words.slice(0, TEAM_CALL_LIMITS.maxTurnChars) || "…" });
  return { turnId: turn.id, speechAccent, mime: spoken.mime, base64: spoken.base64, simulated: spoken.simulated, spokenText: words };
}

/** A short fixed sentence in one accent, for Accent on the agent's profile ("Hear it"). */
export const ACCENT_PREVIEW_LINE = "Hi, this is how I sound on our calls.";

export async function previewSpeechAccent(ctx: BusinessContext, input: { agentId: string; speechAccent: string }): Promise<Omit<TeamCallSpeechView, "turnId">> {
  await ctx.rls((tx) => repos.agents.get(tx, ctx.businessId, input.agentId));
  const spoken = await synthesizeCallSpeech({ env: ctx.env, gateway: ctx.gateway }, { businessId: ctx.businessId, callId: input.agentId, turnId: input.agentId, speechAccent: input.speechAccent, text: ACCENT_PREVIEW_LINE });
  return { speechAccent: input.speechAccent, mime: spoken.mime, base64: spoken.base64, simulated: spoken.simulated, spokenText: ACCENT_PREVIEW_LINE };
}

export async function setSpeechAccent(ctx: BusinessContext, input: { agentId: string; speechAccent: string | null }) {
  return ctx.rls(async (tx) => {
    const agent = await repos.agents.setSpeechAccent(tx, ctx.businessId, input.agentId, input.speechAccent);
    await audit(tx, ctx, { action: "agent.speech_accent_set", target: { kind: "agent", id: agent.id }, details: { speechAccent: input.speechAccent } });
    const roster = await rosterOf(tx, ctx.businessId);
    return { agentId: agent.id, speechAccent: roster.accents.get(agent.id)!, chosen: agent.speechAccent ?? null };
  });
}

/** Each live agent's accent and its default, for the profile's Accent picker and the Team call lobby. */
export async function speechAccentsOf(ctx: BusinessContext): Promise<{ agentId: string; speechAccent: string; defaultSpeechAccent: string; chosen: string | null }[]> {
  const roster = await ctx.rls((tx) => rosterOf(tx, ctx.businessId));
  const defaults = assignSpeechAccents(roster.all.map((a) => ({ ...a, speechAccent: null })));
  return roster.visible.map((a) => ({ agentId: a.id, speechAccent: roster.accents.get(a.id)!, defaultSpeechAccent: defaults.get(a.id)!, chosen: a.speechAccent ?? null }));
}

export async function transcribeOnCall(ctx: BusinessContext, input: { callId: string; mime: TeamCallAudioMime; base64: string }): Promise<TeamCallTranscriptView> {
  const call = await ctx.rls((tx) => repos.teamCalls.get(tx, ctx.businessId, input.callId));
  if (call.status !== "live") throw new ConflictError("This call has ended", { callId: input.callId });
  if (Math.floor((input.base64.length * 3) / 4) > TEAM_CALL_LIMITS.maxAudioBytes) throw new ValidationError("That recording is too long. Try a shorter one, or type instead.");
  const heard = await transcribeCallSpeech({ env: ctx.env, gateway: ctx.gateway }, { businessId: ctx.businessId, callId: input.callId, mime: input.mime, base64: input.base64 });
  return { text: heard.text.slice(0, TEAM_CALL_LIMITS.maxFounderChars), simulated: heard.simulated };
}

// ---------------------------------------------------------------------------------------------------------------------
// End: the wrap-up and the filing
// ---------------------------------------------------------------------------------------------------------------------

interface Sorted {
  index: number;
  title: string;
  detail: string | null;
  agentId: string | null;
  evaluation: ActionEvaluation;
  route: "file" | "stage" | "refuse";
  reason: string | null;
}

/** Where one wrap-up action goes, by what it is, policy and the person's section walls. */
export function routeOf(e: ActionEvaluation, mayWrite: (section: NonNullable<ReturnType<typeof planActionSection>>) => boolean): { route: Sorted["route"]; reason: string | null } {
  const section = planActionSection(e.action);
  if (section && !mayWrite(section)) return { route: "refuse", reason: "You cannot change this part of the project, so it was not filed. Someone who can will see it in the call's notes." };
  if (e.outcome === "deny") return { route: "refuse", reason: e.reasons[0] ?? "The rules for what the team can do do not allow this." };
  if (FILED_AT_ONCE.has(e.action.type) && e.outcome === "allow") return { route: "file", reason: null };
  return { route: "stage", reason: e.reasons[0] ?? "Waiting for your go-ahead." };
}

/** What a run action points at (a task, a roadmap item), else its plan. */
function targetOf(plan: PlanWithActions, actionId: string | undefined): { kind: TeamCallTargetKind; id: string } {
  const row = plan.actions.find((a) => a.id === actionId);
  const result = (row?.result ?? {}) as Record<string, unknown>;
  if (typeof result.taskId === "string") return { kind: "task", id: result.taskId };
  if (typeof result.roadmapItemId === "string") return { kind: "roadmap_item", id: result.roadmapItemId };
  return { kind: "plan", id: plan.id };
}

export async function endTeamCall(ctx: BusinessContext, callId: string): Promise<TeamCallView> {
  const claimed = await ctx.rls((tx) => repos.teamCalls.claimWrapUp(tx, ctx.businessId, callId));
  if (!claimed) {
    const call = await ctx.rls((tx) => repos.teamCalls.get(tx, ctx.businessId, callId));
    if (call.status === "ended") return getTeamCall(ctx, callId);
    throw new ConflictError("This call is already being written up", { callId });
  }
  try {
    return await wrapUp(ctx, callId);
  } catch (err) {
    // Nothing said is lost: the call is live again and can be ended once more.
    await ctx.rls((tx) => repos.teamCalls.reopenAfterFailedWrapUp(tx, ctx.businessId, callId)).catch((e: unknown) => ctx.log.warn({ err: (e as Error).message, callId }, "team call: reopen after a failed wrap-up failed"));
    throw err;
  }
}

async function wrapUp(ctx: BusinessContext, callId: string): Promise<TeamCallView> {
  const loaded = await ctx.rls(async (tx) => {
    const [call, turns, roster, brief] = await Promise.all([repos.teamCalls.get(tx, ctx.businessId, callId), repos.teamCalls.turns(tx, ctx.businessId, callId), rosterOf(tx, ctx.businessId), briefOf(tx, ctx.businessId)]);
    return { call, turns, roster, brief };
  });
  const { call, turns, roster } = loaded;
  const said = turns.some((t) => t.speaker === "founder");
  let summary = "";
  let finalActions: { title: string; detail: string | null; agentId: string | null; action: PlanAction }[] = [];
  if (said) {
    const input = {
      business: { name: ctx.business.name, currency: ctx.business.currency, stage: "project" },
      founderName: await founderNameOf(ctx),
      participants: callAgents(call, roster).map((a) => promptParticipant(ctx, a, roster)),
      kind: call.kind,
      topic: call.topic,
      brief: loaded.brief.brief,
      transcript: transcriptOf(turns),
      agents: roster.visible.map((a) => ({ id: a.id, name: displayNameFor(ctx)(a), role: a.role, departmentName: roster.departments.find((d) => d.id === a.departmentIds[0])?.name ?? null, channel: getTemplateByAgentType(a.agentType)?.channelKey ?? null })),
      departments: roster.departments.map((d) => ({ name: d.name, module: d.moduleKeys[0] ?? null })),
      roadmap: loaded.brief.roadmap.map((r) => ({ id: r.id, title: r.title, horizon: r.horizon })),
    };
    const request = buildTeamCallWrapUpRequest(input);
    const result = await ctx.models.complete({ ...request, attribution: { businessId: ctx.businessId, kind: TEAM_CALL_WRAP_UP_USAGE_KIND }, scope: `team_call:${callId}` });
    const final = finaliseTeamCallWrapUp(result.json, teamCallWrapUpContext(input));
    summary = final.summary;
    finalActions = final.actions.slice(0, TEAM_CALL_LIMITS.maxActionsPerCall);
  } else {
    summary = "You ended the call before anything was discussed, so there is nothing to file.";
  }

  const planCtx = await planContextFor(ctx);
  const actions = ownAgentsOnly(
    finalActions.map((a) => ({ ...a.action, agent_id: a.agentId ?? a.action.agent_id ?? null })),
    planCtx.agents,
  );
  const evaluations = evaluatePlan(actions, planCtx);
  const sorted: Sorted[] = evaluations.map((e, index) => ({
    index,
    title: finalActions[index]!.title,
    detail: finalActions[index]!.detail,
    agentId: e.action.agent_id ?? null,
    evaluation: e,
    ...routeOf(e, (section) => hasSectionAccess(ctx.membership, section, "write")),
  }));
  const filed = sorted.filter((s) => s.route === "file");
  const staged = sorted.filter((s) => s.route === "stage");
  const chief = roster.chief ?? callAgents(call, roster)[0] ?? null;
  const durationSeconds = Math.max(0, Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000));

  const written = await ctx.rls(async (tx) => {
    const filedPlan = filed.length
      ? await repos.plans.create(tx, ctx.businessId, { origin: "team_call", summaryMd: `What you agreed on your team call: ${filed.map((s) => s.title).join("; ")}`.slice(0, 4000), inboxItemId: null, status: "executing", actions: filed.map((s) => stagedAction(s.evaluation)) })
      : null;
    const exec = filedPlan ? await executePlanActions(tx, ctx.businessId, filedPlan, { actorUserId: ctx.userId, temporal: ctx.temporal, currency: planCtx.currency, availability: ctx }) : null;
    const filedAfter = filedPlan ? await repos.plans.get(tx, ctx.businessId, filedPlan.id) : null;

    const lines = sorted.map((s) => `- ${s.title}${s.route === "stage" ? ` (${TEAM_CALL_WORDS.awaiting.toLowerCase()})` : s.route === "refuse" ? ` (${TEAM_CALL_WORDS.notFiled.toLowerCase()})` : ""}`);
    const statuses = sorted.map((s) => ({ status: statusOf(s) }));
    const note = chief
      ? await repos.inbox.createItem(tx, ctx.businessId, {
          type: "update",
          from_agent_id: chief.id,
          subject: call.kind === "team" ? "Notes from your team call" : "Notes from your call",
          body_md: [summary, "", teamCallActionsLine(statuses), ...(lines.length ? ["", ...lines] : [])].join("\n").slice(0, 8000),
          status_strip: [],
          exhibit: { kind: "none", spec_ref: null },
          decision: null,
          blocks_continue: false,
          source_event_ids: [],
          entity_ids: [],
        })
      : null;
    // What needs the go-ahead waits on the note, where the Inbox offers the confirmation (`repos.plans.forInboxItem`).
    const stagedPlan = staged.length
      ? await repos.plans.create(tx, ctx.businessId, { origin: "team_call", summaryMd: `From your team call, waiting for your go-ahead: ${staged.map((s) => s.title).join("; ")}`.slice(0, 4000), inboxItemId: note?.id ?? null, status: "pending_confirmation", actions: staged.map((s) => stagedAction(s.evaluation)) })
      : null;

    const rows = sorted.map((s) => {
      const action = s.evaluation.action;
      const departmentId = departmentOf(s, roster, filedAfter, filed);
      const base = { actionType: action.type, title: s.title.slice(0, 200), detail: s.detail?.slice(0, 1000) ?? null, departmentId, agentId: s.agentId, status: statusOf(s) };
      if (s.route === "file" && filedAfter) {
        const planAction = filedAfter.actions[filed.indexOf(s)];
        return { ...base, target: targetOf(filedAfter, planAction?.id), planId: filedAfter.id, planActionId: planAction?.id ?? null, reason: null };
      }
      if (s.route === "stage" && stagedPlan) {
        const planAction = stagedPlan.actions[staged.indexOf(s)];
        return { ...base, target: { kind: "plan" as const, id: stagedPlan.id }, planId: stagedPlan.id, planActionId: planAction?.id ?? null, reason: s.reason };
      }
      return { ...base, target: undefined, planId: null, planActionId: null, reason: s.reason };
    });
    const finished = await repos.teamCalls.finish(tx, ctx.businessId, callId, { summary: summary.slice(0, 4000), actions: rows });
    const counts = { filedCount: rows.filter((r) => r.status === "filed" || r.status === "founder_step").length, awaitingCount: rows.filter((r) => r.status === "awaiting_go_ahead").length };
    await emit(tx, ctx, { type: "team_call.ended", payload: { callId, kind: call.kind, turnCount: finished.call.turnCount, actionCount: rows.length, ...counts, durationSeconds } });
    if (note && chief) await emit(tx, ctx, { type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: note.id, type: note.type, fromAgentId: chief.id, subject: note.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
    await audit(tx, ctx, { action: "team_call.end", target: { kind: "team_call", id: callId }, details: { actionCount: rows.length, ...counts, filedPlanId: filedPlan?.id ?? null, stagedPlanId: stagedPlan?.id ?? null, noteId: note?.id ?? null } });
    return { exec, filedPlan: filedAfter };
  });

  // What the orchestrator runs (a spec suggestion, a change to an existing roadmap item) is handed over after commit.
  if (written.exec?.needsOrchestrator && written.filedPlan) {
    const dispatch = await dispatchPlan(ctx.temporal, ctx.businessId, written.filedPlan.id).catch((e: unknown) => {
      ctx.log.warn({ err: (e as Error).message, callId }, "team call: plan dispatch failed; it is retried on the next decision or Continue");
      return null;
    });
    if (dispatch?.queued) await repos.plans.setWorkflowId(ctx.db, ctx.businessId, written.filedPlan.id, dispatch.workflowId);
    else await redispatchPlans(ctx).catch(() => undefined);
  }
  return getTeamCall(ctx, callId);
}

function statusOf(s: Pick<Sorted, "route" | "evaluation">): TeamCallActionStatus {
  if (s.route === "refuse") return "not_filed";
  if (s.route === "stage") return "awaiting_go_ahead";
  return s.evaluation.action.type === "request_human_action" ? "founder_step" : "filed";
}

/** The department that does an action: the task's (as the plan wrote it), else the acting agent's first. */
function departmentOf(s: Sorted, roster: Roster, filedPlan: PlanWithActions | null, filed: readonly Sorted[]): string | null {
  if (s.route === "file" && filedPlan) {
    const result = (filedPlan.actions[filed.indexOf(s)]?.result ?? {}) as Record<string, unknown>;
    if (typeof result.departmentId === "string") return result.departmentId;
  }
  if (s.evaluation.action.type === "update_roadmap" || s.evaluation.action.type === "update_spec") {
    return roster.departments.find((d) => d.moduleKeys.includes("product"))?.id ?? null;
  }
  const agent = s.agentId ? roster.all.find((a) => a.id === s.agentId) : null;
  return agent?.departmentIds[0] ?? null;
}
