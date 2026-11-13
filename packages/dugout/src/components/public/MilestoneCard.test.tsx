import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_NAME } from "@foundmill/config";
import { MilestoneCard, type MilestoneCardProps } from "./MilestoneCard";

const props: MilestoneCardProps = {
  name: "Northwind Skincare",
  label: "First follower",
  milestoneKey: "first_follower",
  achievedAt: new Date(2026, 10, 14, 8),
  brandPrimary: "#2f7d6b",
  brandSecondary: "#f4efe6",
  pageHref: "/p/northwind",
  storyHref: "/p/northwind/story",
  startHref: "/?via=p.northwind",
};

describe("MilestoneCard", () => {
  it("shows the project, the milestone's words as the headline, the US date and \"Verified by Foundmill\" with what it means", () => {
    render(<MilestoneCard {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "First follower" })).toBeTruthy();
    expect(document.querySelector("[data-project-name]")!.textContent).toBe("Northwind Skincare");
    const time = document.querySelector("time")!;
    expect(time.textContent).toBe("Nov 14, 2026");
    expect(time.getAttribute("dateTime")).toMatch(/^2026-11-14T/);
    const verified = document.querySelector("[data-verified]")!;
    expect(verified.textContent).toBe(`Verified by ${APP_NAME}`);
    expect(verified.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(`${APP_NAME} recorded this when it happened. It was not typed in.`)).toBeTruthy();
    expect(document.querySelector("[data-milestone-card]")!.getAttribute("data-milestone-card")).toBe("first_follower");
  });

  it("leads on to the project's page and its story, each a 44 px target", () => {
    render(<MilestoneCard {...props} />);
    const see = screen.getByRole("link", { name: "See Northwind Skincare" });
    expect(see.getAttribute("href")).toBe("/p/northwind");
    expect(see.className).toContain("min-h-tap");
    const story = screen.getByRole("link", { name: "How Northwind Skincare was built" });
    expect(story.getAttribute("href")).toBe("/p/northwind/story");
    expect(story.className).toContain("min-h-tap");
    for (const a of document.querySelectorAll("a")) expect(a.className).toContain("focus-ring");
    expect(document.querySelector("form, input, button, textarea")).toBeNull();
  });

  it("the foot is the free plan's: a small line with \"Start your own\" for a visitor, the sentence for a member, nothing on a paid plan", () => {
    const { unmount } = render(<MilestoneCard {...props} />);
    const foot = document.querySelector("footer[data-project-mark]")!;
    expect(foot.textContent).toBe(`Northwind Skincare is built on ${APP_NAME}.Start your own`);
    expect(within(foot as HTMLElement).getByRole("link", { name: "Start your own" }).getAttribute("href")).toBe("/?via=p.northwind");
    expect(document.querySelectorAll("a")).toHaveLength(3);
    unmount();

    const member = render(<MilestoneCard {...props} mark="member" />);
    expect(document.querySelector("footer[data-project-mark]")!.querySelector("a")).toBeNull();
    expect(document.querySelector("footer")!.textContent).toBe(`Northwind Skincare is built on ${APP_NAME}.`);
    member.unmount();

    render(<MilestoneCard {...props} mark="none" />);
    expect(document.querySelector("footer")).toBeNull();
    expect(screen.queryByText("Start your own")).toBeNull();
    // The proof stays on every plan.
    expect(document.querySelector("[data-verified]")!.textContent).toBe(`Verified by ${APP_NAME}`);
  });

  it("without a story it offers the page only, and counts nothing", () => {
    render(<MilestoneCard {...props} storyHref={null} mark="none" />);
    expect(document.querySelectorAll("a")).toHaveLength(1);
    const text = document.querySelector("[data-milestone-card]")!.textContent!;
    expect(text).not.toMatch(/\d+\s+(milestones?|followers?|customers?)/i);
    expect(text).not.toMatch(/total|so far/i);
  });

  it("prints every string as text and takes the brand as accents only", () => {
    const html = renderToStaticMarkup(<MilestoneCard {...props} name={'<img src=x onerror="alert(1)">'} label="<script>alert(1)</script>" />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    render(<MilestoneCard {...props} variant="preview" />);
    const root = document.querySelector("[data-milestone-card]") as HTMLElement;
    expect(root.style.getPropertyValue("--kit-primary")).toBe("#2f7d6b");
    expect(root.className).toContain("min-h-full");
    expect(document.querySelector("[data-card-fact]")!.className).toContain("border-kit-primary");
    expect(document.querySelector("h1")!.className).not.toMatch(/bg-kit|text-kit/);
  });
});
