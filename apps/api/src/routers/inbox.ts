/** inbox.list/get/refresh/decide/markRead/archive + plan.preview/confirm/status (BUILD §11.3). */
import { InboxListFilter, isApprovalOption, repos } from "@foundmill/db";
import { ValidationError } from "@foundmill/shared";
import { z } from "zod";
import { approvalView } from "../services/approvals";
import { confirmPlan, decideInboxItem, planContextFor } from "../services/decide";
import { entityStubs, idsOfItem, inboxWalls, isWalled, loadRedactionSource, mentionIds, noteMask, redactDecisions, redactInboxItem, redactPlan, redactText } from "../services/inbox-redaction";
import { modelLimited } from "../services/model-limits";
import { compilePlan, evaluatePlan, requiresConfirmation } from "../services/plans";
import { Id, audit, router, sectionRead, sectionWrite } from "../trpc";

const inboxRead = sectionRead("inbox");
const inboxWrite = sectionWrite("inbox");

/**
 * A decision with free text (compiled into a plan by the model). Approve or Reject on an approval's item never reaches
 * the plan compiler: text with it is only the founder's reason.
 */
const hasFreeText = (input: unknown): boolean => typeof (input as { freeText?: unknown } | null)?.freeText === "string" && Boolean((input as { freeText: string }).freeText.trim()) && !isApprovalOption((input as { chosenOption?: string | null }).chosenOption);

export const inboxRouter = router({
  /** Notes follow the reader's Finance and CRM walls (services/inbox-redaction.ts; audit RUI-02). */
  list: inboxRead.input(InboxListFilter).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const [page, counts, blocking] = await Promise.all([repos.inbox.list(tx, ctx.businessId, input ?? {}), repos.inbox.countByTab(tx, ctx.businessId), repos.inbox.countBlocking(tx, ctx.businessId)]);
      const walls = inboxWalls(ctx.membership);
      const source = await loadRedactionSource(tx, ctx.businessId, walls, page.items.flatMap(idsOfItem));
      return { ...page, items: page.items.map((i) => redactInboxItem(i, source)), counts, blocking, continueState: blocking > 0 ? ({ kind: "blocked", count: blocking } as const) : ({ kind: "idle" } as const) };
    }),
  ),

  get: inboxRead.input(z.object({ itemId: Id })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const item = await repos.inbox.get(tx, ctx.businessId, input.itemId);
      const walls = inboxWalls(ctx.membership);
      const [decisions, plan, fromAgent, entities, source, approval] = await Promise.all([
        repos.inbox.decisionsFor(tx, ctx.businessId, item.id),
        repos.plans.forInboxItem(tx, ctx.businessId, item.id),
        item.fromAgentId ? repos.agents.get(tx, ctx.businessId, item.fromAgentId) : Promise.resolve(null),
        item.entityIds.length && !walls.crm ? repos.entities.byIds(tx, ctx.businessId, item.entityIds) : Promise.resolve([]),
        loadRedactionSource(tx, ctx.businessId, walls, idsOfItem(item)),
        approvalView(tx, ctx, item.id),
      ]);
      return { item: redactInboxItem(item, source), decisions: redactDecisions(decisions, source, noteMask(item)), plan: plan ? redactPlan(plan, source, noteMask(item)) : null, fromAgent, entities: entityStubs(entities, walls), approval };
    }),
  ),

  /** Exactly one new item (AC-11.3.2); the composer service, or the same logic in-process in development. One composer note per press, so it has an allowance (BILL-19). */
  refresh: inboxWrite.use(modelLimited("refresh")).mutation(async ({ ctx }) => {
    const result = await ctx.composer.refresh(ctx.businessId, { actorUserId: ctx.userId });
    await ctx.rls((tx) => audit(tx, ctx, { action: "inbox.refresh", target: { kind: "inbox_item", id: result.item.id }, details: { source: result.source, type: result.item.type } }));
    // The new note as this person may read it (the same walls as inbox.get).
    const walls = inboxWalls(ctx.membership);
    if (!isWalled(walls)) return result;
    const source = await ctx.rls((tx) => loadRedactionSource(tx, ctx.businessId, walls, idsOfItem(result.item)));
    return { ...result, item: redactInboxItem(result.item, source) };
  }),

  // Free text is compiled into a plan (a model call) and spends the planning allowance; choosing an option does not.
  decide: inboxWrite.input(z.object({ itemId: Id, chosenOption: z.string().max(40).nullable().optional(), freeText: z.string().max(4000).nullable().optional() })).use(modelLimited("plan", { when: hasFreeText })).mutation(({ ctx, input }) => decideInboxItem(ctx, input)),

  markRead: inboxRead.input(z.object({ itemId: Id })).mutation(({ ctx, input }) => ctx.rls((tx) => repos.inbox.markRead(tx, ctx.businessId, input.itemId))),

  archive: inboxWrite.input(z.object({ itemId: Id })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      // An agent's request still waiting for an answer is answered, not filed away: archived, nobody could approve or
      // reject it any more, and its task would wait on it for good.
      const approval = await repos.approvals.forInboxItem(tx, ctx.businessId, input.itemId);
      if (approval && approval.outcome === null) throw new ValidationError("Approve or reject this request: an agent is waiting on it.", { itemId: input.itemId, approvalId: approval.id });
      const item = await repos.inbox.archive(tx, ctx.businessId, input.itemId);
      await audit(tx, ctx, { action: "inbox.archive", target: { kind: "inbox_item", id: item.id } });
      return item;
    }),
  ),
});

export const planRouter = router({
  /**
   * Compile + policy check without writing anything ("Here is what will happen"). A model call each time, so it needs Inbox
   * write (viewers and advisors cannot loop it on the platform key) and spends the planning allowance (SEC-13).
   */
  preview: inboxWrite.input(z.object({ text: z.string().min(1).max(4000), inboxItemId: Id.optional() })).use(modelLimited("plan")).mutation(async ({ ctx, input }) => {
    const planCtx = await planContextFor(ctx);
    const compiled = await compilePlan(ctx.models, input.text, planCtx);
    const evaluations = evaluatePlan(compiled.actions, planCtx);
    return { summary: compiled.summary, source: compiled.source, evaluations, requiresConfirmation: requiresConfirmation(evaluations), hardGates: evaluations.filter((e) => e.hardGate).length };
  }),
  confirm: inboxWrite.input(z.object({ planId: Id })).mutation(({ ctx, input }) => confirmPlan(ctx, input.planId)),
  status: inboxRead.input(z.object({ planId: Id })).query(({ ctx, input }) => ctx.rls((tx) => repos.plans.status(tx, ctx.businessId, input.planId))),
  list: inboxRead.input(z.object({ status: z.enum(["pending_confirmation", "executing", "done", "failed"]).optional(), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const page = await repos.plans.list(tx, ctx.businessId, input);
      const walls = inboxWalls(ctx.membership);
      if (!isWalled(walls)) return page;
      const source = await loadRedactionSource(tx, ctx.businessId, walls, page.items.flatMap((p) => mentionIds(p.summaryMd)));
      return { ...page, items: page.items.map((p) => ({ ...p, summaryMd: redactText(p.summaryMd, source) })) };
    }),
  ),
});
