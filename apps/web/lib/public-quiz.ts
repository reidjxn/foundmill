/**
 * The quiz on a public page (0105), its server half without the network: what the Server Action
 * (app/p/[slug]/quiz-actions.ts) reads from the posted form, and the visitor's state for each answer from the api.
 * The visitor never reads the api's own message.
 *
 * A visitor always gets their result (second review, Nov 13, 2026). When the api is over its answer ceilings it reads
 * nothing and answers `busy`, and a limit can refuse the call outright; either way the state is `busy` with the
 * visitor's answers, and `localQuizResult` scores them against the quiz the page already rendered, with the same shared
 * scoring the api uses. This runs in the quiz's own component, so it works on the page that comes back without
 * JavaScript too. Only the count is lost, which is the point of the ceiling.
 */
import { PAGE_QUIZ_QUESTION_KEYS, PAGE_QUIZ_WORDS, scorePageQuiz, type PageQuizDefinition } from "@foundmill/shared/page-quiz";
import type { ProjectQuizState } from "@foundmill/dugout";
import { appErrorCode, trpcErrorCode } from "./trpc";

export interface QuizFormInput {
  slug: string;
  version: number;
  /** Question key → the answer key the visitor chose; only the questions they answered. */
  answers: Record<string, string>;
}

/** What the Server Action returns: the quiz's own states, or `busy` for the component to score itself. */
export type QuizActionState = ProjectQuizState | { status: "busy"; answers: Record<string, string> };

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

/** The state for the api's answer. */
export function quizAnswerState(answer: { outcome: "result"; type: string } | { outcome: "unanswered" } | { outcome: "changed" } | { outcome: "busy" }, answers: Record<string, string>): QuizActionState {
  if (answer.outcome === "result") return { status: "result", type: answer.type, answers };
  if (answer.outcome === "busy") return { status: "busy", answers };
  if (answer.outcome === "unanswered") return { status: "error", message: PAGE_QUIZ_WORDS.unanswered, answers };
  return { status: "error", message: PAGE_QUIZ_WORDS.changed };
}

/** The state after an api refusal: a limit is `busy` (scored here), anything else the same "changed" line. */
export function quizErrorState(err: unknown, answers: Record<string, string>): QuizActionState {
  if (appErrorCode(err) === "rate_limited" || trpcErrorCode(err) === "TOO_MANY_REQUESTS") return { status: "busy", answers };
  return { status: "error", message: PAGE_QUIZ_WORDS.changed };
}

/** The state the quiz shows: `busy` scored against the rendered quiz; every other state as it is. */
export function localQuizResult(quiz: PageQuizDefinition, state: QuizActionState): ProjectQuizState {
  if (state.status !== "busy") return state;
  const type = scorePageQuiz(quiz, state.answers);
  return type ? { status: "result", type, answers: state.answers } : { status: "error", message: PAGE_QUIZ_WORDS.unanswered, answers: state.answers };
}
