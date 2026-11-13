"use server";
/**
 * "Which one is for you?" on a project's public page (0101): the Server Action behind the quiz, so it answers without
 * JavaScript too. It reads the posted answers and calls the api's signed-out `publicQuiz.answer` with no bearer; the
 * api scores them against the live version and counts only the result type. Nothing about the visitor is sent or kept.
 * Over the api's answer ceilings (or a refused call) the state is `busy`, and the quiz scores the answers itself
 * (lib/public-quiz.ts `localQuizResult`).
 */
import { PAGE_QUIZ_WORDS } from "@foundmill/shared/page-quiz";
import { quizAnswerState, quizErrorState, readQuizForm, type QuizActionState } from "@/lib/public-quiz";
import { createApiClient, SERVER_LIMITS } from "@/lib/trpc";

export async function answerQuiz(_previous: QuizActionState, form: FormData): Promise<QuizActionState> {
  const input = readQuizForm(form);
  if (!input.slug || !input.version) return { status: "error", message: PAGE_QUIZ_WORDS.changed };
  const api = createApiClient({ getToken: () => null, fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }), limits: SERVER_LIMITS });
  try {
    return quizAnswerState(await api.publicQuiz.answer.mutate(input), input.answers);
  } catch (err) {
    return quizErrorState(err, input.answers);
  }
}
