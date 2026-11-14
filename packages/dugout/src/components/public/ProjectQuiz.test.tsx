import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { PAGE_QUIZ_WORDS, pageQuizPressure, type PageQuizDefinition } from "@foundmill/shared/page-quiz";
import { MilestoneCard } from "./MilestoneCard";
import { ProjectFollowForm } from "./ProjectFollowForm";
import { ProjectPage } from "./ProjectPage";
import { ProjectStory } from "./ProjectStory";
import { ProjectQuiz, QUIZ_FIELDS } from "./ProjectQuiz";

const quiz: PageQuizDefinition & { slug: string; version: number } = {
  slug: "ember-roasters",
  version: 3,
  intro: "",
  types: [
    { key: "t1", name: "Cafes that restock every week", summary: "They order before Monday.", offer: "o1" },
    { key: "t2", name: "Home brewers", summary: "", offer: "o2" },
  ],
  offers: [
    { key: "o1", title: "Weekly coffee box", detail: "Two bags a week.", action: { kind: "link", url: "https://pay.example.com/box", label: "Order a box" } },
    { key: "o2", title: "Follow Ember Roasters", detail: "", action: { kind: "follow" } },
  ],
  questions: [
    { key: "q1", text: "Who is it for?", answers: [{ key: "a1", text: "My cafe", type: "t1" }, { key: "a2", text: "Me", type: "t2" }] },
    { key: "q2", text: "How often?", answers: [{ key: "a1", text: "Every week", type: "t1" }, { key: "a2", text: "Now and then", type: "t2" }] },
  ],
};

describe("ProjectQuiz", () => {
  it("asks each question with native radios as 44 px targets, and carries the page and version", () => {
    render(<ProjectQuiz quiz={quiz} followForm action="/quiz" />);
    expect(screen.getByRole("heading", { level: 2, name: PAGE_QUIZ_WORDS.heading })).toBeTruthy();
    for (const q of quiz.questions) expect(screen.getByRole("group", { name: q.text })).toBeTruthy();
    const radio = screen.getByRole("radio", { name: "My cafe" }) as HTMLInputElement;
    expect(radio.name).toBe("q1");
    expect(radio.value).toBe("a1");
    expect(radio.required).toBe(true);
    expect(radio.closest("label")!.className).toContain("min-h-tap");
    expect(screen.getByRole("button", { name: PAGE_QUIZ_WORDS.submit }).className).toContain("min-h-tap");
    expect((document.querySelector(`input[name="${QUIZ_FIELDS.slug}"]`) as HTMLInputElement).value).toBe("ember-roasters");
    expect((document.querySelector(`input[name="${QUIZ_FIELDS.version}"]`) as HTMLInputElement).value).toBe("3");
    expect(screen.getByText(PAGE_QUIZ_WORDS.privacy)).toBeTruthy();
  });

  it("lists every offer before any answer, each with its own action", () => {
    render(<ProjectQuiz quiz={quiz} followForm action="/quiz" />);
    const all = document.querySelector("[data-quiz-offers]")!;
    expect(all.querySelectorAll("[data-quiz-offer]")).toHaveLength(2);
    const order = screen.getByRole("link", { name: "Order a box" }) as HTMLAnchorElement;
    expect(order.href).toBe("https://pay.example.com/box");
    expect(order.rel).toBe("noopener noreferrer nofollow");
    expect((screen.getByRole("link", { name: PAGE_QUIZ_WORDS.follow }) as HTMLAnchorElement).getAttribute("href")).toBe("#follow");
  });

  it("a result says which one is probably for them, keeps their answers checked, and still lists every offer", () => {
    render(<ProjectQuiz quiz={quiz} followForm action="/quiz" state={{ status: "result", type: "t1", answers: { q1: "a1", q2: "a1" } }} />);
    const result = screen.getByRole("status");
    expect(result.textContent).toContain(PAGE_QUIZ_WORDS.result);
    expect(result.textContent).toContain("Weekly coffee box");
    expect(result.textContent).toContain("Cafes that restock every week");
    expect((screen.getByRole("radio", { name: "My cafe" }) as HTMLInputElement).checked).toBe(true);
    expect(document.querySelectorAll("[data-quiz-offer]")).toHaveLength(2);
    expect(document.querySelector('[data-quiz-offer="o1"]')!.hasAttribute("data-match")).toBe(true);
  });

  it("a Follow offer shows its button only when the page has the form", () => {
    render(<ProjectQuiz quiz={quiz} followForm={false} action="/quiz" state={{ status: "result", type: "t2", answers: { q1: "a2", q2: "a2" } }} />);
    expect(screen.queryByRole("link", { name: PAGE_QUIZ_WORDS.follow })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Follow Ember Roasters");
  });

  it("an error is announced and tied to the answers", () => {
    render(<ProjectQuiz quiz={quiz} followForm action="/quiz" state={{ status: "error", message: PAGE_QUIZ_WORDS.unanswered }} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(PAGE_QUIZ_WORDS.unanswered);
    expect(screen.getByRole("radio", { name: "My cafe" }).getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("the preview has no form and nothing to press", () => {
    const html = renderToStaticMarkup(<ProjectQuiz quiz={quiz} followForm preview />);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<a ");
    expect(html).toContain(PAGE_QUIZ_WORDS.previewNote);
  });

  it("renders on the server inside the page, before the Follow form's anchor; never a count or a push", () => {
    const html = renderToStaticMarkup(
      <ProjectPage name="Ember Roasters" pitch="Coffee" about="Roasted weekly." stage="live" brandPrimary="#a0522d" brandSecondary="#f4efe6" quiz={<ProjectQuiz quiz={quiz} followForm action="/quiz" />} follow={<p>follow</p>} />,
    );
    expect(html.indexOf("data-project-quiz")).toBeLessThan(html.indexOf('id="follow"'));
    const text = html.replace(/<[^>]+>/g, " ");
    expect(pageQuizPressure(text)).toBeNull();
    expect(text).not.toMatch(/\d+ (people|visitors|customers)/);
  });
});

describe("ProjectQuiz on the page: what the network session relies on", () => {
  const followed = <ProjectFollowForm name="Ember Roasters" state={{ status: "done" }} builtOn={{ line: "Ember Roasters is built on Foundmill.", linkLabel: "See how it was made", href: "/p/ember-roasters/story?via=p.ember-roasters" }} />;
  const onPage = (follow = followed) => (
    <ProjectPage name="Ember Roasters" pitch="Coffee" about="Roasted weekly." stage="live" brandPrimary="#a0522d" brandSecondary="#f4efe6" markHref="/p/ember-roasters/story?via=p.ember-roasters" quiz={<ProjectQuiz quiz={quiz} followForm action="/quiz" state={{ status: "result", type: "t2", answers: { q1: "a2", q2: "a2" } }} />} follow={follow} />
  );

  it("the #follow anchor leaves the foot's mark and the line after a follow pointing exactly where they did", () => {
    render(onPage());
    expect(screen.getByRole("link", { name: "Built on Foundmill" }).getAttribute("href")).toBe("/p/ember-roasters/story?via=p.ember-roasters");
    expect(screen.getByRole("link", { name: "See how it was made" }).getAttribute("href")).toBe("/p/ember-roasters/story?via=p.ember-roasters");
    // Only the quiz's own Follow buttons point to the anchor.
    for (const a of document.querySelectorAll('a[href*="#follow"]')) expect(a.closest("[data-project-quiz]")).not.toBeNull();
    expect(document.querySelectorAll("#follow")).toHaveLength(1);
  });

  it("a result that offers Follow is a link to the form on the same page, never a submit", () => {
    render(onPage(<ProjectFollowForm name="Ember Roasters" slug="ember-roasters" action="/follow" />));
    const follow = within(screen.getByRole("status")).getByRole("link", { name: PAGE_QUIZ_WORDS.follow }) as HTMLAnchorElement;
    expect(follow.getAttribute("href")).toBe("#follow");
    expect(follow.closest("form")).toBeNull();
    expect(follow.getAttribute("target")).toBeNull();
    // The anchor holds the Follow form itself, so the link lands on it.
    expect(document.getElementById("follow")!.querySelector("form[data-project-follow]")).not.toBeNull();
  });

  it("the story page and a milestone card have no quiz slot and draw none", () => {
    const story = renderToStaticMarkup(<ProjectStory name="Ember Roasters" brandPrimary="#a0522d" brandSecondary="#f4efe6" pageHref="/p/ember-roasters" startHref="/?via=p.ember-roasters" milestones={[{ id: "m1", key: "page_live", label: "Page live", achievedAt: new Date(2026, 10, 12) }]} />);
    const card = renderToStaticMarkup(<MilestoneCard name="Ember Roasters" label="Page live" achievedAt={new Date(2026, 10, 12)} brandPrimary="#a0522d" brandSecondary="#f4efe6" pageHref="/p/ember-roasters" />);
    for (const html of [story, card]) {
      expect(html).not.toContain("data-project-quiz");
      expect(html).not.toContain(PAGE_QUIZ_WORDS.heading);
      expect(html).not.toContain('id="follow"');
    }
  });
});
