/**
 * chiefOfStaff.who / chiefOfStaff.answer: the Chief of Staff on every page (founder, Phase 3). `who` is the business's
 * Chief of Staff by stored name (null when it has none: the page hides the "Ask" control). `answer` replies to "What's
 * happening?", "What's blocking us?" and "Why am I seeing this?" in plain words from Today's own facts
 * (services/chief-of-staff.ts), with no model call. Any member; each part follows the reader's section access.
 */
import { z } from "zod";
import { CHIEF_PURPOSE_MAX, CHIEF_QUESTIONS } from "@foundmill/shared";
import { repos } from "@foundmill/db";
import { chiefOfStaffAnswer } from "../services/chief-of-staff";
import { businessProcedure, router } from "../trpc";

const Page = z.object({
  path: z.string().trim().min(1).max(300),
  screenId: z.string().trim().max(120).nullish(),
  area: z.string().trim().max(40).nullish(),
  purpose: z.string().trim().max(CHIEF_PURPOSE_MAX).nullish(),
});

export const chiefOfStaffRouter = router({
  who: businessProcedure.query(async ({ ctx }) => {
    const chief = await ctx.rls((tx) => repos.agents.chiefOfStaff(tx, ctx.businessId));
    return chief ? { id: chief.id, name: chief.name, role: chief.role || null, avatarSeed: chief.avatarSeed, personaKey: chief.personaKey ?? null, layer: chief.layer ?? null, departmentId: chief.departmentIds[0] ?? null } : null;
  }),
  answer: businessProcedure.input(z.object({ question: z.enum(CHIEF_QUESTIONS), page: Page })).query(({ ctx, input }) => chiefOfStaffAnswer(ctx, { question: input.question, page: input.page })),
});
