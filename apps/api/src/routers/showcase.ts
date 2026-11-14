/**
 * showcase.* — showcase videos of real projects (services/showcase.ts; migration 0103). Two sides, each a business
 * procedure checked again in the service:
 *   - the house (`HOUSE_BUSINESS_ID`), its owners only: `candidates`, `request`, `list`, `withdraw`;
 *   - a project, its founders only (an owner's standing): `ask` (their own ask and nothing of anyone else's),
 *     `answer`, `withdrawMine`, and the setting "Foundmill may ask to feature this project" (`setting.get` for any
 *     member, `setting.set` for the founders).
 */
import { SHOWCASE_ANSWERS } from "@foundmill/shared";
import { z } from "zod";
import { answerAsk, checkShowcaseShare, getSetting, listCandidates, listRequests, myAsk, requestShowcase, setSetting, withdrawByHouse, withdrawMine } from "../services/showcase";
import { Id, businessProcedure, router, sectionRead } from "../trpc";

export const showcaseRouter = router({
  candidates: businessProcedure.query(({ ctx }) => listCandidates(ctx)),
  list: businessProcedure.query(({ ctx }) => listRequests(ctx)),
  request: businessProcedure.input(z.object({ subjectBusinessId: Id })).mutation(({ ctx, input }) => requestShowcase(ctx, input)),
  withdraw: businessProcedure.input(z.object({ requestId: Id })).mutation(({ ctx, input }) => withdrawByHouse(ctx, input)),
  /** The house's Creative tab awaits this before it opens anything for a showcase post (any member who can read Distribution). */
  shareCheck: sectionRead("distribution").input(z.object({ assetId: Id })).mutation(({ ctx, input }) => checkShowcaseShare(ctx, input)),
  ask: businessProcedure.input(z.object({ consentId: Id.nullish(), inboxItemId: Id.nullish() })).query(({ ctx, input }) => myAsk(ctx, input)),
  answer: businessProcedure.input(z.object({ consentId: Id, answer: z.enum(SHOWCASE_ANSWERS) })).mutation(({ ctx, input }) => answerAsk(ctx, input)),
  withdrawMine: businessProcedure.input(z.object({ consentId: Id })).mutation(({ ctx, input }) => withdrawMine(ctx, input)),
  setting: router({
    get: businessProcedure.query(({ ctx }) => getSetting(ctx)),
    set: businessProcedure.input(z.object({ mayAsk: z.boolean() })).mutation(({ ctx, input }) => setSetting(ctx, input)),
  }),
});
