import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { ALL_TEMPLATES } from "@foundmill/agents";
import { resolveGrants } from "@foundmill/connectors";
import { runCliLogoEval } from "../cli-logo";

let h: TestHarness;
let db: Db;
beforeAll(async () => { h = await createTestDb(); db = h.db as unknown as Db; });
afterAll(async () => { await h.close?.(); });

describe("CLI-Anything logo eval", () => {
  it("a Design agent makes a logo from the brand colors, and release_output puts it on the page", async () => {
    const b = await repos.businesses.create(db, { name: "Northwind Skincare" });
    const r = await runCliLogoEval(db, { businessId: b.id, name: "Northwind", primary: "#2b6cb0", secondary: "#f5b841" });
    expect(r.problems).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.logoDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });
  it("the Design roles hold the tools that make it", () => {
    for (const key of ["design_to_code", "packaging_design"]) {
      const t = ALL_TEMPLATES.find((x) => x.key === key)!;
      const g = t.tools.find((x) => x.connectorKey === "cli_inkscape")!;
      expect(g, key).toBeDefined();
      expect(resolveGrants([g]).toolRefs).toEqual(expect.arrayContaining(["cli_inkscape:add_rect", "cli_inkscape:export", "cli_inkscape:release_output"]));
    }
  });
});
