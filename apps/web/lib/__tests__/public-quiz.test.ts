// @vitest-environment node
/**
 * The public quiz's server half (lib/public-quiz.ts): a visitor always gets their result. When the api is over its
 * answer ceilings it reads nothing and answers `busy` (second review, Nov 13, 2026), or a limit refuses the call; the
 * web then works the result out from the quiz it already rendered, with the same scoring the api uses.
 */
import { PAGE_QUIZ_WORDS, scorePageQuiz, type PageQuizDefinition } from "@foundmill/shared/page-quiz";
import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";
import { localQuizResult, quizAnswerState, quizErrorState, readQuizForm } from "../public-quiz";

const quiz: PageQuizDefinition = {
  intro: "",
  types: [
    { key: "t1", name: "Cafes", summary: "", offer: "o1" },
    { key: "t2", name: "Gifts", summary: "", offer: "o1" },
  ],
  offers: [{ key: "o1", title: "Follow", detail: "", action: { kind: "follow" } }],
  questions: [
    { key: "q1", text: "Who?", answers: [{ key: "a1", text: "My cafe", type: "t1" }, { key: "a2", text: "Someone", type: "t2" }] },
    { key: "q2", text: "How often?", answers: [{ key: "a1", text: "Weekly", type: "t1" }, { key: "a2", text: "Once", type: "t2" }] },
  ],
};

describe("public quiz: a visitor always gets their result", () => {
  it("a busy api answer is scored here, the same way the api scores it", () => {
    const answers = { q1: "a2", q2: "a2" };
    const state = quizAnswerState({ outcome: "busy" }, answers);
    expect(state).toEqual({ status: "busy", answers });
    expect(localQuizResult(quiz, state)).toEqual({ status: "result", type: scorePageQuiz(quiz, answers), answers });
  });

  it("a rate-limited call is scored here too; an incomplete set says to answer every question", () => {
    const limited = new TRPCClientError("Too many", { result: { error: { code: -32029, message: "Too many", data: { code: "TOO_MANY_REQUESTS" } } } } as never);
    const state = quizErrorState(limited, { q1: "a1", q2: "a1" });
    expect(localQuizResult(quiz, state)).toMatchObject({ status: "result", type: "t1" });
    expect(localQuizResult(quiz, quizAnswerState({ outcome: "busy" }, { q1: "a1" }))).toEqual({ status: "error", message: PAGE_QUIZ_WORDS.unanswered, answers: { q1: "a1" } });
  });

  it("every other state passes through as it is", () => {
    expect(localQuizResult(quiz, { status: "idle" })).toEqual({ status: "idle" });
    expect(localQuizResult(quiz, quizAnswerState({ outcome: "result", type: "t2" }, {}))).toEqual({ status: "result", type: "t2", answers: {} });
    expect(localQuizResult(quiz, quizAnswerState({ outcome: "changed" }, {}))).toEqual({ status: "error", message: PAGE_QUIZ_WORDS.changed });
  });

  it("reads only question keys and answer keys from the form", () => {
    const form = new FormData();
    form.set("quiz_slug", "Ember-Roasters");
    form.set("quiz_version", "3");
    form.set("q1", "a2");
    form.set("q2", "<script>");
    form.set("q9", "a1");
    expect(readQuizForm(form)).toEqual({ slug: "ember-roasters", version: 3, answers: { q1: "a2" } });
  });
});
