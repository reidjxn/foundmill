/** inbox.list/get/refresh/decide/markRead/archive + plan.preview/confirm/status (BUILD §11.3). */
import { InboxListFilter, repos } from "@foundmill/db";
import { z } from "zod";
import { confirmPlan, decideInboxItem, planContextFor } from "../services/decide";
import { compilePlan, evaluatePlan, requiresConfirmation } from "../services/plans";
import { Id, audit, router, sectionRead, sectionWrite } from "../trpc";

const inboxRead = sectionRead("inbox");
const inboxWrite = sectionWrite("inbox");

export const inboxRouter = router({
  list: inboxRead.input(InboxListFilter).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const [page, counts, blocking] = await Promise.all([repos.inbox.list(tx, ctx.businessId, input ?? {}), repos.inbox.countByTab(tx, ctx.businessId), repos.inbox.countBlocking(tx, ctx.businessId)]);
      return { ...page, counts, blocking, continueState: blocking > 0 ? ({ kind: "blocked", count: blocking } as const) : ({ kind: "idle" } as const) };
    }),
  ),

  get: inboxRead.input(z.object({ itemId: Id })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const item = await repos.inbox.get(tx, ctx.businessId, input.itemId);
      const [decisions, plan, fromAgent, entities] = await Promise.all([
        repos.inbox.decisionsFor(tx, ctx.businessId, item.id),
        repos.plans.forInboxItem(tx, ctx.businessId, item.id),
        item.fromAgentId ? repos.agents.get(tx, ctx.businessId, item.fromAgentId) : Promise.resolve(null),
        item.entityIds.length ? repos.entities.byIds(tx, ctx.businessId, item.entityIds) : Promise.resolve([]),
      ]);
      return { item, decisions, plan, fromAgent, entities };
    }),
  ),

  /** Exactly one new item (AC-11.3.2); the composer service, or the same logic in-process in development. */
  refresh: inboxWrite.mutation(async ({ ctx }) => {
    const result = await ctx.composer.refresh(ctx.businessId, { actorUserId: ctx.userId });
    await ctx.rls((tx) => audit(tx, ctx, { action: "inbox.refresh", target: { kind: "inbox_item", id: result.item.id }, details: { source: result.source, type: result.item.type } }));
    return result;
  }),

  decide: inboxWrite.input(z.object({ itemId: Id, chosenOption: z.string().max(40).nullable().optional(), freeText: z.string().max(4000).nullable().optional() })).mutation(({ ctx, input }) => decideInboxItem(ctx, input)),

  markRead: inboxRead.input(z.object({ itemId: Id })).mutation(({ ctx, input }) => ctx.rls((tx) => repos.inbox.markRead(tx, ctx.businessId, input.itemId))),

  archive: inboxWrite.input(z.object({ itemId: Id })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const item = await repos.inbox.archive(tx, ctx.businessId, input.itemId);
      await audit(tx, ctx, { action: "inbox.archive", target: { kind: "inbox_item", id: item.id } });
      return item;
    }),
  ),
});

export const planRouter = router({
  /** Compile + policy check without writing anything ("Here is what will happen"). */
  preview: inboxRead.input(z.object({ text: z.string().min(1).max(4000), inboxItemId: Id.optional() })).mutation(async ({ ctx, input }) => {
    const planCtx = await planContextFor(ctx);
    const compiled = await compilePlan(ctx.models, input.text, planCtx);
    const evaluations = evaluatePlan(compiled.actions, planCtx);
    return { summary: compiled.summary, source: compiled.source, evaluations, requiresConfirmation: requiresConfirmation(evaluations), hardGates: evaluations.filter((e) => e.hardGate).length };
  }),
  confirm: inboxWrite.input(z.object({ planId: Id })).mutation(({ ctx, input }) => confirmPlan(ctx, input.planId)),
  status: inboxRead.input(z.object({ planId: Id })).query(({ ctx, input }) => ctx.rls((tx) => repos.plans.status(tx, ctx.businessId, input.planId))),
  list: inboxRead.input(z.object({ status: z.enum(["pending_confirmation", "executing", "done", "failed"]).optional(), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(({ ctx, input }) => ctx.rls((tx) => repos.plans.list(tx, ctx.businessId, input))),
});
