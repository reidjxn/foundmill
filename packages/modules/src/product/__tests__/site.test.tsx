/**
 * Product › Site (WP-07 T5): empty until the team's first version; versions with their preview link; a held version
 * in plain words; Publish and Take down call the site procedures; read-only for a member who cannot publish.
 */
import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { summarizePageVisits } from "@foundmill/shared/page-visits";
import { SITE_WORDS, SiteScreen, type SiteViewResponse } from "../SiteScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID } from "./fixtures";

const preview = { id: "r1", number: 1, state: "preview" as const, flags: [], heldSentence: null, previewUrl: "https://p-abc.sites.example/", taskTitle: "Build the offer page", createdAt: "2026-11-16T12:00:00Z", isLive: false };
const held = { id: "r2", number: 2, state: "held" as const, flags: [{ rule: "script", path: "index.html", detail: "<script>" }], heldSentence: "Held back: it contains a script. The next round of work fixes it.", previewUrl: null, taskTitle: null, createdAt: "2026-11-16T13:00:00Z", isLive: false };
const view = (over: Partial<SiteViewResponse> = {}): SiteViewResponse => ({
  enabled: true,
  site: { slug: "lunchbox", status: "draft", url: "https://lunchbox.sites.example/", liveReleaseNumber: null, publishedAt: null },
  releases: [held, preview],
  canPublish: true,
  ...over,
});
const render = (v: SiteViewResponse, onMutate?: (path: string, input: Record<string, unknown>) => unknown) => {
  const fake = createFakeSource({ businessId: BID, responses: { "site.get": v }, onMutate });
  renderScreen(fake, <SiteScreen businessId={BID} departmentId="d1" />);
  return fake;
};

describe("SiteScreen", () => {
  it("shows the live site's visits by source, labeled an estimate, and none on a draft (0176)", async () => {
    const visits = summarizePageVisits([{ day: "2026-11-24", source: "social", visits: 4 }], new Date("2026-11-25T12:00:00Z"));
    render(view({ site: { slug: "lunchbox", status: "live", url: "https://lunchbox.sites.example/", liveReleaseNumber: 1, publishedAt: "2026-11-20T12:00:00Z" }, visits }));
    const box = await screen.findByTestId("page-visits");
    expect(box.textContent).toContain("4 visits in the last 7 days, 4 in the last 28 days. Estimate");
    expect(box.textContent).toContain(SITE_WORDS.visitsNote);
    expect(screen.getByTestId("page-visit-sources").textContent).toBe("Social sites 4");
  });

  it("shows no visits on a draft site with none counted", async () => {
    render(view({ visits: summarizePageVisits([], new Date("2026-11-25T12:00:00Z")) }));
    await screen.findByTestId("site-panel");
    expect(screen.queryByTestId("page-visits")).toBeNull();
  });

  it("says the team has not built a site yet", async () => {
    render(view({ site: null, releases: [] }));
    expect((await screen.findByTestId("site-empty")).textContent).toContain(SITE_WORDS.empty);
  });

  it("lists versions with the preview link and a held one in plain words", async () => {
    render(view());
    expect((await screen.findByTestId("site-preview-link"))?.getAttribute("href")).toBe("https://p-abc.sites.example/");
    expect((screen.getByTestId("site-preview-link"))?.getAttribute("target")).toBe("_blank");
    expect((screen.getByTestId("site-held")).textContent).toContain("Held back: it contains a script.");
    expect(screen.getAllByTestId("site-publish")).toHaveLength(1);
  });

  it("publishes a version with one press", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    render(view(), (path, input) => {
      calls.push([path, input]);
      return { outcome: "published", url: "https://lunchbox.sites.example/", view: view() };
    });
    await act(async () => fireEvent.click(await screen.findByTestId("site-publish")));
    expect(calls).toEqual([["site.publish", { releaseId: "r1" }]]);
    expect((await screen.findByTestId("site-notice")).textContent).toContain("Your site is live at https://lunchbox.sites.example/");
  });

  it("shows the live address and Take down", async () => {
    const calls: string[] = [];
    render(view({ site: { slug: "lunchbox", status: "live", url: "https://lunchbox.sites.example/", liveReleaseNumber: 1, publishedAt: "2026-11-16T12:00:00Z" }, releases: [{ ...preview, isLive: true }] }), (path) => {
      calls.push(path);
      return view();
    });
    expect(((await screen.findByTestId("site-address")).querySelector("a"))?.getAttribute("href")).toBe("https://lunchbox.sites.example/");
    expect(screen.queryByTestId("site-publish")).toBeNull();
    await act(async () => fireEvent.click(screen.getByTestId("site-take-down")));
    expect(calls).toEqual(["site.unpublish"]);
  });

  it("is read-only for someone who cannot publish", async () => {
    render(view({ canPublish: false }));
    expect(await screen.findByText(SITE_WORDS.readOnly)).toBeTruthy();
    expect(screen.queryByTestId("site-publish")).toBeNull();
  });
});
