import { describe, expect, it } from "vitest";
import { activityItems, applyChipFilters, commercialSummary, deletionRequestNote, documentItems, exportEntityJson, groupByForView, groupCounts, introPaths, isEntityTab, leadScore, mergeBanner, relationshipStrength, rowFromEntity, rowsFromSearch, strengthRating, CRM_VIEWS, type EntityGet, type RelationshipRecord } from "../logic";
import { parseCrmQuery } from "../search";

const entity = (over: Record<string, unknown> = {}) => ({ id: "e1", businessId: "b", kind: "person", displayName: "Ana Lind", aliases: [], avatarUrl: null, identifiers: { email: "ana@example.com" }, lawfulBasis: "contract", source: "stripe", embedding: null, search: null, visibility: "private", agentId: null, mergedIntoId: null, createdAt: new Date("2026-01-10"), updatedAt: new Date("2026-09-01"), archivedAt: null, ...over });
const role = (over: Record<string, unknown> = {}) => ({ id: "r1", businessId: "b", entityId: "e1", role: "customer", stage: "customer", ownerRef: { kind: "agent", id: "a1" }, startedAt: new Date("2026-02-01"), endedAt: null, createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-01"), ...over });
const rel = (over: Partial<RelationshipRecord> & { other?: Partial<RelationshipRecord["other"]> } = {}): RelationshipRecord => ({ id: "x", businessId: "b", fromEntity: "e1", toEntity: "e2", type: "works_with", strength: "0.5", createdAt: new Date(), updatedAt: new Date(), ...over, other: { id: "e2", kind: "person", displayName: "Bo", ...(over.other ?? {}) } }) as RelationshipRecord;

describe("rows", () => {
  it("builds a row with the primary active role's stage and owner", () => {
    const row = rowFromEntity(entity() as never, [role({ role: "lead", stage: "qualified", startedAt: new Date("2026-01-15"), endedAt: new Date("2026-02-01") }), role()] as never);
    expect(row).toMatchObject({ id: "e1", name: "Ana Lind", email: "ana@example.com", roles: ["customer"], stage: "customer", owner: { kind: "agent", id: "a1" }, lawfulBasis: "contract" });
  });
  it("speaks for the role a role or stage filter names, else the most recent one", () => {
    const roles = [role({ role: "customer", stage: "activated" }), role({ id: "r2", role: "lead", stage: "qualified", ownerRef: { kind: "department", id: "d1" }, startedAt: new Date("2026-01-01") })];
    expect(rowFromEntity(entity() as never, roles as never)).toMatchObject({ roles: ["customer", "lead"], stage: "activated", owner: { kind: "agent", id: "a1" } });
    expect(rowFromEntity(entity() as never, roles as never, { role: "lead" })).toMatchObject({ stage: "qualified", owner: { kind: "department", id: "d1" } });
    expect(rowFromEntity(entity() as never, roles as never, { stage: "QUALIFIED" })).toMatchObject({ stage: "qualified" });
    expect(rowFromEntity(entity() as never, roles as never, { role: "partner" })).toMatchObject({ stage: "activated" });
  });
  it("keeps search scores and roles, and filters client-side by chips with resolvers", () => {
    const rows = rowsFromSearch([{ entity: entity() as never, roles: [role({ role: "supplier", stage: "shortlisted" })], score: 0.9, matchedOn: "name" }] as never);
    expect(rows[0]).toMatchObject({ score: 0.9, matchedOn: "name", roles: ["supplier"], stage: "shortlisted", owner: { kind: "agent", id: "a1" } });
    const listed = [rowFromEntity(entity() as never, [role()] as never), rowFromEntity(entity({ id: "e2", kind: "organisation", displayName: "Acme" }) as never, [role({ role: "supplier", stage: "shortlisted", ownerRef: { kind: "department", id: "d1" } })] as never)];
    const owner = applyChipFilters(listed, parseCrmQuery("owner:Mara").chips, { ownerName: (ref) => (ref.id === "a1" ? "Mara" : undefined) });
    expect(owner.map((r) => r.id)).toEqual(["e1"]);
    expect(applyChipFilters(listed, parseCrmQuery("kind:organisation stage:shortlisted").chips).map((r) => r.id)).toEqual(["e2"]);
    expect(applyChipFilters(listed, parseCrmQuery("department:Growth").chips, { departmentName: (id) => (id === "d1" ? "Growth" : undefined) }).map((r) => r.id)).toEqual(["e2"]);
  });
  it("counts groups and reads the grouping from the saved view", () => {
    const listed = [rowFromEntity(entity() as never, [role()] as never), rowFromEntity(entity({ id: "e2" }) as never, [role({ role: "lead", stage: "signed_up" }), role({ id: "r3", role: "champion" })] as never)];
    expect(groupCounts(listed, "role")).toEqual([
      { key: "champion", count: 1 },
      { key: "customer", count: 1 },
      { key: "lead", count: 1 },
    ]);
    expect(groupByForView(CRM_VIEWS.find((v) => v.id === "by-stage"))).toBe("stage");
    expect(groupByForView(CRM_VIEWS.find((v) => v.id === "by-role"))).toBe("role");
    expect(groupByForView(CRM_VIEWS.find((v) => v.id === "all"))).toBeNull();
  });
});

describe("profile derivations", () => {
  it("maps 0–1 strength to the 1–20 ramp and prefers ties to the business's own people", () => {
    expect(strengthRating("0")).toBe(1);
    expect(strengthRating(1)).toBe(20);
    expect(strengthRating("0.5")).toBe(11);
    const s = relationshipStrength([rel({ strength: "0.9" }), rel({ strength: "0.4", other: { id: "m1", kind: "team_member", displayName: "You" } })]);
    expect(s.rating).toBe(9);
    expect(s.via?.other.id).toBe("m1");
  });
  it("scores leads from stage, recent activity and strength (Estimate), capped at five stars", () => {
    const now = new Date("2026-10-07");
    const paying = leadScore([role({ stage: "customer" })] as never, [{ occurredAt: new Date("2026-10-01") }, { occurredAt: new Date("2026-09-30") }], 14, now);
    expect(paying.stars).toBe(5);
    expect(paying.reasons).toEqual(["Stage: customer", "2 interactions in 30 days", "Relationship 14/20"]);
    expect(leadScore([role({ role: "lead", stage: null })] as never, [], 3, now)).toEqual({ stars: 1.5, reasons: ["Lead"] });
    expect(leadScore([], [], 1, now).stars).toBe(0);
  });
  it("ranks intro paths by strength and skips venues", () => {
    const paths = introPaths("Acme", [rel({ strength: "0.3" }), rel({ strength: "0.8", other: { id: "ag", kind: "agent", displayName: "Mara" } }), rel({ strength: "0.9", other: { id: "v", kind: "venue", displayName: "Hall" } })]);
    expect(paths.map((p) => p.via.id)).toEqual(["ag", "e2"]);
    expect(paths[0]!.label).toBe("You → Mara → Acme");
  });
  it("summarises commercial history and lists activity newest first", () => {
    const conversions = [
      { id: "c1", kind: "signup", amountMinor: 0, currency: "EUR", occurredAt: new Date("2026-01-01") },
      { id: "c2", kind: "payment", amountMinor: 4900, currency: "EUR", occurredAt: new Date("2026-02-01") },
      { id: "c3", kind: "payment", amountMinor: 4900, currency: "EUR", occurredAt: new Date("2026-04-01") },
    ] as never[];
    const s = commercialSummary(conversions as never, "SEK");
    expect(s).toMatchObject({ payments: 2, totalMinor: 9800, currency: "EUR", monthlyMinor: 3267, signedUpAt: "2026-01-01T00:00:00.000Z" });
    const items = activityItems({ interactions: [{ id: "i1", kind: "email", occurredAt: new Date("2026-03-01"), direction: "inbound", summary: "Asked about pricing", agentId: null, contentRef: "vault://x" }], mentions: [{ id: "m1", containerKind: "inbox_item", containerId: "n1", createdAt: new Date("2026-05-01") }], conversions } as never, { inbox: (id) => `/inbox/${id}`, journey: (id) => `/j/${id}` });
    expect(items.map((i) => i.id)).toEqual(["m-m1", "c-c3", "i-i1", "c-c2", "c-c1"]);
    expect(items[0]!.href).toBe("/inbox/n1");
    const docs = documentItems({ interactions: [{ id: "i1", kind: "email", occurredAt: new Date(), summary: "", contentRef: "vault://x" }], mentions: [{ id: "m2", containerKind: "spec_block", containerId: "s1", createdAt: new Date() }] } as never, { inbox: (id) => id });
    expect(docs.map((d) => [d.kind, d.encrypted])).toEqual([
      ["email", true],
      ["spec_block", false],
    ]);
  });
});

describe("data duties and merges", () => {
  const get = { entity: entity(), roles: [role()], relationships: [rel()], interactions: [{ id: "i1", kind: "email", occurredAt: new Date("2026-03-01"), direction: "inbound", summary: "s", contentRef: "vault://x" }], mentions: [], conversions: [], mergeHistory: [{ id: "ml", keptId: "e1", mergedId: "e9", byKind: "user", byId: null, revertedAt: null, createdAt: new Date("2026-06-01"), undoBlocked: null }], redirectedFrom: null } as unknown as EntityGet;
  it("exports everything held without decrypting bodies", () => {
    const json = JSON.parse(exportEntityJson(get, new Date("2026-10-07T00:00:00Z")));
    expect(json.entity.displayName).toBe("Ana Lind");
    expect(json.interactions[0].bodyRef).toBe("vault://x");
    expect(json.interactions[0].body).toBeUndefined();
    expect(json.merges).toHaveLength(1);
  });
  it("writes the deletion request for the scheduled job", () => {
    expect(deletionRequestNote("the founder", new Date("2026-10-07T10:00:00Z"))).toMatch(/^Deletion requested by the founder on Oct 7, 2026\. Runs in the scheduled, audited deletion job/);
  });
  it("describes open merges and redirects", () => {
    expect(mergeBanner(get)).toMatchObject({ redirected: false, absorbed: [{ id: "ml" }] });
    expect(mergeBanner({ ...get, redirectedFrom: "e9" }).redirected).toBe(true);
    expect(mergeBanner({ ...get, mergeHistory: [{ ...get.mergeHistory[0]!, revertedAt: new Date() }] }).absorbed).toEqual([]);
  });
  it("knows its tabs", () => {
    expect(isEntityTab("journey")).toBe(true);
    expect(isEntityTab("billing")).toBe(false);
  });
});
