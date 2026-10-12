/** portability (Settings › Danger zone "Export everything", BUILD §11.15): table classification, paging, redaction, tenancy. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPORT_EXCLUDED_TABLES, EXPORT_TABLES, portableValue, repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("port");
});
afterAll(() => r?.close());

/** Every row of a table for a business, paged the way business.export pages it. */
async function readAll(tx: Parameters<typeof repos.portability.page>[0], businessId: string, table: string, limit = 2) {
  const out: Record<string, unknown>[] = [];
  let after: string | null = null;
  do {
    const page = await repos.portability.page(tx, businessId, table, { after, limit });
    out.push(...page.rows);
    after = page.nextAfter;
  } while (after);
  return out;
}

describe("portability", () => {
  it("classifies every business-scoped table exactly once: exported, or left out with a reason", async () => {
    const scoped = repos.portability.businessScopedTables();
    expect(scoped.length).toBeGreaterThan(60);
    // A new table with a business_id column must be added to EXPORT_TABLES or EXPORT_EXCLUDED_TABLES (portability.ts).
    const unclassified = scoped.filter((name) => !(name in EXPORT_TABLES) && !(name in EXPORT_EXCLUDED_TABLES));
    expect(unclassified).toEqual([]);
    expect(Object.keys(EXPORT_TABLES).filter((name) => name in EXPORT_EXCLUDED_TABLES)).toEqual([]);
    expect([...Object.keys(EXPORT_TABLES), ...Object.keys(EXPORT_EXCLUDED_TABLES)].filter((name) => !scoped.includes(name))).toEqual([]);
    // The tables the first export left out are in it now.
    for (const name of ["agent_threads", "agent_messages", "business_foundations", "plans", "plan_actions", "decisions", "approvals", "interactions", "relationships", "sources", "usage_ledger", "filings", "incorporations", "playbooks", "dashboard_layouts", "screen_definitions", "business_logos", "holiday_periods", "touches", "visitors"]) {
      expect(EXPORT_TABLES[name], name).toBeDefined();
    }
    expect(EXPORT_TABLES.credentials).toBeUndefined();
    await expect(repos.portability.page(r.db, r.A.businessId, "credentials")).rejects.toThrow(/not exported/);
  });

  it("pages a table to exhaustion in id order, one business only", async () => {
    const rows = await readAll(r.db, r.A.businessId, "tasks", 2);
    const direct = await r.svc((tx) => repos.tasks.list(tx, r.A.businessId, { limit: 500 }));
    expect(rows.length).toBe(direct.items.length);
    expect(rows.length).toBeGreaterThan(2); // more than one page
    expect(new Set(rows.map((t) => t.id)).size).toBe(rows.length);
    expect(rows.map((t) => String(t.id))).toEqual([...rows.map((t) => String(t.id))].sort());
    expect(rows.every((t) => t.businessId === r.A.businessId)).toBe(true);
    expect(typeof rows[0]!.createdAt).toBe("string"); // dates are ISO strings in the archive
  });

  it("keeps connector plumbing and bank identifiers out of the rows", async () => {
    const [integration] = await readAll(r.db, r.A.businessId, "integrations");
    expect(Object.keys(integration!).sort()).toEqual(["accountLabel", "authKind", "connectorKey", "createdAt", "id", "lastError", "lastHealthAt", "scopes", "status", "updatedAt"]);
    const [account] = await readAll(r.db, r.A.businessId, "accounts");
    expect(account).not.toHaveProperty("externalId");
    expect(account!.name).toBe("Main");
    const members = await readAll(r.db, r.A.businessId, "memberships");
    expect(members.every((m) => Object.keys(m).sort().join() === "createdAt,id,role,userId")).toBe(true);
    expect(portableValue(new Uint8Array([1, 2, 3]))).toEqual({ encoding: "base64", data: "AQID" });
  });

  it("runs under RLS: a member reads their business, a stranger reads nothing (cross-tenant)", async () => {
    const asOwner = await r.as(r.A.ownerId, (tx) => readAll(tx, r.A.businessId, "entities", 50));
    expect(asOwner.length).toBeGreaterThanOrEqual(2);
    const asStranger = await r.as(r.B.ownerId, (tx) => readAll(tx, r.A.businessId, "entities", 50));
    expect(asStranger).toEqual([]);
    const transactions = await r.as(r.B.ownerId, (tx) => readAll(tx, r.A.businessId, "conversions", 50));
    expect(transactions).toEqual([]);
  });
});
