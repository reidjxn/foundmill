import { describe, expect, it } from "vitest";
import {
  PAGE_QUIZ_WORDS,
  pageQuizCountLine,
  pageQuizEvidenceLine,
  pageQuizLinkProblem,
  pageQuizNotReadyLine,
  pageQuizPressure,
  pageQuizProblems,
  pageQuizStatusLine,
  readPageQuiz,
  removePageQuizType,
  scorePageQuiz,
  type PageQuizDefinition,
} from "./page-quiz";
import { usSpelling } from "./us-spelling";

const quiz = (over: Partial<PageQuizDefinition> = {}): PageQuizDefinition => ({
  intro: "",
  types: [
    { key: "t1", name: "Cafes that order every week", summary: "They restock on Mondays.", offer: "o1" },
    { key: "t2", name: "People buying a gift", summary: "One order, wrapped.", offer: "o2" },
  ],
  offers: [
    { key: "o1", title: "Weekly coffee box", detail: "", action: { kind: "link", url: "https://pay.example.com/box", label: "Order" } },
    { key: "o2", title: "Follow the project", detail: "", action: { kind: "follow" } },
  ],
  questions: [
    { key: "q1", text: "Who is it for?", answers: [{ key: "a1", text: "My cafe", type: "t1" }, { key: "a2", text: "Someone else", type: "t2" }] },
    { key: "q2", text: "How often?", answers: [{ key: "a1", text: "Every week", type: "t1" }, { key: "a2", text: "Once", type: "t2" }] },
  ],
  ...over,
});

describe("page quiz: reading and checking a definition", () => {
  it("reads a definition defensively and tidies its texts", () => {
    const read = readPageQuiz({ ...quiz(), intro: "  Two   questions  " });
    expect(read?.intro).toBe("Two questions");
    expect(read?.questions[0]!.answers).toHaveLength(2);
    expect(readPageQuiz(null)).toBeNull();
    expect(readPageQuiz({ types: [], offers: [] })).toBeNull();
    expect(readPageQuiz({ ...quiz(), offers: [{ key: "o1", title: "x", action: { kind: "phone" } }] })).toBeNull();
  });

  it("a sound quiz has no problems", () => {
    expect(pageQuizProblems(quiz(), { followForm: true })).toEqual([]);
  });

  it("an offer pointing to the Follow form needs the form on the page", () => {
    expect(pageQuizProblems(quiz(), { followForm: false }).map((p) => p.path)).toEqual(["offers.1.action"]);
  });

  it("links must be https with a real host and no credentials", () => {
    expect(pageQuizLinkProblem("https://pay.example.com/x")).toBeNull();
    expect(pageQuizLinkProblem("http://pay.example.com/x")).toMatch(/https/);
    expect(pageQuizLinkProblem("https://user:pw@pay.example.com")).toMatch(/password/);
    expect(pageQuizLinkProblem("javascript:alert(1)")).toMatch(/https/);
    expect(pageQuizLinkProblem("https://localhost/")).toMatch(/full link/);
    expect(pageQuizLinkProblem("")).toMatch(/Add the link/);
  });

  it("refuses pressure: urgency, scarcity, crowds and promises", () => {
    for (const s of ["Hurry, only 3 left", "Limited-time offer", "Most popular with people like you", "Last chance", "Guaranteed results", "Don't miss it"]) expect(pageQuizPressure(s), s).not.toBeNull();
    for (const s of ["Weekly coffee box", "For cafes that restock on Mondays", "A gift, wrapped"]) expect(pageQuizPressure(s), s).toBeNull();
    const pushed = quiz({ intro: "Hurry, spots left this week" });
    expect(pageQuizProblems(pushed, { followForm: true })[0]).toMatchObject({ path: "intro" });
  });

  it("every type must be reachable and every question must tell types apart", () => {
    const one = quiz({ questions: quiz().questions.map((q) => ({ ...q, answers: q.answers.map((a) => ({ ...a, type: "t1" })) })) });
    const paths = pageQuizProblems(one, { followForm: true }).map((p) => p.path);
    expect(paths).toContain("questions.0.answers");
    expect(paths).toContain("types.1");
  });

  it("counts limits: 2 to 4 types and questions", () => {
    const short = quiz({ questions: [quiz().questions[0]!] });
    expect(pageQuizProblems(short, { followForm: true }).map((p) => p.path)).toContain("questions");
  });

  it("removing a type takes its answers with it, never below two types", () => {
    const three = quiz({ types: [...quiz().types, { key: "t3", name: "Offices", summary: "", offer: "o1" }] });
    const fewer = removePageQuizType(three, "t3");
    expect(fewer.types.map((t) => t.key)).toEqual(["t1", "t2"]);
    expect(removePageQuizType(fewer, "t2")).toBe(fewer);
    expect(removePageQuizType(quiz(), "t1").questions[0]!.answers.every((a) => a.type !== "t1")).toBe(false);
  });
});

describe("page quiz: scoring", () => {
  it("each answer counts one for its type; every question must be answered", () => {
    expect(scorePageQuiz(quiz(), { q1: "a1", q2: "a1" })).toBe("t1");
    expect(scorePageQuiz(quiz(), { q1: "a2", q2: "a2" })).toBe("t2");
    expect(scorePageQuiz(quiz(), { q1: "a1" })).toBeNull();
    expect(scorePageQuiz(quiz(), { q1: "a1", q2: "a9" })).toBeNull();
  });

  it("a tie goes to the type listed first, every time", () => {
    expect(scorePageQuiz(quiz(), { q1: "a2", q2: "a1" })).toBe("t1");
    expect(scorePageQuiz(quiz(), { q1: "a1", q2: "a2" })).toBe("t1");
  });
});

describe("page quiz: words", () => {
  it("the founder's lines use real counts and say what is not public", () => {
    expect(pageQuizStatusLine({ status: null, pageLive: true })).toBe("No quiz yet");
    expect(pageQuizStatusLine({ status: "live", pageLive: false })).toMatch(/once your page is live/);
    expect(pageQuizEvidenceLine({ customers: 8, replies: 1, purchases: 12 })).toBe("Drafted from 8 customers, 1 reply and 12 purchases on record.");
    expect(pageQuizNotReadyLine(3)).toMatch(/^You have 3 customers on record\. The team drafts a quiz from at least 6 real customers/);
    expect(pageQuizCountLine(1)).toBe("1 visitor got this result");
  });

  it("the visitor's words are plain US English and never push", () => {
    for (const w of Object.values(PAGE_QUIZ_WORDS)) {
      expect(usSpelling(w)).toBe(w);
      expect(pageQuizPressure(w)).toBeNull();
    }
  });
});
