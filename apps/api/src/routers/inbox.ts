/** inbox.list/get/refresh/decide/markRead/archive + plan.preview/confirm/status (BUILD §11.3). */
import { InboxListFilter, repos } from "@foundmill/db";
import { z } from "zod";
import { confirmPlan, decideInboxItem, planContextFor } from "../services/decide";
import { entityStubs, idsOfItem, inboxWalls, loadRedactionSource, noteAsSeenBy, noteMask, planSummariesAsSeenBy, redactDecisions, redactInboxItem, redactPlan } from "../services/inbox-redaction";
import { modelLimited } from "../services/model-limits";
import { compilePlan, evaluatePlan, requiresConfirmation } from "../services/plans";
import { Id, audit, emit, router, sectionRead, sectionWrite } from "../trpc";

const inboxRead = sectionRead("inbox");
const inboxWrite = sectionWrite("inbox");

/** A decision with free text (compiled into a plan by the model). */
const hasFreeText = (input: unknown): boolean => typeof (input as { freeText?: unknown } | null)?.freeText === "string" && Boolean((input as { freeText: string }).freeText.trim());

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
      const [decisions, plan, fromAgent, entities, source] = await Promise.all([
        repos.inbox.decisionsFor(tx, ctx.businessId, item.id),
        repos.plans.forInboxItem(tx, ctx.businessId, item.id),
        item.fromAgentId ? repos.agents.get(tx, ctx.businessId, item.fromAgentId) : Promise.resolve(null),
        item.entityIds.length && !walls.crm ? repos.entities.byIds(tx, ctx.businessId, item.entityIds) : Promise.resolve([]),
        loadRedactionSource(tx, ctx.businessId, walls, idsOfItem(item)),
      ]);
      return { item: redactInboxItem(item, source), decisions: redactDecisions(decisions, source, noteMask(item)), plan: plan ? redactPlan(plan, source, noteMask(item)) : null, fromAgent, entities: entityStubs(entities, walls) };
    }),
  ),

  /** Exactly one new item (AC-11.3.2); the composer service, or the same logic in-process in development. One composer note per press, so it has an allowance (BILL-19). */
  refresh: inboxWrite.use(modelLimited("refresh")).mutation(async ({ ctx }) => {
    const result = await ctx.composer.refresh(ctx.businessId, { actorUserId: ctx.userId });
    await ctx.rls((tx) => audit(tx, ctx, { action: "inbox.refresh", target: { kind: "inbox_item", id: result.item.id }, details: { source: result.source, type: result.item.type } }));
    // The new note as this person may read it (the same walls as inbox.get).
    return { ...result, item: await ctx.rls((tx) => noteAsSeenBy(tx, ctx.businessId, ctx.membership, result.item)) };
  }),

  // Free text is compiled into a plan (a model call) and spends the planning allowance; choosing an option does not.
  decide: inboxWrite.input(z.object({ itemId: Id, chosenOption: z.string().max(40).nullable().optional(), freeText: z.string().max(4000).nullable().optional() })).use(modelLimited("plan", { when: hasFreeText })).mutation(({ ctx, input }) => decideInboxItem(ctx, input)),

  markRead: inboxRead.input(z.object({ itemId: Id })).mutation(({ ctx, input }) => ctx.rls(async (tx) => noteAsSeenBy(tx, ctx.businessId, ctx.membership, await repos.inbox.markRead(tx, ctx.businessId, input.itemId)))),

  archive: inboxWrite.input(z.object({ itemId: Id })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const item = await repos.inbox.archive(tx, ctx.businessId, input.itemId);
      // Other members' open Inbox refetches on it (audit RUI-09: they acted on an item that was already gone).
      await emit(tx, ctx, { type: "inbox.item_updated", payload: { inboxItemId: item.id, change: "archived" } });
      await audit(tx, ctx, { action: "inbox.archive", target: { kind: "inbox_item", id: item.id } });
      return noteAsSeenBy(tx, ctx.businessId, ctx.membership, item);
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
  status: inboxRead.input(z.object({ planId: Id })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const status = await repos.plans.status(tx, ctx.businessId, input.planId);
      const [plan] = await planSummariesAsSeenBy(tx, ctx.businessId, ctx.membership, [status.plan]);
      return { ...status, plan: plan! };
    }),
  ),
  list: inboxRead.input(z.object({ status: z.enum(["pending_confirmation", "executing", "done", "failed"]).optional(), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const page = await repos.plans.list(tx, ctx.businessId, input);
      return { ...page, items: await planSummariesAsSeenBy(tx, ctx.businessId, ctx.membership, page.items) };
    }),
  ),
});
