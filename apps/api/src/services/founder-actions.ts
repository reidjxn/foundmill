/**
 * The founder's press on a founder-executed request (founder, 2026-11-22): "the agent never decides or calls submit and
 * pay. The founder's press does." An agent prepared the request and its one note (apps/gateway `founder-action.ts`);
 * this is the note's answer, decided in-process like the page note.
 *
 * Only a project founder (owner or cofounder), signed in, can press it: a collaborator, a member, an example visitor,
 * an agent, the Chief of Staff on vacation or in Automated mode, an email's one-click link and Today's quick tap all
 * fail before this runs (`vacationVerdict`, `autoDecideBlocking`, `oneClickOption`, `oneClickPlanAllowed`,
 * `quickAnswerFor`). The press asks the gateway to run it with a single-use token bound to the hash of the payload the
 * note showed; the gateway checks everything again and the api only reports what it answered, in plain words.
 * "This was simulated and not sent" is said whenever the gateway ran the recorded mock: a simulated result is never
 * reported as an action.
 */
import { repos, type InboxItem } from "@foundmill/db";
import { AppError, ConflictError, FOUNDER_ACTION_KEY_PREFIX, ForbiddenError, PATENT_REQUEST_NOTE, ValidationError, founderActionIdOfDecision, isOwnerRole, patentRequestNote } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { answerNote } from "./answer-note";
import type { DecideItemResult } from "./decide";
import type { GatewayFounderActionResult } from "./gateway";

export const FOUNDER_ACTION_FOUNDERS_ONLY = "Only the project's founders can press this: it is a request in their name.";

/** Refusals that leave the note open: the founder can fix what is missing and press again. */
const RETRYABLE: ReadonlySet<string> = new Set(["not_connected", "stopped", "could_not_check", "not_founder"]);

/**
 * Who presses it: an owner or a cofounder of this project, never an admin who is not a founder, a member, a collaborator
 * or an example visitor (founder, 2026-11-22: "the founder's one explicit press"). `isProjectFounder` (owner or admin) is wider and
 * stays for the notes that mean it.
 */
export const mayPressFounderAction = (ctx: Pick<BusinessContext, "role" | "membership">): boolean => isOwnerRole(ctx.role) && (ctx.membership as { source?: string }).source !== "example";

/** Whether a failed call to the gateway may have reached it and run: a timeout, a dropped connection or a server error, but not a refused connection. */
function mayHaveRun(e: unknown): boolean {
  if (!(e instanceof AppError)) return false;
  if (e.code === "gateway_unreachable") return !/ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(e.message);
  return e.status >= 500;
}

export async function decideFounderActionNote(ctx: BusinessContext, item: InboxItem, input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  const actionId = founderActionIdOfDecision(item.decision);
  if (!actionId) throw new ValidationError("This is not a founder request.", { itemId: item.id });
  if (!mayPressFounderAction(ctx)) throw new ForbiddenError(FOUNDER_ACTION_FOUNDERS_ONLY);
  const option = input.chosenOption;
  if (option !== PATENT_REQUEST_NOTE.options.run && option !== PATENT_REQUEST_NOTE.options.later) throw new ValidationError(`Choose "${PATENT_REQUEST_NOTE.runLabel}" or "${PATENT_REQUEST_NOTE.laterLabel}".`, { itemId: item.id });
  const action = await ctx.rls((tx) => repos.founderActions.forInboxItem(tx, ctx.businessId, item.id));
  if (!action || action.id !== actionId) throw new ConflictError("This request is not available any more.", { itemId: item.id, code: "founder_action_gone" });

  const answer = async (summary: string, result: Record<string, unknown>): Promise<DecideItemResult> => {
    const answered = await ctx.rls((tx) => answerNote(tx, ctx, item.id, option, null, item.fromAgentId, summary, { params: { founder_action_option: option }, result: { founderAction: action.id, ...result } }));
    if (answered) return { item: answered.item, decision: answered.decision, plan: answered.plan, evaluations: [], requiresConfirmation: false, executed: [answered.actionId], deferred: [], denied: [], dispatch: null, followUp: null };
    // The note was answered a moment ago (another tab). After a press that ran, the founder still gets what happened, never a conflict.
    if (option === PATENT_REQUEST_NOTE.options.run && result.status !== "not_now") {
      const settled = await ctx.rls(async (tx) => {
        const current = await repos.inbox.get(tx, ctx.businessId, item.id);
        const decision = (await repos.inbox.decisionsFor(tx, ctx.businessId, item.id))[0];
        const plan = decision?.planId ? await repos.plans.get(tx, ctx.businessId, decision.planId).catch(() => null) : null;
        return decision && plan ? { current, decision, plan } : null;
      });
      if (settled) return { item: settled.current, decision: settled.decision, plan: { ...settled.plan, summaryMd: summary }, evaluations: [], requiresConfirmation: false, executed: [], deferred: [], denied: [], dispatch: null, followUp: null };
      throw new ConflictError(summary, { itemId: item.id, code: "already_decided" });
    }
    throw new ConflictError("This note was answered a moment ago.", { itemId: item.id, code: "already_decided" });
  };

  if (option === PATENT_REQUEST_NOTE.options.later) {
    // Not now ends the request: it cannot be pressed later; an agent prepares a new one when the founder wants it.
    const done = await answer(PATENT_REQUEST_NOTE.later, { status: "not_now" });
    await repos.founderActions.voidOpen(ctx.db, ctx.businessId, action.id, "The founder said not now.");
    return done;
  }

  let outcome: GatewayFounderActionResult;
  try {
    if (!ctx.gateway.executeFounderAction) throw new Error("no gateway");
    outcome = await ctx.gateway.executeFounderAction({ businessId: ctx.businessId, actionId: action.id, userId: ctx.userId, payloadHash: action.payloadHash });
  } catch (e) {
    // A timeout, a dropped connection or a server error while the gateway may still be running it: the request may have gone out.
    if (mayHaveRun(e)) return answer(PATENT_REQUEST_NOTE.unknown, { status: "unknown" });
    // The gateway could not be reached at all, or refused the press itself (a bad token): nothing was sent, and the note stays open.
    throw new ConflictError(PATENT_REQUEST_NOTE.notSent("the request could not be reached just now. Try again in a moment."), { itemId: item.id, code: "founder_action_unreachable" });
  }
  switch (outcome.status) {
    case "executed":
      return answer(outcome.message, { status: "executed", simulated: outcome.simulated });
    case "voided":
      // The invention changed after the note was written: the gateway wrote a new request and note to check.
      return answer(outcome.message, { status: "voided", newActionId: outcome.newActionId });
    case "unknown":
      // The vendor call may have run: the note is answered so it cannot be pressed again, and the founder is told to check.
      return answer(PATENT_REQUEST_NOTE.unknown, { status: "unknown" });
    case "failed":
      return answer(PATENT_REQUEST_NOTE.notSent(`${outcome.reason}`), { status: "failed" });
    case "refused":
      if (RETRYABLE.has(outcome.code)) throw new ConflictError(PATENT_REQUEST_NOTE.notSent(outcome.reason), { itemId: item.id, code: `founder_action_${outcome.code}` });
      return answer(PATENT_REQUEST_NOTE.notSent(outcome.reason), { status: "refused", code: outcome.code });
  }
}

/**
 * Test support for the Playwright spec and the dev stack only (APP_ENV development or test; the router refuses anywhere
 * else): writes what the gateway's `prepare_founder_action` writes, with the recorded mock's invention, so a spec can
 * press a note without a running gateway. The note is the shared builder's, so it reads exactly as the real one does.
 */
export async function seedFounderActionNote(ctx: BusinessContext, input: { inventionId: string }): Promise<{ actionId: string; inboxItemId: string }> {
  const chief = await repos.agents.chiefOfStaff(ctx.db, ctx.businessId);
  const facts = { inventionId: input.inventionId, title: "Self-leveling bike rack hinge", refNum: "LB-2026-0042", contentHash: "e".repeat(64) };
  const note = patentRequestNote({ facts, founderName: null });
  const { action } = await repos.founderActions.prepare(ctx.db, ctx.businessId, { connectorKey: "lightbringer_mcp", tool: "request_patent_preparation", payload: { invention_id: input.inventionId }, summary: { title: note.subject, lines: note.lines, facts: { ...facts } }, preparedByAgentId: chief?.id ?? null });
  if (action.inboxItemId) return { actionId: action.id, inboxItemId: action.inboxItemId };
  const item = await repos.inbox.createItem(ctx.db, ctx.businessId, { type: "decision", from_agent_id: chief?.id ?? null, subject: note.subject, body_md: note.bodyMd, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: { options: note.options as never, free_text: false, expires_at: null, key: `${FOUNDER_ACTION_KEY_PREFIX}${action.id}` }, blocks_continue: false, source_event_ids: [], entity_ids: [] });
  await repos.founderActions.attachNote(ctx.db, ctx.businessId, action.id, item.id);
  return { actionId: action.id, inboxItemId: item.id };
}
