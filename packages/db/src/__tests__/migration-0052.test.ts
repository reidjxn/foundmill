/**
 * 0052 over data that already exists: a physical-product business's Operations department keeps only the Specialists and
 * Plan tabs (Specialists first) instead of a copy of every Development tab (DB-11). Tabs a founder changed, Development
 * itself and a department a founder named Operations in another archetype are left alone.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";

const TAG = "0052_product_development";
const DEV_TABS = ["training-ground", "plan", "pull-requests", "code", "environments", "specialists"];
let h: TestHarness;
const dept: Record<"hardwareOps" | "hardwareDev" | "customizedOps" | "saasOps", string> = { hardwareOps: "", hardwareDev: "", customizedOps: "", saasOps: "" };

const layout = (slug: string) => JSON.stringify({ widgets: [{ key: `module:development/${slug}`, x: 0, y: 0, w: 12, h: 60, settings: {} }] });

beforeAll(async () => {
  const all = readMigrations();
  h = await createTestDb({ migrations: all.filter((m) => m.tag !== TAG) });
  const owner = await h.createUser("owner@m52.test");
  const business = async (name: string, archetype: string) => (await h.pg.query<{ id: string }>(`insert into businesses (name, slug, created_by, archetype) values ($1, $1, $2, $3) returning id`, [name, owner, archetype])).rows[0]!.id;
  const department = async (businessId: string, slug: string) => (await h.pg.query<{ id: string }>(`insert into departments (business_id, name, slug, module_keys) values ($1, $2, $2, '{development}') returning id`, [businessId, slug])).rows[0]!.id;
  const tabs = async (businessId: string, departmentId: string, custom: Record<string, string> = {}) => {
    for (const [position, slug] of DEV_TABS.entries()) {
      await h.pg.query(`insert into screen_definitions (business_id, department_id, tab_slug, title, position, layout) values ($1, $2, $3, $3, $4, $5::jsonb)`, [businessId, departmentId, slug, position, custom[slug] ?? layout(slug)]);
    }
  };
  const hardware = await business("m52-hardware", "hardware");
  dept.hardwareOps = await department(hardware, "operations");
  dept.hardwareDev = await department(hardware, "development");
  await tabs(hardware, dept.hardwareOps);
  await tabs(hardware, dept.hardwareDev);
  const physical = await business("m52-physical", "dtc_physical");
  dept.customizedOps = await department(physical, "operations");
  // The founder put a chart on the Code tab: it is theirs now and stays.
  await tabs(physical, dept.customizedOps, { code: JSON.stringify({ widgets: [{ key: "chart:burn", x: 0, y: 0, w: 6, h: 20, settings: {} }] }) });
  const saas = await business("m52-saas", "b2b_saas");
  dept.saasOps = await department(saas, "operations");
  await tabs(saas, dept.saasOps);
  await h.pg.exec(all.find((m) => m.tag === TAG)!.sql);
});
afterAll(() => h?.close());

const tabsOf = async (departmentId: string) =>
  ((await h.db.execute(sql`select tab_slug, position from screen_definitions where department_id = ${departmentId} order by position, tab_slug`)) as unknown as { rows: { tab_slug: string; position: number }[] }).rows;

describe("0052 applied over existing rows", () => {
  it("trims a physical business's Operations to Specialists then Plan", async () => {
    expect(await tabsOf(dept.hardwareOps)).toEqual([
      { tab_slug: "specialists", position: 0 },
      { tab_slug: "plan", position: 1 },
    ]);
  });

  it("leaves Development, customized tabs and other archetypes' departments alone", async () => {
    expect((await tabsOf(dept.hardwareDev)).map((t) => t.tab_slug)).toEqual(DEV_TABS);
    const customized = (await tabsOf(dept.customizedOps)).map((t) => t.tab_slug);
    expect(customized).toContain("code");
    expect(customized).not.toContain("training-ground");
    expect(customized).not.toContain("pull-requests");
    expect((await tabsOf(dept.saasOps)).map((t) => t.tab_slug)).toEqual(DEV_TABS);
  });
});
