import { describe, expect, it } from "vitest";
import { EXPLAINERS } from "@foundmill/modules/explainers";
import { SETTINGS_TABS } from "../search";

describe("Settings explainers (WP-10 T3)", () => {
  it("every Settings tab has an Explain this page entry", () => {
    for (const t of SETTINGS_TABS) expect(EXPLAINERS[`settings/${t.slug}`], t.slug).toBeDefined();
  });
});
