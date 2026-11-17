import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_NAME } from "@foundmill/config";
import { PROJECT_STORY_WORDS, ProjectStory, type ProjectStoryProps } from "./ProjectStory";

const props: ProjectStoryProps = {
  name: "Northwind Skincare",
  brandPrimary: "#2f7d6b",
  brandSecondary: "#f4efe6",
  pageHref: "/p/northwind",
  startHref: "/?via=p.northwind",
  // Given newest first: the story reads oldest first whatever the order.
  milestones: [
    { id: "m3", key: "customer_1", label: "First customer", achievedAt: new Date(2026, 10, 19, 10) },
    { id: "m1", key: "page_live", label: "Page live", achievedAt: new Date(2026, 10, 12, 9) },
    { id: "m2", key: "first_follower", label: "First follower", achievedAt: "2026-11-14T12:00:00.000Z" },
  ],
};

describe("ProjectStory", () => {
  it("heads the page \"How ‹name› was built\", says once what verified means, and links the logo and name back to the page", () => {
    render(<ProjectStory {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "How Northwind Skincare was built" })).toBeTruthy();
    expect(screen.getAllByText(`${APP_NAME} recorded each of these when it happened. None was typed in.`)).toHaveLength(1);
    const home = document.querySelector("[data-story-project]") as HTMLAnchorElement;
    expect(home.getAttribute("href")).toBe("/p/northwind");
    expect(home.textContent).toContain("Northwind Skincare");
    expect(home.className).toContain("min-h-tap");
  });

  it("lists the milestones oldest first: a US date, the words, and \"Verified by Foundmill\" as an icon with the words", () => {
    render(<ProjectStory {...props} />);
    const list = screen.getByRole("list", { name: PROJECT_STORY_WORDS.timeline });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-story-milestone"))).toEqual(["page_live", "first_follower", "customer_1"]);
    expect(items.map((li) => li.querySelector("time")!.textContent)).toEqual(["Nov 12, 2026", "Nov 14, 2026", "Nov 19, 2026"]);
    expect(items.map((li) => within(li).getByRole("heading", { level: 2 }).textContent)).toEqual(["Page live", "First follower", "First customer"]);
    for (const li of items) {
      const verified = li.querySelector("[data-verified]")!;
      expect(verified.textContent).toBe(`Verified by ${APP_NAME}`);
      // Never color alone: the mark is an icon and the words.
      expect(verified.querySelector("svg")).not.toBeNull();
      expect(li.querySelector("time")!.getAttribute("dateTime")).toMatch(/^2026-11-\d\dT/);
    }
  });

  it("counts nothing: no total, no tally, no number of milestones or followers", () => {
    render(<ProjectStory {...props} />);
    const text = document.querySelector("[data-project-story]")!.textContent!;
    expect(text).not.toMatch(/\b3\b/);
    expect(text).not.toMatch(/\d+\s+(milestones?|followers?|customers?)/i);
    expect(text).not.toMatch(/total|so far/i);
  });

  it("ends with a link back to the project's page and, for a visitor to a free project, one small line with \"Start your own\"", () => {
    render(<ProjectStory {...props} />);
    const back = screen.getByRole("link", { name: "See Northwind Skincare" });
    expect(back.getAttribute("href")).toBe("/p/northwind");
    expect(back.className).toContain("min-h-tap");
    const foot = document.querySelector("footer[data-project-mark]")!;
    expect(foot.getAttribute("data-project-mark")).toBe("visitor");
    expect(foot.textContent).toBe(`Northwind Skincare is built on ${APP_NAME}.Start your own`);
    expect(foot.querySelector("p")!.className).toContain("t-small");
    const start = within(foot as HTMLElement).getByRole("link", { name: "Start your own" });
    expect(start.getAttribute("href")).toBe("/?via=p.northwind");
    expect(start.className).toContain("min-h-tap");
    expect(start.className).toContain("focus-ring");
    // The page's links: the logo and name, the way back, the start line. No form, no button.
    expect(document.querySelectorAll("a")).toHaveLength(3);
    expect(document.querySelector("form, input, button, textarea")).toBeNull();
  });

  it("for a signed-in member the foot is the sentence alone; on a paid plan there is no foot, and verified stays", () => {
    const { unmount } = render(<ProjectStory {...props} mark="member" />);
    const foot = document.querySelector("footer[data-project-mark]")!;
    expect(foot.textContent).toBe(`Northwind Skincare is built on ${APP_NAME}.`);
    expect(foot.querySelector("a")).toBeNull();
    expect(foot.querySelector("p")!.className).toContain("text-tertiary");
    unmount();

    render(<ProjectStory {...props} mark="none" />);
    expect(document.querySelector("footer")).toBeNull();
    expect(screen.queryByText("Start your own")).toBeNull();
    expect(document.body.textContent).not.toContain("built on");
    // The proof is not the mark: it stays on every plan.
    expect(document.querySelectorAll("[data-verified]")).toHaveLength(3);
  });

  it("prints every string as text: markup in a name or a label is never read as HTML", () => {
    const html = renderToStaticMarkup(<ProjectStory {...props} name={'<img src=x onerror="alert(1)">'} milestones={[{ id: "x", key: "page_live", label: "<script>alert(1)</script>", achievedAt: new Date(2026, 10, 12) }]} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses the brand as accents only and fills its frame in the preview", () => {
    render(<ProjectStory {...props} variant="preview" />);
    const root = document.querySelector("[data-project-story]") as HTMLElement;
    expect(root.style.getPropertyValue("--kit-primary")).toBe("#2f7d6b");
    expect(root.className).toContain("bg-canvas");
    expect(root.className).toContain("min-h-full");
    expect(root.className).not.toContain("min-h-dvh");
    expect(document.querySelector("[data-brand-line]")!.className).toContain("bg-kit-primary");
    // The timeline's markers are rings in the brand's color on the canvas, never a fill behind text.
    const ring = document.querySelector("[data-story-milestone] span[aria-hidden] span:last-child")!;
    expect(ring.className).toContain("border-kit-primary");
    expect(ring.className).toContain("bg-canvas");
    expect(document.querySelector("h1")!.className).not.toMatch(/bg-kit|text-kit/);
  });

  it("an unreadable date shows a dash and no machine date, never a crash", () => {
    render(<ProjectStory {...props} milestones={[{ id: "x", key: "page_live", label: "Page live", achievedAt: "not a date" }]} />);
    const time = document.querySelector("time")!;
    expect(time.textContent).toBe("—");
    expect(time.getAttribute("dateTime")).toBeNull();
  });
});
