import { describe, expect, it } from "vitest";
import { browserSiteRows, type BrowserCatalogueEntry } from "../BrowserSitesSection";

const entry = (key: string, over: Partial<BrowserCatalogueEntry> = {}): BrowserCatalogueEntry => ({ key, browser: { siteKey: key.replace("browser_", ""), name: key, state: "ask_first" }, available: true, integration: null, ...over });

describe("browserSiteRows", () => {
  it("lists only hosted-browser sites, with their connection state", () => {
    const rows = browserSiteRows([
      entry("browser_carrd"),
      entry("browser_linktree", { integration: { id: "i1", status: "connected" } }),
      entry("browser_wave", { integration: { id: "i2", status: "expired" } }),
      entry("browser_old", { integration: { id: "i3", status: "disconnected" } }),
      { key: "github", browser: null, available: true, integration: null },
    ]);
    expect(rows.map((r) => [r.siteKey, r.status])).toEqual([["carrd", "not_connected"], ["linktree", "connected"], ["wave", "expired"], ["old", "not_connected"]]);
  });

  it("hides a site that cannot be connected here, unless it is already connected", () => {
    const rows = browserSiteRows([entry("browser_a", { available: false }), entry("browser_b", { available: false, integration: { id: "i", status: "connected" } })]);
    expect(rows.map((r) => r.siteKey)).toEqual(["b"]);
  });
});
