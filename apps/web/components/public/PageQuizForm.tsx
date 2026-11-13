"use client";
/**
 * The public page's quiz (0101), wired: the design system's `ProjectQuiz` with the Server Action and the state
 * `useActionState` keeps. Before JavaScript loads (or without it) the form posts to the same action and the page comes
 * back with the result.
 */
import { useActionState } from "react";
import { ProjectQuiz, type ProjectQuizProps, type ProjectQuizState } from "@foundmill/dugout";
import { answerQuiz } from "@/app/p/[slug]/quiz-actions";

const IDLE: ProjectQuizState = { status: "idle" };

export function PageQuizForm({ quiz, followForm }: Pick<ProjectQuizProps, "quiz" | "followForm">) {
  const [state, action, pending] = useActionState(answerQuiz, IDLE);
  return <ProjectQuiz quiz={quiz} followForm={followForm} action={action} state={state} pending={pending} />;
}
