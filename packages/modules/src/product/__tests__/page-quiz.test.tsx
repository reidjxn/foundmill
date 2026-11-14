import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { PAGE_QUIZ_WORDS, type PageQuizDefinition } from "@foundmill/shared/page-quiz";
import { PAGE_QUIZ_PANEL_WORDS as W, PageQuizPanel, type PageQuizViewResponse } from "../PageQuizPanel";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID } from "./fixtures";

const def: PageQuizDefinition = {
  intro: "",
  types: [
    { key: "t1", name: "Cafes that restock weekly", summary: "", offer: "o1" },
    { key: "t2", name: "People buying a gift", summary: "", offer: "o2" },
  ],
  offers: [
    { key: "o1", title: "Weekly coffee box", detail: "", action: { kind: "link", url: "", label: "Get it" } },
    { key: "o2", title: "Follow Ember", detail: "", action: { kind: "follow" } },
  ],
  questions: [
    { key: "q1", text: "Who is it for?", answers: [{ key: "a1", text: "My cafe", type: "t1" }, { key: "a2", text: "Someone else", type: "t2" }] },
    { key: "q2", text: "How often?", answers: [{ key: "a1", text: "Every week", type: "t1" }, { key: "a2", text: "Once", type: "t2" }] },
  ],
};

const view = (over: Partial<PageQuizViewResponse> = {}): PageQuizViewResponse => ({
  quiz: null,
  counts: {},
  problems: [],
  readiness: { customers: 8, need: 6, ready: true },
  page: { saved: true, live: true, followForm: true, url: "https://foundmill.example/p/ember" },
  canEdit: true,
  canApprove: true,
  isSample: false,
  ...over,
});
const withQuiz = (over: Partial<NonNullable<PageQuizViewResponse["quiz"]>> = {}, rest: Partial<PageQuizViewResponse> = {}) =>
  view({ quiz: { definition: def, status: "draft", version: 1, evidence: { customers: 8, replies: 3, purchases: 11, perType: { t1: 4, t2: 3 } }, draftedAt: "2026-11-13T12:00:00.000Z", approvedAt: null, liveAt: null, ...over }, ...rest });

const render = (v: PageQuizViewResponse, onMutate?: (path: string, input: Record<string, unknown>) => unknown) => {
  const fake = createFakeSource({ businessId: BID, responses: { "pageQuiz.get": v }, onMutate });
  renderScreen(fake, <PageQuizPanel />);
  return fake;
};

describe("PageQuizPanel", () => {
  it("before a draft: says plainly how many customers there are and why the team waits", async () => {
    render(view({ readiness: { customers: 3, need: 6, ready: false } }));
    expect((await screen.findByTestId("quiz-not-ready")).textContent).toBe("You have 3 customers on record. The team drafts a quiz from at least 6 real customers, so every type in it rests on real people.");
    expect((screen.getByRole("button", { name: W.draft }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("quiz-state").textContent).toContain("No quiz yet");
  });

  it("a refusal from the team is shown as it was said", async () => {
    render(view(), (path) => (path === "pageQuiz.draft" ? { outcome: "refused", message: "The team read your 8 customers and could not tell real types apart yet, so it drafted nothing rather than guess.", view: view() } : {}));
    fireEvent.click(await screen.findByRole("button", { name: W.draft }));
    expect((await screen.findByTestId("quiz-refusal")).textContent).toMatch(/could not tell real types apart/);
  });

  it("a draft shows what it rested on, the real counts per type, the missing pay link, and a phone preview", async () => {
    render(withQuiz());
    expect((await screen.findByTestId("quiz-evidence")).textContent).toBe("Drafted from 8 customers, 3 replies and 11 purchases on record.");
    expect(screen.getByText("Rests on 4 of your customers")).toBeTruthy();
    expect(within(screen.getByTestId("quiz-problems")).getByText("Add the link, starting with https://.")).toBeTruthy();
    expect((screen.getByRole("button", { name: W.approve }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(screen.getByTestId("quiz-preview")).getByRole("heading", { name: PAGE_QUIZ_WORDS.heading })).toBeTruthy();
  });

  it("adding the pay link lets an owner approve exactly what is on screen", async () => {
    const fake = render(withQuiz(), (path, input) => (path === "pageQuiz.approve" ? withQuiz({ status: "approved", definition: input.definition as PageQuizDefinition, version: 2 }) : {}));
    fireEvent.change(await screen.findByLabelText(W.linkUrl), { target: { value: "https://pay.example.com/box" } });
    expect(screen.queryByTestId("quiz-problems")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: W.approve }));
    await waitFor(() => expect(fake.mutations.some((m) => m.path === "pageQuiz.approve")).toBe(true));
    const sent = fake.mutations.find((m) => m.path === "pageQuiz.approve")!.input.definition as PageQuizDefinition;
    expect(sent.offers[0]!.action).toEqual({ kind: "link", url: "https://pay.example.com/box", label: "Get it" });
  });

  it("pressure words are caught before approval", async () => {
    render(withQuiz());
    fireEvent.change(await screen.findByLabelText(W.intro), { target: { value: "Hurry, spots left" } });
    expect(within(screen.getByTestId("quiz-problems")).getByText(/Take out "Hurry"/)).toBeTruthy();
  });

  it("an approved quiz can be turned on; a live one off; a member cannot approve", async () => {
    render(withQuiz({ status: "approved", definition: { ...def, offers: [{ ...def.offers[0]!, action: { kind: "link", url: "https://pay.example.com/box", label: "Order" } }, def.offers[1]!] } }));
    expect(await screen.findByRole("button", { name: W.turnOn })).toBeTruthy();
  });

  it("a member edits but does not approve", async () => {
    render(withQuiz({}, { canApprove: false }));
    expect(await screen.findByTestId("quiz-read-only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: W.approve })).toBeNull();
    expect(screen.getByRole("button", { name: W.save })).toBeTruthy();
  });

  it("says the counts are unverified wherever they are shown (security review, Nov 13, 2026)", async () => {
    render(withQuiz({ status: "live" }, { counts: { t1: 12, t2: 3 } }));
    expect((await screen.findByTestId("quiz-results")).textContent).toContain("12 visitors got this result");
    expect(screen.getByTestId("quiz-unverified").textContent).toMatch(/^These counts are unverified: one person can finish the quiz more than once/);
  });

  it("says so as soon as the quiz is live, before anyone answered", async () => {
    render(withQuiz({ status: "live" }));
    expect((await screen.findByTestId("quiz-unverified")).textContent).toMatch(/unverified/);
  });
});
