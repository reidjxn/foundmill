/**
 * Answer a decision note that is decided in-process, without the plan compiler (a sign-off of the product, Ready to start
 * selling, the Chief of Staff's goal): a one-action `reply_only` plan for the history (as an approval's answer is
 * recorded), the decision, and `decision.made`, inside the caller's transaction. Null when the note is gone or already
 * answered, so a second tab never records a second decision.
 */
import { repos, type DbTx, type Decision, type InboxItem, type PlanWithActions } from "@foundmill/db";
import type { BusinessContext } from "../trpc";
import { emit } from "../trpc";

export interface AnsweredNote {
  item: InboxItem;
  decision: Decision;
  plan: PlanWithActions;
  actionId: string;
}

export async function answerNote(
  tx: DbTx,
  ctx: BusinessContext,
  itemId: string | null,
  chosenOption: string,
  freeText: string | null,
  agentId: string | null,
  summary: string,
  record: { params?: Record<string, unknown>; result?: Record<string, unknown> } = {},
): Promise<AnsweredNote | null> {
  if (!itemId) return null;
  const item = await repos.inbox.get(tx, ctx.businessId, itemId).catch(() => null);
  if (!item || item.state === "answered" || item.state === "archived") return null;
  const plan = await repos.plans.create(tx, ctx.businessId, { origin: "option", summaryMd: summary, inboxItemId: item.id, status: "executing", actions: [{ type: "reply_only", params: { acknowledgement: summary, ...(record.params ?? {}) }, agentId, policyOutcome: "allow" }] });
  const decided = await repos.inbox.decide(tx, ctx.businessId, item.id, { chosenOption, freeText, decidedByKind: "user", decidedBy: ctx.userId, planId: plan.id });
  const action = plan.actions[0]!;
  await repos.plans.startAction(tx, ctx.businessId, action.id);
  await repos.plans.finishAction(tx, ctx.businessId, action.id, { status: "done", result: record.result ?? {} });
  await emit(tx, ctx, { type: "decision.made", payload: { decisionId: decided.decision.id, inboxItemId: item.id, chosenOption, freeText, decidedBy: "user", planId: plan.id, planActionCount: 1, hardGateActions: 0 } });
  return { item: decided.item, decision: decided.decision, plan: await repos.plans.get(tx, ctx.businessId, plan.id), actionId: action.id };
}
