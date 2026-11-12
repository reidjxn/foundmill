/**
 * team_calls + team_call_turns + team_call_actions (0084; docs/TEAM_CALL.md §2): a spoken call between the founder and
 * their team (or one agent), its turns in speaking order and the action items filed when it ends.
 *
 * The api runs every call inside `withRls` as the signed-in member (members write, viewers and example viewers read
 * only; the Team section wall is the api's). Turns and action items are only ever inserted; a call's row changes only
 * through `appendTurns` (its counters), `claimWrapUp`, `finish` and `reopenAfterFailedWrapUp` (its status), which is all
 * the column grants let an app role change.
 *
 * - **Order.** `appendTurns` locks the call's row (`for update`) and numbers the new turns after the call's highest
 *   `seq`, so two sends at once never share a number and the transcript reads in one order everywhere.
 * - **Retries.** A founder turn carries the client's id (`clientTurnId`, unique per call): a repeated send returns the
 *   turn already written and writes nothing, even after the call moved on.
 * - **Limits.** A call that is not live takes no new turn, and none past `TEAM_CALL_LIMITS.maxTurnsPerCall`; an
 *   agent-only round (`{ agentRound: true }`) is refused once `agentRoundsWithoutFounder` rounds ran since the founder
 *   last spoke, checked under the same lock, so two "Let the team discuss" rounds at once cannot both pass.
 * - **Counters.** `turn_count` grows by the turns written; `agent_rounds_since_founder` is 0 again when a founder turn is
 *   written and grows by one per agent-only round.
 * - **Ending.** `claimWrapUp` is one conditional update (`live → wrapping_up`), so only one request writes the wrap-up;
 *   `finish` (`wrapping_up → ended`) writes the summary and the action items together; a wrap-up that failed goes back
 *   to `live` with `reopenAfterFailedWrapUp`, so nothing said is lost.
 */
import { PLAN_ACTION_TYPES, TEAM_CALL_ACTION_STATUSES, TEAM_CALL_KINDS, TEAM_CALL_LIMITS, TEAM_CALL_TARGET_KINDS, uuid, ValidationError } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { planActions, plans, TEAM_CALL_TURN_VIA, teamCallActions, teamCalls, teamCallTurns, type NewTeamCallAction, type TeamCall, type TeamCallAction, type TeamCallTurn } from "../schema";
import { assertAgentsOwned, assertDepartmentsOwned } from "./_refs";
import { Id, one, parseInput, type Executor } from "./_shared";

/** Longest client id a founder turn may carry. */
export const TEAM_CALL_CLIENT_TURN_ID_MAX = 64;
/** Longest summary a finished call stores. */
export const TEAM_CALL_SUMMARY_MAX = 4000;

const nullIfEmpty = (v: string | null | undefined): string | null => (v ? v : null);

export const CreateTeamCallInput = z
  .object({
    kind: z.enum(TEAM_CALL_KINDS),
    /** In tile order; every id an agent of this business (which are active is the api's call). */
    agentIds: z.array(Id).min(1).max(TEAM_CALL_LIMITS.maxAgentsInTeamCall),
    topic: z.string().trim().max(TEAM_CALL_LIMITS.maxTopicChars).nullish().transform(nullIfEmpty),
    /** The person starting the call. */
    startedBy: Id.nullable(),
  })
  .superRefine((c, ctx) => {
    if (c.kind === "one_to_one" && c.agentIds.length !== 1) ctx.addIssue({ code: "custom", message: "a one-to-one call has exactly one agent", path: ["agentIds"] });
    if (new Set(c.agentIds.map((a) => a.toLowerCase())).size !== c.agentIds.length) ctx.addIssue({ code: "custom", message: "an agent is on a call once", path: ["agentIds"] });
  });
export type CreateTeamCallInput = z.input<typeof CreateTeamCallInput>;

/** The shared `TeamCallAddressee`: the founder, the whole team, or one teammate. */
export const TeamCallAddresseeInput = z.union([z.literal("founder"), z.literal("team"), z.object({ agentId: Id }).strict()]);

export const FounderTurnInput = z.object({
  speaker: z.literal("founder"),
  userId: Id,
  text: z.string().trim().min(1).max(TEAM_CALL_LIMITS.maxFounderChars),
  via: z.enum(TEAM_CALL_TURN_VIA),
  clientTurnId: z.string().trim().min(1).max(TEAM_CALL_CLIENT_TURN_ID_MAX).nullish(),
});
export const AgentTurnInput = z.object({
  speaker: z.literal("agent"),
  /** One of the call's agents. */
  agentId: Id,
  text: z.string().trim().min(1).max(TEAM_CALL_LIMITS.maxTurnChars),
  to: TeamCallAddresseeInput.nullish(),
});
export const AppendTurnInput = z.discriminatedUnion("speaker", [FounderTurnInput, AgentTurnInput]);
export type AppendTurnInput = z.input<typeof AppendTurnInput>;
/** One round at most: the founder's turn and the director's replies. */
const AppendTurnsInput = z.array(AppendTurnInput).min(1).max(TEAM_CALL_LIMITS.maxTurnsPerRound + 1);

export interface AppendTurnsOptions {
  /** The turns are an agent-only round ("Let the team discuss"): `agent_rounds_since_founder` grows by one. */
  agentRound?: boolean;
  /** When the first turn was said (later ones a millisecond apart). Defaults to now. */
  at?: Date;
}

export interface AppendTurnsResult {
  /** The call after the append (its counters). */
  call: TeamCall;
  /** One per input, in input order: the turn written, or the one already written for a repeated `clientTurnId`. */
  turns: TeamCallTurn[];
  /** Ids of the returned turns that were already on the call (a retried send); nothing was written for them. */
  replayedTurnIds: string[];
}

export const TeamCallActionInput = z
  .object({
    actionType: z.enum(PLAN_ACTION_TYPES),
    title: z.string().trim().min(1).max(200),
    detail: z.string().trim().max(1000).nullish().transform(nullIfEmpty),
    departmentId: Id.nullish(),
    agentId: Id.nullish(),
    status: z.enum(TEAM_CALL_ACTION_STATUSES),
    /** The created task or roadmap item, else the plan; null when nothing was created. */
    target: z.object({ kind: z.enum(TEAM_CALL_TARGET_KINDS), id: Id }).nullish(),
    planId: Id.nullish(),
    planActionId: Id.nullish(),
    reason: z.string().trim().max(500).nullish().transform(nullIfEmpty),
  })
  .strict();
export type TeamCallActionInput = z.input<typeof TeamCallActionInput>;

export const FinishTeamCallInput = z.object({
  summary: z.string().trim().max(TEAM_CALL_SUMMARY_MAX).nullish().transform(nullIfEmpty),
  actions: z.array(TeamCallActionInput).max(TEAM_CALL_LIMITS.maxActionsPerCall),
});
export type FinishTeamCallInput = z.input<typeof FinishTeamCallInput>;

export const ListTeamCallsInput = z.object({ limit: z.number().int().min(1).max(100).default(20) });
export type ListTeamCallsInput = z.input<typeof ListTeamCallsInput>;

/** A call in the lobby's list: the row and what its wrap-up filed. `turnCount` is the row's own. */
export type TeamCallSummaryRow = TeamCall & {
  actionCount: number;
  filedCount: number;
  awaitingCount: number;
};

const scoped = (businessId: string, callId: string) => and(eq(teamCalls.businessId, businessId), eq(teamCalls.id, callId));

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Every plan and plan action named is this business's (their foreign keys do not ask which business). */
async function assertPlansOwned(db: Executor, businessId: string, planIds: string[], planActionIds: string[]): Promise<void> {
  const distinct = (ids: string[]) => [...new Set(ids)];
  const wantedPlans = distinct(planIds);
  if (wantedPlans.length) {
    const have = new Set((await db.select({ id: plans.id }).from(plans).where(and(eq(plans.businessId, businessId), inArray(plans.id, wantedPlans)))).map((r) => r.id));
    const missing = wantedPlans.filter((id) => !have.has(id));
    if (missing.length) throw new ValidationError("planId must be a plan of this business", { planId: missing });
  }
  const wantedActions = distinct(planActionIds);
  if (wantedActions.length) {
    const have = new Set((await db.select({ id: planActions.id }).from(planActions).where(and(eq(planActions.businessId, businessId), inArray(planActions.id, wantedActions)))).map((r) => r.id));
    const missing = wantedActions.filter((id) => !have.has(id));
    if (missing.length) throw new ValidationError("planActionId must be a plan action of this business", { planActionId: missing });
  }
}

export const teamCallsRepo = {
  /** Starts a call (`live`, no turns yet). Every agent id must be an agent of this business. */
  async create(db: Executor, businessId: string, input: CreateTeamCallInput): Promise<TeamCall> {
    const c = parseInput(CreateTeamCallInput, input, "team call");
    await assertAgentsOwned(db, businessId, c.agentIds, "agentIds");
    const [row] = await db.insert(teamCalls).values({ businessId, kind: c.kind, agentIds: c.agentIds, topic: c.topic, startedBy: c.startedBy }).returning();
    return row!;
  },

  /** The call, or a NotFoundError (also for another business's call). */
  async get(db: Executor, businessId: string, callId: string): Promise<TeamCall> {
    const id = parseInput(Id, callId, "team call id");
    return one(await db.select().from(teamCalls).where(scoped(businessId, id)).limit(1), "team call", id);
  },

  /** The newest calls first, each with what its wrap-up filed (counts over its action items). */
  async list(db: Executor, businessId: string, input: ListTeamCallsInput = {}): Promise<TeamCallSummaryRow[]> {
    const { limit } = parseInput(ListTeamCallsInput, input, "team call list");
    const calls = await db.select().from(teamCalls).where(eq(teamCalls.businessId, businessId)).orderBy(desc(teamCalls.startedAt), desc(teamCalls.id)).limit(limit);
    if (calls.length === 0) return [];
    const counts = await db
      .select({
        callId: teamCallActions.callId,
        actionCount: sql<number>`count(*)::int`,
        filedCount: sql<number>`(count(*) filter (where ${teamCallActions.status} = 'filed'))::int`,
        awaitingCount: sql<number>`(count(*) filter (where ${teamCallActions.status} = 'awaiting_go_ahead'))::int`,
      })
      .from(teamCallActions)
      .where(and(eq(teamCallActions.businessId, businessId), inArray(teamCallActions.callId, calls.map((c) => c.id))))
      .groupBy(teamCallActions.callId);
    const byCall = new Map(counts.map((c) => [c.callId, c]));
    return calls.map((call) => {
      const c = byCall.get(call.id);
      return { ...call, actionCount: Number(c?.actionCount ?? 0), filedCount: Number(c?.filedCount ?? 0), awaitingCount: Number(c?.awaitingCount ?? 0) };
    });
  },

  /** The call's turns in speaking order (`seq`). With `limit`, the newest `limit` turns, still oldest first. */
  async turns(db: Executor, businessId: string, callId: string, options: { limit?: number } = {}): Promise<TeamCallTurn[]> {
    const id = parseInput(Id, callId, "team call id");
    const where = and(eq(teamCallTurns.businessId, businessId), eq(teamCallTurns.callId, id));
    if (options.limit === undefined) return db.select().from(teamCallTurns).where(where).orderBy(asc(teamCallTurns.seq));
    const limit = parseInput(z.number().int().min(1).max(TEAM_CALL_LIMITS.maxTurnsPerCall), options.limit, "turn limit");
    const rows = await db.select().from(teamCallTurns).where(where).orderBy(desc(teamCallTurns.seq)).limit(limit);
    return rows.reverse();
  },

  /**
   * Appends turns to a live call, numbered after its last one, under a row lock on the call. A founder turn whose
   * `clientTurnId` is already on the call is returned as it was written (nothing is written for it). Refused with a
   * ValidationError when the call is not live, when the turns would pass `maxTurnsPerCall`, when an agent turn names an
   * agent not on the call (or addresses one), or when an agent-only round would pass `agentRoundsWithoutFounder`.
   */
  async appendTurns(db: Executor, businessId: string, callId: string, turns: readonly AppendTurnInput[], options: AppendTurnsOptions = {}): Promise<AppendTurnsResult> {
    const id = parseInput(Id, callId, "team call id");
    const list = parseInput(AppendTurnsInput, turns, "call turns");
    const agentRound = options.agentRound === true;
    if (agentRound && list.some((t) => t.speaker === "founder")) throw new ValidationError("An agent-only round has no founder turn", { callId: id });
    const clientIds = list.flatMap((t) => (t.speaker === "founder" && t.clientTurnId ? [t.clientTurnId] : []));
    if (new Set(clientIds).size !== clientIds.length) throw new ValidationError("Each founder turn has its own client turn id", { clientTurnIds: clientIds });
    const at = options.at ?? new Date();

    return db.transaction(async (tx) => {
      const call = one(await tx.select().from(teamCalls).where(scoped(businessId, id)).limit(1).for("update"), "team call", id);

      const existing = clientIds.length
        ? await tx
            .select()
            .from(teamCallTurns)
            .where(and(eq(teamCallTurns.businessId, businessId), eq(teamCallTurns.callId, id), inArray(teamCallTurns.clientTurnId, clientIds)))
        : [];
      const byClient = new Map(existing.map((t) => [t.clientTurnId!, t]));
      const isReplay = (t: (typeof list)[number]) => t.speaker === "founder" && !!t.clientTurnId && byClient.has(t.clientTurnId);
      const fresh = list.filter((t) => !isReplay(t));
      const replayedTurnIds = existing.map((t) => t.id);
      if (fresh.length === 0) return { call, turns: list.map((t) => byClient.get((t as { clientTurnId: string }).clientTurnId)!), replayedTurnIds };

      if (call.status !== "live") throw new ValidationError("This call is not live, so nothing more can be said on it", { callId: id, status: call.status });
      if (call.turnCount + fresh.length > TEAM_CALL_LIMITS.maxTurnsPerCall) {
        throw new ValidationError("This call has reached its length: end it to file what was agreed", { callId: id, turnCount: call.turnCount, limit: TEAM_CALL_LIMITS.maxTurnsPerCall });
      }
      if (agentRound && call.agentRoundsSinceFounder >= TEAM_CALL_LIMITS.agentRoundsWithoutFounder) {
        throw new ValidationError("The team has talked it through: it is the founder's turn", { callId: id, agentRoundsSinceFounder: call.agentRoundsSinceFounder });
      }
      const onCall = (agentId: string) => call.agentIds.some((a) => sameId(a, agentId));
      for (const t of fresh) {
        if (t.speaker !== "agent") continue;
        if (!onCall(t.agentId)) throw new ValidationError("An agent turn is spoken by an agent on the call", { agentId: t.agentId });
        if (t.to && typeof t.to === "object" && !onCall(t.to.agentId)) throw new ValidationError("An agent turn addresses an agent on the call", { to: t.to.agentId });
      }

      const [last] = await tx
        .select({ seq: sql<number>`coalesce(max(${teamCallTurns.seq}), 0)::int` })
        .from(teamCallTurns)
        .where(and(eq(teamCallTurns.businessId, businessId), eq(teamCallTurns.callId, id)));
      const base = Number(last?.seq ?? 0);
      const rows = fresh.map((t, i) => {
        const createdAt = new Date(at.getTime() + i);
        return {
          id: uuid(),
          businessId,
          callId: id,
          seq: base + 1 + i,
          speaker: t.speaker,
          agentId: t.speaker === "agent" ? t.agentId : null,
          userId: t.speaker === "founder" ? t.userId : null,
          text: t.text,
          addressedTo: t.speaker === "agent" ? (t.to ?? null) : null,
          via: t.speaker === "founder" ? t.via : null,
          clientTurnId: t.speaker === "founder" ? (t.clientTurnId ?? null) : null,
          createdAt,
          updatedAt: createdAt,
        };
      });
      const inserted = await tx.insert(teamCallTurns).values(rows).returning();
      const founderSpoke = fresh.some((t) => t.speaker === "founder");
      const updated = one(
        await tx
          .update(teamCalls)
          .set({
            turnCount: sql`${teamCalls.turnCount} + ${fresh.length}`,
            agentRoundsSinceFounder: founderSpoke ? 0 : agentRound ? sql`${teamCalls.agentRoundsSinceFounder} + 1` : call.agentRoundsSinceFounder,
            updatedAt: new Date(),
          })
          .where(scoped(businessId, id))
          .returning(),
        "team call",
        id,
      );

      const byId = new Map(inserted.map((r) => [r.id, r]));
      let next = 0;
      const out = list.map((t) => (isReplay(t) ? byClient.get((t as { clientTurnId: string }).clientTurnId)! : byId.get(rows[next++]!.id)!));
      return { call: updated, turns: out, replayedTurnIds };
    });
  },

  /** `live → wrapping_up` in one conditional update: true for the one request that claimed it, false when not live. */
  async claimWrapUp(db: Executor, businessId: string, callId: string): Promise<boolean> {
    const id = parseInput(Id, callId, "team call id");
    const rows = await db
      .update(teamCalls)
      .set({ status: "wrapping_up", updatedAt: new Date() })
      .where(and(scoped(businessId, id), eq(teamCalls.status, "live")))
      .returning({ id: teamCalls.id });
    if (rows.length > 0) return true;
    await teamCallsRepo.get(db, businessId, id);
    return false;
  },

  /**
   * `wrapping_up → ended`: writes the summary, `ended_at` and the action items (in order, `position` 0, 1, 2…) together.
   * Refused (ValidationError) when the call is not being wrapped up; every agent, department, plan and plan action named
   * must be this business's.
   */
  async finish(db: Executor, businessId: string, callId: string, input: FinishTeamCallInput, options: { at?: Date } = {}): Promise<{ call: TeamCall; actions: TeamCallAction[] }> {
    const id = parseInput(Id, callId, "team call id");
    const f = parseInput(FinishTeamCallInput, input, "team call wrap-up");
    const at = options.at ?? new Date();
    return db.transaction(async (tx) => {
      await assertAgentsOwned(tx, businessId, f.actions.map((a) => a.agentId), "agentId");
      await assertDepartmentsOwned(tx, businessId, f.actions.map((a) => a.departmentId), "departmentId");
      await assertPlansOwned(
        tx,
        businessId,
        f.actions.flatMap((a) => (a.planId ? [a.planId] : [])),
        f.actions.flatMap((a) => (a.planActionId ? [a.planActionId] : [])),
      );
      const [ended] = await tx
        .update(teamCalls)
        .set({ status: "ended", summary: f.summary, endedAt: at, updatedAt: at })
        .where(and(scoped(businessId, id), eq(teamCalls.status, "wrapping_up")))
        .returning();
      if (!ended) {
        const call = await teamCallsRepo.get(tx, businessId, id);
        throw new ValidationError("Only a call being wrapped up can be finished", { callId: id, status: call.status });
      }
      if (f.actions.length === 0) return { call: ended, actions: [] };
      const rows: NewTeamCallAction[] = f.actions.map((a, position) => ({
        businessId,
        callId: id,
        position,
        actionType: a.actionType,
        title: a.title,
        detail: a.detail,
        departmentId: a.departmentId ?? null,
        agentId: a.agentId ?? null,
        status: a.status,
        targetKind: a.target?.kind ?? null,
        targetId: a.target?.id ?? null,
        planId: a.planId ?? null,
        planActionId: a.planActionId ?? null,
        reason: a.reason,
        createdAt: at,
        updatedAt: at,
      }));
      const actions = await tx.insert(teamCallActions).values(rows).returning();
      return { call: ended, actions: actions.sort((x, y) => x.position - y.position) };
    });
  },

  /** `wrapping_up → live` after a wrap-up that failed, so the call goes on and nothing said is lost. False when not wrapping up. */
  async reopenAfterFailedWrapUp(db: Executor, businessId: string, callId: string): Promise<boolean> {
    const id = parseInput(Id, callId, "team call id");
    const rows = await db
      .update(teamCalls)
      .set({ status: "live", updatedAt: new Date() })
      .where(and(scoped(businessId, id), eq(teamCalls.status, "wrapping_up")))
      .returning({ id: teamCalls.id });
    if (rows.length > 0) return true;
    await teamCallsRepo.get(db, businessId, id);
    return false;
  },

  /** The call's action items in wrap-up order. */
  async actions(db: Executor, businessId: string, callId: string): Promise<TeamCallAction[]> {
    const id = parseInput(Id, callId, "team call id");
    return db
      .select()
      .from(teamCallActions)
      .where(and(eq(teamCallActions.businessId, businessId), eq(teamCallActions.callId, id)))
      .orderBy(asc(teamCallActions.position));
  },
};
