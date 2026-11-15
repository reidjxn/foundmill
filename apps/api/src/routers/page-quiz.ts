/**
 * pageQuiz.* — the optional quiz on a project's public page in the console (Product › Public page; services/page-quiz.ts)
 * — and publicQuiz.* — the signed-out read and the anonymous count behind it on `/p/<slug>`.
 *
 * - `pageQuiz.get`: any member with Product read.
 * - `pageQuiz.draft`, `pageQuiz.save`: Product write; the draft is the Product lead's, from the project's real customers.
 * - `pageQuiz.approve`, `pageQuiz.setLive`: an owner or an admin with Product write, by their own press (no agent tool
 *   calls these); audited, with `quiz.approved` / `quiz.published` / `quiz.unpublished` through the outbox.
 * - `publicQuiz.bySlug`: anyone; the view `public_page_quizzes` only; null when there is no live quiz there.
 * - `publicQuiz.answer`: anyone; scores the answers against the live version and counts the result type once.
 */
import { INPUT_LIMITS } from "@foundmill/config";
import { boundedRecord, PAGE_QUIZ_QUESTION_KEYS, PAGE_SLUG_MAX } from "@foundmill/shared";
import { z } from "zod";
import { answerPublicQuiz, approvePageQuiz, draftPageQuiz, pageQuizView, publicQuizBySlug, savePageQuiz, setPageQuizLive } from "../services/page-quiz";
import { publicProcedure, router, sectionAdmin, sectionRead, sectionWrite } from "../trpc";

const read = sectionRead("product");
const write = sectionWrite("product");
const publish = sectionAdmin("product");

/** The definition as the client sends it: bounded here, read and checked field by field in the service. */
const DefinitionInput = boundedRecord(INPUT_LIMITS.jsonObjectKeys, z.record(z.string(), z.unknown())).refine((v) => JSON.stringify(v).length <= 24_000, { message: "That quiz is too long." });

export const pageQuizRouter = router({
  get: read.query(({ ctx }) => pageQuizView(ctx)),
  draft: write.mutation(({ ctx }) => draftPageQuiz(ctx)),
  save: write.input(z.object({ definition: DefinitionInput })).mutation(({ ctx, input }) => savePageQuiz(ctx, input)),
  approve: publish.input(z.object({ definition: DefinitionInput })).mutation(({ ctx, input }) => approvePageQuiz(ctx, input)),
  setLive: publish.input(z.object({ on: z.boolean() })).mutation(({ ctx, input }) => setPageQuizLive(ctx, input)),
});

/** A plain object with at most one key per question: counted before zod reads any key, so oversized input is one short issue. */
const fewPlainKeys = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) return false;
  let n = 0;
  for (const _key in value) if (++n > PAGE_QUIZ_QUESTION_KEYS.length) return false;
  return true;
};

/**
 * A visitor's answers, at most one per question (`q1`..`q4`). Signed out, anyone can send this, so its size is checked
 * before zod looks at a key (GHSA-mrhx-c7xc-m3w5): a record, as before, made zod build an issue per key of a 2 MB body
 * (hundreds of MB), and a strict object alone still returned every unknown key in its one issue. Then a strict object of
 * the four questions, as the record allowed.
 */
export const AnswersInput = z
  .custom<Record<string, unknown>>(fewPlainKeys, { message: "At most one answer per question" })
  .pipe(z.strictObject(Object.fromEntries(PAGE_QUIZ_QUESTION_KEYS.map((key) => [key, z.string().max(4).optional()])) as Record<(typeof PAGE_QUIZ_QUESTION_KEYS)[number], z.ZodOptional<z.ZodString>>))
  .transform((answers) => Object.fromEntries(Object.entries(answers).filter((entry): entry is [string, string] => typeof entry[1] === "string")));

export const publicQuizRouter = router({
  bySlug: publicProcedure.input(z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2) })).query(({ ctx, input }) => publicQuizBySlug(ctx, input.slug)),
  answer: publicProcedure
    .input(z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2), version: z.number().int().positive().max(1_000_000), answers: AnswersInput }))
    .mutation(({ ctx, input }) => answerPublicQuiz(ctx, { slug: input.slug, version: input.version, answers: input.answers })),
});
