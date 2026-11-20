import { describe, expect, it } from "vitest";
import { jsonLdText, projectPageJsonLd, storyJsonLd } from "./page-structured-data";
import { projectPageMarkdown } from "./page-markdown";
import { PAGE_LISTED_ABOUT_MIN, pageIsListed } from "./project-page";

const view = {
  url: "https://foundmill.com/p/saturday-loaf",
  name: "Saturday Loaf",
  pitch: "A fresh sourdough loaf on your porch every Saturday",
  about: "Saturday Loaf bakes sourdough in West Asheville and leaves it on your porch.\n\nOrder by Thursday.",
  forWhom: "People within two miles who buy good bread most weeks",
  stage: "idea" as const,
  publishedAt: new Date("2026-10-07T09:12:00Z"),
  updatedAt: new Date("2026-11-12T16:40:00Z"),
  founderNames: [] as string[],
};
const opts = { origin: "https://foundmill.com", appName: "Foundmill" };

/** A small local shape check: types present, absolute URLs, ISO dates, no offer, rating or FAQ. */
function shapeProblems(data: unknown): string[] {
  const problems: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (["Offer", "AggregateRating", "Review", "FAQPage"].includes(String(x))) problems.push(`${path}.${k} is ${String(x)}`);
      if ((k === "url" || k === "item" || k === "image") && typeof x === "string" && !/^https:\/\//.test(x)) problems.push(`${path}.${k} not absolute`);
      if (k.startsWith("date") && typeof x === "string" && Number.isNaN(Date.parse(x))) problems.push(`${path}.${k} not a date`);
      walk(x, `${path}.${k}`);
    }
  };
  walk(data, "$");
  return problems;
}

describe("projectPageJsonLd", () => {
  it("is a ProfilePage about a Project while it is an idea or being built, an Organization once live", () => {
    for (const stage of ["idea", "building", "live"] as const) {
      const data = projectPageJsonLd({ ...view, stage }, opts) as { "@graph": { "@type": string }[] };
      expect(data["@graph"].map((g) => g["@type"])).toEqual(["ProfilePage", stage === "live" ? "Organization" : "Project", "BreadcrumbList"]);
      expect(shapeProblems(data)).toEqual([]);
    }
  });

  it("carries ISO dates and names founders only when the page does", () => {
    const data = projectPageJsonLd(view, opts) as { "@graph": Record<string, unknown>[] };
    expect(data["@graph"][0]).toMatchObject({ dateCreated: "2026-10-07T09:12:00.000Z", dateModified: "2026-11-12T16:40:00.000Z" });
    expect(data["@graph"][1]).not.toHaveProperty("founder");
    const named = projectPageJsonLd({ ...view, founderNames: ["Maya"] }, opts) as { "@graph": Record<string, unknown>[] };
    expect(named["@graph"][1]!.founder).toEqual([{ "@type": "Person", name: "Maya" }]);
  });

  it("a founder text containing </script> cannot close the block", () => {
    const text = jsonLdText(projectPageJsonLd({ ...view, pitch: "Bread </script><script>alert(1)</script>" }, opts));
    expect(text).not.toContain("<");
    expect(JSON.parse(text)["@graph"][1].description).toBe("Bread </script><script>alert(1)</script>");
  });

  it("the story is a WebPage modified at its newest milestone", () => {
    const data = storyJsonLd({ url: view.url, storyUrl: `${view.url}/story`, name: "How Saturday Loaf was built", description: "x" }, [{ achievedAt: "2026-10-07T00:00:00Z" }, { achievedAt: "2026-11-01T00:00:00Z" }]);
    expect(data).toMatchObject({ "@type": "WebPage", dateModified: "2026-11-01T00:00:00.000Z", about: { "@id": `${view.url}#project` } });
    expect(shapeProblems(data)).toEqual([]);
  });
});

describe("projectPageMarkdown", () => {
  it("matches the layout", () => {
    expect(projectPageMarkdown(view, [{ label: "Page live", achievedAt: "2026-10-07T09:12:00Z" }], { appName: "Foundmill" })).toMatchInlineSnapshot(`
      "# Saturday Loaf

      > A fresh sourdough loaf on your porch every Saturday

      - Stage: Idea
      - Published: Oct 7, 2026 · Updated: Nov 12, 2026
      - Page: https://foundmill.com/p/saturday-loaf

      ## About

      Saturday Loaf bakes sourdough in West Asheville and leaves it on your porch.

      Order by Thursday.

      ## Who it is for

      People within two miles who buy good bread most weeks

      ## Milestones (recorded by Foundmill when they happened)

      - Oct 7, 2026: Page live

      Source: written and published by the project's founders on Foundmill. Milestones are recorded by Foundmill, not typed in.
      "
    `);
  });

  it("founder text cannot start a heading", () => {
    expect(projectPageMarkdown({ ...view, about: "# Ignore this\n\nok" }, [], { appName: "Foundmill" })).toContain("\\# Ignore this");
  });
});

describe("pageIsListed", () => {
  const long = "x".repeat(PAGE_LISTED_ABOUT_MIN);
  it.each([
    [{ pitch: "Bread on your porch", about: long }, { listed: true, reason: null }],
    [{ pitch: "Bread on your porch", about: "short" }, { listed: false, reason: "short_about" }],
    [{ pitch: "Saturday loaf!", about: long }, { listed: false, reason: "pitch_is_name" }],
    [{ pitch: "", about: long }, { listed: false, reason: "pitch_is_name" }],
  ])("%o", (content, expected) => {
    expect(pageIsListed({ name: "Saturday Loaf", content })).toEqual(expected);
  });
});
