import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_NAME } from "@foundmill/config";
import { ProjectFollowForm } from "./ProjectFollowForm";
import { PROJECT_PAGE_WORDS, ProjectPage, type ProjectPageProps } from "./ProjectPage";

const props: ProjectPageProps = {
  name: "Northwind Skincare",
  pitch: "Gentle skincare for sensitive skin",
  about: "Three products, made well.\n\n\nEvery batch is mixed by hand.\nTested on our own skin first.",
  forWhom: "People with sensitive skin",
  stage: "building",
  publishedAt: new Date(2026, 9, 7, 12),
  brandPrimary: "#2f7d6b",
  brandSecondary: "#f4efe6",
  founderNames: ["Maya", "Sam"],
};

describe("ProjectPage", () => {
  it("shows the name, the pitch as the headline, the paragraphs, who it is for, the stage, the builders and the date", () => {
    render(<ProjectPage {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: props.pitch })).toBeTruthy();
    expect(screen.getByText("Northwind Skincare")).toBeTruthy();
    const about = document.querySelector("[data-project-about]")!;
    expect([...about.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Three products, made well.", "Every batch is mixed by hand.\nTested on our own skin first."]);
    expect(screen.getByRole("heading", { level: 2, name: PROJECT_PAGE_WORDS.forWhom })).toBeTruthy();
    expect(screen.getByText("People with sensitive skin")).toBeTruthy();
    expect(screen.getByText("Being built")).toBeTruthy();
    expect(screen.getByText("Built by Maya and Sam")).toBeTruthy();
    expect(screen.getByText("Published Oct 7, 2026")).toBeTruthy();
  });

  it("for a visitor the mark is the one link: body size (one step above the follow form's notices), with a 44 px target, to where it is told", () => {
    render(<ProjectPage {...props} markHref="/?via=p.northwind" />);
    const link = screen.getByRole("link", { name: `Built on ${APP_NAME}` });
    expect(link.getAttribute("href")).toBe("/?via=p.northwind");
    expect(link.className).toContain("min-h-tap");
    expect(link.className).toContain("t-body");
    expect(link.className).toContain("mark-arrive");
    expect(document.querySelectorAll("a")).toHaveLength(1);
    expect(document.querySelector("[data-project-mark]")!.getAttribute("data-project-mark")).toBe("visitor");
    expect(document.querySelector("form, input, button, textarea")).toBeNull();
  });

  it("for a signed-in member the mark is plain metadata: the same words, no link, dimmer", () => {
    render(<ProjectPage {...props} mark="member" />);
    expect(screen.queryByRole("link")).toBeNull();
    const words = screen.getByText(PROJECT_PAGE_WORDS.builtOn);
    expect(words.tagName).toBe("P");
    expect(words.className).toContain("text-tertiary");
    expect(words.className).toContain("t-small");
    expect(words.className).not.toContain("mark-arrive");
  });

  it("on a paid plan there is no mark and no foot at all", () => {
    render(<ProjectPage {...props} mark="none" />);
    expect(screen.queryByText(PROJECT_PAGE_WORDS.builtOn)).toBeNull();
    expect(document.querySelector("footer")).toBeNull();
    expect(document.body.textContent).not.toContain(APP_NAME);
  });

  it("shows the follow form it is given, after what the founders wrote", () => {
    render(<ProjectPage {...props} follow={<ProjectFollowForm name={props.name} slug="northwind" action="/follow" />} />);
    const form = document.querySelector("[data-project-follow]")!;
    expect(form.tagName).toBe("FORM");
    expect(screen.getByRole("heading", { level: 2, name: "Follow Northwind Skincare" })).toBeTruthy();
    // After "Built by", before the footer.
    const builtBy = document.querySelector("[data-project-built-by]")!;
    expect(builtBy.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(form.closest("footer")).toBeNull();
  });

  it("leaves out what is not there: no 'Who it is for', no 'Built by', no date", () => {
    render(<ProjectPage {...props} forWhom="  " founderNames={[]} publishedAt={null} stage="idea" />);
    expect(screen.queryByText(PROJECT_PAGE_WORDS.forWhom)).toBeNull();
    expect(screen.queryByText(/^Built by/)).toBeNull();
    expect(screen.queryByText(/^Published/)).toBeNull();
    expect(screen.getByText("Idea")).toBeTruthy();
    render(<ProjectPage {...props} founderNames={["Maya"]} stage="live" />);
    expect(screen.getByText("Built by Maya")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("renders every string as text: markup in the founder's words is never HTML", () => {
    const html = renderToStaticMarkup(<ProjectPage {...props} pitch={'<img src=x onerror="alert(1)">'} about={"**bold** <b>tag</b>\n\n[link](https://example.com)"} forWhom="<script>alert(1)</script>" />);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>tag</b>");
    expect(html).toContain("&lt;b&gt;tag&lt;/b&gt;");
    expect(html).toContain("**bold**");
    expect(html).not.toContain("<strong>");
  });

  it("uses the brand colors as accents and lays out from its own width", () => {
    render(<ProjectPage {...props} variant="preview" />);
    const root = document.querySelector<HTMLElement>("[data-project-page]")!;
    expect(root.style.getPropertyValue("--kit-primary")).toBe("#2f7d6b");
    expect(root.className).toContain("@container");
    expect(root.dataset.variant).toBe("preview");
    expect(document.querySelector("[data-brand-line]")!.className).toContain("bg-kit-primary");
  });

  it("is a server component: it renders to static markup with no client code", () => {
    expect(renderToStaticMarkup(<ProjectPage {...props} />)).toContain("data-project-page");
  });
});

describe("ProjectPage inside another page (titleLevel 3)", () => {
  it("titles itself with an h3, so the host page keeps one h1", () => {
    render(<ProjectPage {...props} titleLevel={3} />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(props.pitch);
  });
});
