import { describe, expect, it } from "vitest";
import { isFirstLaunch, launchChecklist, readLaunchChecklist, siteLaunchChecklist } from "./launch-checklist";
import type { ProjectPageContent } from "./project-page";

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Fresh bread on your street every morning", about: "x".repeat(450), forWhom: "", stage: "idea", showFounders: false, followForm: true, ...over });

describe("launchChecklist", () => {
  it("reads every item ready for a full page with the Follow form", () => {
    const items = launchChecklist({ name: "Maple Bakes", content: page() });
    expect(items.map((i) => i.id)).toEqual(["phone", "visitor_action", "sharing", "search", "consent"]);
    expect(items.every((i) => i.ready)).toBe(true);
  });

  it("offers the Follow form when it is off, and drops the email item because nothing is collected", () => {
    const items = launchChecklist({ name: "Maple Bakes", content: page({ followForm: false, about: "Short." }) });
    const act = items.find((i) => i.id === "visitor_action")!;
    expect(act.ready).toBe(false);
    expect(act.action).toEqual({ id: "turn_on_follow", label: "Turn on the Follow form" });
    expect(items.find((i) => i.id === "search")!.ready).toBe(false);
    expect(items.some((i) => i.id === "consent")).toBe(false);
  });

  it("never mentions people, cofounders or being behind", () => {
    const text = launchChecklist({ name: "M", content: page({ followForm: false, pitch: "", about: "" }) })
      .flatMap((i) => [i.label, i.line, i.action?.label ?? ""])
      .join(" ");
    expect(text).not.toMatch(/cofounder|collaborator|people|behind|unfinished|must|required/i);
  });

  it("is the first launch only before the page was ever public", () => {
    expect(isFirstLaunch({ live: false, publishedAt: null, unpublishedAt: null })).toBe(true);
    expect(isFirstLaunch({ live: true, publishedAt: "2026-11-20", unpublishedAt: null })).toBe(false);
    expect(isFirstLaunch({ live: false, publishedAt: "2026-11-20", unpublishedAt: "2026-11-21" })).toBe(false);
  });
});

describe("siteLaunchChecklist", () => {
  const full = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Maple Bakes</title><meta name="description" content="Fresh bread on your street"><meta property="og:image" content="/share.png"></head><body><form method="post" action="/_fm/follow"><input type="email" name="email" required></form></body></html>`;

  it("reads a home page with every basic as ready", () => {
    const items = siteLaunchChecklist([{ path: "index.html", text: full }]);
    expect(items.map((i) => [i.id, i.ready])).toEqual([["phone", true], ["visitor_action", true], ["sharing", true], ["search", true], ["consent", true]]);
  });

  it("reads a bare page as Not yet, finds a pay button on another page, and drops the email item without a sign-up", () => {
    const items = siteLaunchChecklist([{ path: "index.html", text: "<html><body><h1>Hi</h1></body></html>" }, { path: "pricing.html", text: '<a href="/_fm/pay/basic">Pay</a>' }]);
    expect(items.map((i) => [i.id, i.ready])).toEqual([["phone", false], ["visitor_action", true], ["sharing", false], ["search", false]]);
    expect(items.find((i) => i.id === "search")!.line).toBe("The home page has no title or description for search results yet. The team can write them.");
  });

  it("round-trips through the stored form and refuses anything else", () => {
    const items = siteLaunchChecklist([{ path: "index.html", text: full }]);
    expect(readLaunchChecklist(JSON.parse(JSON.stringify(items)))).toEqual(items);
    for (const bad of [null, [], "x", [{ id: "people", label: "x", ready: true, line: "x" }], [{ id: "phone", ready: "yes" }]]) expect(readLaunchChecklist(bad)).toBeNull();
  });
});
