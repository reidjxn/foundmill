import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { EXPLORE_WORDS, ExploreGallery, type ExploreProject } from "./ExploreGallery";

const project: ExploreProject = { slug: "northwind", name: "Northwind Skincare", pitch: "Gentle skincare", stage: "live", brandPrimary: "#2f7d6b", brandSecondary: "#f4efe6", publishedAt: new Date(2026, 10, 14, 8) };

describe("ExploreGallery", () => {
  it("shows each project as a link to its page with its name, pitch, stage and US date", () => {
    render(<ExploreGallery projects={[project]} />);
    expect(screen.getByRole("heading", { level: 1, name: EXPLORE_WORDS.title })).toBeTruthy();
    const card = document.querySelector('[data-explore-project="northwind"] a')!;
    expect(card.getAttribute("href")).toBe("/p/northwind");
    expect(card.textContent).toContain("Northwind Skincare");
    expect(card.textContent).toContain("Gentle skincare");
    expect(card.textContent).toContain("Live Nov 14, 2026");
  });

  it("says nothing is listed yet when there are no projects, and still offers to start one", () => {
    render(<ExploreGallery projects={[]} startHref="/?via=explore" />);
    expect(document.querySelector("[data-explore-empty]")!.textContent).toBe(EXPLORE_WORDS.empty);
    expect(document.querySelector("[data-explore-start]")!.getAttribute("href")).toBe("/?via=explore");
  });

  it("renders on the server and treats names and pitches as text, never markup", () => {
    const html = renderToStaticMarkup(<ExploreGallery projects={[{ ...project, name: "<b>x</b>", pitch: "<script>1</script>" }]} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
