/**
 * 0077 over businesses that already exist: every department that shows the Product module's Specification tab gains
 * "Public page" right after it, later tabs move one place along, a department without Specification is left alone, and
 * running the two statements again adds nothing.
 */
import { MODULE_TABS } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";

const TAG = "0077_project_pages";
let h: TestHarness;
let productDept = "";
let opsDept = "";
let mergedDept = "";

const tabs = async (departmentId: string) => (await h.pg.query<{ tab_slug: string; position: number; title: string; layout: unknown }>(`select tab_slug, position, title, layout from screen_definitions where department_id = $1 order by position, tab_slug`, [departmentId])).rows;

beforeAll(async () => {
  const all = readMigrations();
  // Everything before 0077 (later migrations, such as 0079, build on its table).
  h = await createTestDb({ migrations: all.filter((m) => m.tag < TAG) });
  const owner = await h.createUser("owner@m77.test");
  const businessId = (await h.pg.query<{ id: string }>(`insert into businesses (name, slug, created_by) values ('m77', 'm77', $1) returning id`, [owner])).rows[0]!.id;
  const dept = async (slug: string, modules: string[]) => (await h.pg.query<{ id: string }>(`insert into departments (business_id, name, slug, module_keys) values ($1, $2, $2, $3::text[]) returning id`, [businessId, slug, modules])).rows[0]!.id;
  const screens = async (departmentId: string, slugs: string[]) => {
    for (const [position, slug] of slugs.entries()) await h.pg.query(`insert into screen_definitions (business_id, department_id, tab_slug, title, position) values ($1, $2, $3, $3, $4)`, [businessId, departmentId, slug, position]);
  };
  productDept = await dept("product", ["product"]);
  await screens(productDept, ["vision", "specification", "roadmap", "changes", "sources", "research"]);
  // A department over another module, and one whose founder merged Product into it.
  opsDept = await dept("operations", ["development"]);
  await screens(opsDept, ["specialists", "plan"]);
  mergedDept = await dept("growth", ["distribution", "product"]);
  await screens(mergedDept, ["formation", "leads", "specification", "roadmap"]);
  await h.pg.exec(all.find((m) => m.tag === TAG)!.sql);
});
afterAll(() => h?.close());

describe("0077 applied over existing departments", () => {
  it("adds Public page right after Specification, in the module's own order", async () => {
    const product = await tabs(productDept);
    expect(product.map((t) => t.tab_slug)).toEqual(MODULE_TABS.product.map((t) => t.slug));
    expect(product.map((t) => t.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const added = product.find((t) => t.tab_slug === "public-page")!;
    expect(added.title).toBe(MODULE_TABS.product.find((t) => t.slug === "public-page")!.title);
    expect(added.layout).toEqual({ widgets: [{ key: "module:product/public-page", x: 0, y: 0, w: 12, h: 60, settings: {} }] });
  });

  it("does the same in a merged department and leaves other departments alone", async () => {
    expect((await tabs(mergedDept)).map((t) => t.tab_slug)).toEqual(["formation", "leads", "specification", "public-page", "roadmap"]);
    expect((await tabs(opsDept)).map((t) => t.tab_slug)).toEqual(["specialists", "plan"]);
  });

  it("is safe to run twice", async () => {
    const statements = readMigrations().find((m) => m.tag === TAG)!.statements.filter((st) => /screen_definitions s\b|insert into screen_definitions/.test(st));
    expect(statements).toHaveLength(2);
    for (const st of statements) await h.pg.exec(st);
    expect((await tabs(productDept)).map((t) => [t.tab_slug, t.position])).toEqual(MODULE_TABS.product.map((t, i) => [t.slug, i]));
  });
});
