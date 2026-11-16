/**
 * The specialists' CRM tools (WP-07 T1): `create_entity` records a supplier once, with its role and the page it was
 * found on; `log_interaction` adds a note to its history; both are audited as the agent, refuse another business's
 * records, and refuse contact details when the session's sources were simulated.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type Db } from "@foundmill/db";
import { PlatformToolError, type PlatformCaller } from "@foundmill/connectors";
import { createDbPlatformHost } from "../platform-host";
import { AUDIT_ACTION_TOOL_CALL } from "../pipeline";
import { silentLog } from "./harness";

let h: TestHarness;
let db: Db;
let a: PlatformCaller;
let b: PlatformCaller;
let simulated: PlatformCaller;

const supplier = { kind: "organisation" as const, name: "Hallbergs Packaging AB", role: "supplier" as const, sourceUrl: "https://example.com/hallbergs" };

async function caller(name: string): Promise<PlatformCaller> {
  const biz = await repos.businesses.create(db, { name });
  const agent = await repos.agents.create(db, biz.id, { name: "Sourcing", agentType: "sourcing_manufacturing", modelKey: "sonnet" });
  const session = await repos.agents.createSession(db, biz.id, { agentId: agent.id, modelKey: "sonnet" });
  return { businessId: biz.id, agentId: agent.id, sessionId: session.id };
}

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  a = await caller("Alpha");
  b = await caller("Beta");
  simulated = await caller("Gamma");
  // A session that already did something through a mock connector built on simulated results.
  await repos.audit.append(db, simulated.businessId, { actorKind: "agent", actorId: simulated.agentId, action: AUDIT_ACTION_TOOL_CALL, target: { kind: "tool", id: "web.search" }, details: { sessionId: simulated.sessionId, outcome: "allow", mode: "mock" } });
}, 120_000);

afterAll(async () => {
  await h.close();
});

const host = () => createDbPlatformHost({ db, log: silentLog });

describe("create_entity and log_interaction", () => {
  it("records a supplier once with its role and source, audited as the agent", async () => {
    const first = await host().createEntity(a, supplier);
    expect(first.created).toBe(true);
    const again = await host().createEntity(a, { ...supplier, name: "  hallbergs packaging ab " });
    expect(again).toEqual({ entityId: first.entityId, created: false });
    const entity = await repos.entities.get(db, a.businessId, first.entityId);
    expect(entity).toMatchObject({ kind: "organisation", displayName: "Hallbergs Packaging AB", agentId: a.agentId });
    expect(entity.identifiers).toMatchObject({ sourceUrl: supplier.sourceUrl });
    expect((await repos.entities.listRoles(db, a.businessId, first.entityId)).map((r) => r.role)).toEqual(["supplier"]);
    // Customers finds it by the role the founder filters on.
    expect((await repos.entities.search(db, a.businessId, { q: "", role: "supplier", limit: 10 })).hits.map((x) => x.entity.id)).toContain(first.entityId);
    const rows = await repos.audit.list(db, a.businessId, { action: "platform.entity.created", limit: 10 });
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]).toMatchObject({ actorKind: "agent", actorId: a.agentId });
  });

  it("logs an interaction on a record of the business", async () => {
    const { entityId } = await host().createEntity(a, supplier);
    const { interactionId } = await host().logInteraction(a, { entityId, summary: "Price list received, MOQ 500.", sourceUrl: "https://example.com/prices" });
    const page = await repos.entities.listInteractions(db, a.businessId, { entityId, limit: 10 });
    expect(page.items.find((i) => i.id === interactionId)).toMatchObject({ kind: "note", direction: "internal", agentId: a.agentId });
    expect(page.items.find((i) => i.id === interactionId)?.summary).toContain("https://example.com/prices");
  });

  it("an agent of another business cannot read or write this business's records", async () => {
    const { entityId } = await host().createEntity(a, supplier);
    await expect(host().logInteraction(b, { entityId, summary: "Not yours." })).rejects.toBeInstanceOf(PlatformToolError);
    expect((await host().createEntity(b, supplier)).entityId).not.toBe(entityId);
    expect((await repos.entities.listInteractions(db, a.businessId, { entityId, limit: 10 })).items.some((i) => i.summary === "Not yours.")).toBe(false);
  });

  it("refuses an email address or phone number when the session's sources were simulated, and allows them otherwise", async () => {
    await expect(host().createEntity(simulated, { ...supplier, name: "Acme sales@acme.example" })).rejects.toMatchObject({ code: "invalid_state" });
    const { entityId } = await host().createEntity(simulated, supplier);
    await expect(host().logInteraction(simulated, { entityId, summary: "Call +46 8 123 456 78" })).rejects.toMatchObject({ code: "invalid_state" });
    const real = await host().createEntity(a, { ...supplier, name: "Nordic Labs sales@nordic.example" });
    expect(real.created).toBe(true);
  });
});
