import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_NAME } from "@foundmill/config";
import { PERSON_PAGE_WORDS, PersonPage, type PersonPageProps } from "./PersonPage";

const props: PersonPageProps = {
  name: "Maya Okafor",
  headline: "Baker who wants to sell online",
  about: "I bake sourdough.\n\n\nNow I sell it.\nTo neighbors.",
  strengths: ["Baking", "Talking to people"],
  wantsToLearn: ["Selling"],
  lookingFor: "on_my_own",
  place: "Leeds, UK",
  projects: [{ slug: "rise-bread", name: "Rise Bread", pitch: "Fresh sourdough every Saturday" }],
};

describe("PersonPage", () => {
  it("shows the name as the headline, the person's headline, the place, about, the chips and the projects", () => {
    render(<PersonPage {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "Maya Okafor" })).toBeTruthy();
    expect(screen.getByText("Baker who wants to sell online")).toBeTruthy();
    expect(screen.getByText("Leeds, UK")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Maya Okafor" }).textContent).toBe("MO");
    const about = document.querySelector("[data-person-about]")!;
    expect([...about.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["I bake sourdough.", "Now I sell it.\nTo neighbors."]);
    expect(screen.getByRole("heading", { level: 2, name: PERSON_PAGE_WORDS.strengths })).toBeTruthy();
    expect([...document.querySelectorAll("[data-person-strengths] li")].map((li) => li.textContent)).toEqual(["Baking", "Talking to people"]);
    expect(screen.getByRole("heading", { level: 2, name: PERSON_PAGE_WORDS.wantsToLearn })).toBeTruthy();
    expect(screen.getByText("Selling")).toBeTruthy();
    const card = screen.getByRole("link", { name: /Rise Bread/ });
    expect(card.getAttribute("href")).toBe("/p/rise-bread");
    expect(card.className).toContain("min-h-tap");
    expect(screen.getByText("Fresh sourdough every Saturday")).toBeTruthy();
  });

  it("says nothing at all about people for 'Building on my own'", () => {
    const html = renderToStaticMarkup(<PersonPage {...props} lookingFor="on_my_own" />);
    expect(document.querySelector("[data-person-looking-for]")).toBeNull();
    for (const word of ["alone", "Working alone", "on my own", "On my own", "cofounder", "people to", "solo"]) expect(html, word).not.toContain(word);
    render(<PersonPage {...props} lookingFor={null} />);
    expect(document.querySelector("[data-person-looking-for]")).toBeNull();
  });

  it("shows one line for each answer about people", () => {
    for (const [value, line] of [
      ["open_to_people", "Open to building with people"],
      ["looking_for_cofounder", "Looking for a cofounder"],
      ["looking_to_join", "Looking to join a project"],
    ] as const) {
      const { unmount } = render(<PersonPage {...props} lookingFor={value} />);
      expect(document.querySelector("[data-person-looking-for]")?.textContent).toBe(line);
      unmount();
    }
  });

  it("leaves out every section that is empty", () => {
    render(<PersonPage name="Sam" headline="" about="  " strengths={[]} wantsToLearn={[" "]} place="" projects={[]} />);
    for (const sel of ["[data-person-headline]", "[data-person-about]", "[data-person-strengths]", "[data-person-wants-to-learn]", "[data-person-projects]", "[data-person-place]", "[data-person-looking-for]"]) expect(document.querySelector(sel), sel).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Sam" })).toBeTruthy();
  });

  it("links home with the product's name and carries no form or contact button", () => {
    render(<PersonPage {...props} lookingFor="looking_for_cofounder" />);
    const link = screen.getByRole("link", { name: `Made with ${APP_NAME}` });
    expect(link.getAttribute("href")).toBe("/");
    expect(document.querySelector("form, input, button, textarea")).toBeNull();
  });

  it("renders every string as text: markup in the person's words is never HTML", () => {
    const html = renderToStaticMarkup(<PersonPage {...props} name={'<img src=x onerror="alert(1)">'} headline="<b>bold</b>" about={"**bold**\n\n[link](https://example.com)"} strengths={["<script>alert(1)</script>"]} place="<i>x</i>" />);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("**bold**");
    expect(html).not.toContain('href="https://example.com"');
  });

  it("lays out from its own width and is a server component", () => {
    render(<PersonPage {...props} variant="preview" />);
    const root = document.querySelector<HTMLElement>("[data-person-page]")!;
    expect(root.className).toContain("@container");
    expect(root.dataset.variant).toBe("preview");
    expect(renderToStaticMarkup(<PersonPage {...props} />)).toContain("data-person-page");
  });
});
