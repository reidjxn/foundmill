/**
 * The quiz on a public page (0101), its server half without the network: what the Server Action
 * (app/p/[slug]/quiz-actions.ts) reads from the posted form, and the visitor's sentence for each answer from the api.
 * The visitor never reads the api's own message.
 */
import { PAGE_QUIZ_QUESTION_KEYS, PAGE_QUIZ_WORDS } from "@foundmill/shared/page-quiz";
import type { ProjectQuizState } from "@foundmill/dugout";
import { appErrorCode, trpcErrorCode } from "./trpc";

export interface QuizFormInput {
  slug: string;
  version: number;
  /** Question key → the answer key the visitor chose; only the questions they answered. */
  answers: Record<string, string>;
}

const text = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === "string" ? v.slice(0, max).trim() : "";
};

/** The posted fields, bounded (the api checks them again). */
export function readQuizForm(form: FormData): QuizFormInput {
  const answers: Record<string, string> = {};
  for (const q of PAGE_QUIZ_QUESTION_KEYS) {
    const a = text(form, q, 4);
    if (/^a[1-4]$/.test(a)) answers[q] = a;
  }
  const version = Number.parseInt(text(form, "quiz_version", 8), 10);
  return { slug: text(form, "quiz_slug", 80).toLowerCase(), version: Number.isFinite(version) && version > 0 ? version : 0, answers };
}

/** The state the quiz shows for the api's answer. */
export function quizAnswerState(answer: { outcome: "result"; type: string } | { outcome: "unanswered" } | { outcome: "changed" }, answers: Record<string, string>): ProjectQuizState {
  if (answer.outcome === "result") return { status: "result", type: answer.type, answers };
  if (answer.outcome === "unanswered") return { status: "error", message: PAGE_QUIZ_WORDS.unanswered, answers };
  return { status: "error", message: PAGE_QUIZ_WORDS.changed };
}

/** The state after an api refusal: busy for a limit, else the same "changed" line (never the api's words). */
export function quizErrorState(err: unknown, answers: Record<string, string>): ProjectQuizState {
  if (appErrorCode(err) === "rate_limited" || trpcErrorCode(err) === "TOO_MANY_REQUESTS") return { status: "error", message: PAGE_QUIZ_WORDS.busy, answers };
  return { status: "error", message: PAGE_QUIZ_WORDS.changed };
}
