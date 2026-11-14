"use client";
/**
 * The public page's quiz (0105), wired: the design system's `ProjectQuiz` with the Server Action and the state
 * `useActionState` keeps. Before JavaScript loads (or without it) the form posts to the same action and the page comes
 * back with the result. When the api was too busy to score it, the answers are scored here against the quiz this page
 * rendered (`localQuizResult`), on the server render and in the browser alike: the visitor always gets their result.
 */
import { useActionState } from "react";
import { ProjectQuiz, type ProjectQuizProps } from "@foundmill/dugout";
import { answerQuiz } from "@/app/p/[slug]/quiz-actions";
import { localQuizResult, type QuizActionState } from "@/lib/public-quiz";

const IDLE: QuizActionState = { status: "idle" };

export function PageQuizForm({ quiz, followForm }: Pick<ProjectQuizProps, "quiz" | "followForm">) {
  const [state, action, pending] = useActionState(answerQuiz, IDLE);
  return <ProjectQuiz quiz={quiz} followForm={followForm} action={action} state={localQuizResult(quiz, state)} pending={pending} />;
}
