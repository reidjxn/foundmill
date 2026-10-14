/**
 * crm.entity.list / crm.search carry each record's active roles and filter on them (the list's role and stage views,
 * chips and natural-language filters), and crm.entity.unmerge reverts only what its merge changed: later edits and
 * independent later merges survive, and a merge a later one relies on is refused with the reason (AC-11.12.3).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { createApiHarness, type ApiHarness } from "./harness";

describe("crm", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "crm" });
  }, 120_000);
  afterAll(() => hz.close());

  it("lists and searches records with their active roles, stage and owner, and filters on them server-side", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId, agentId, departmentId } = hz.A;
    const supplier = await owner.crm.entity.create({ businessId, kind: "organisation", displayName: "Fjord Bottling AB" });
    const customer = await owner.crm.entity.create({ businessId, kind: "person", displayName: "Lena Fjordsen" });
    await owner.crm.roles.add({ businessId, entityId: supplier.id, role: { role: "supplier", stage: "shortlisted", ownerRef: { kind: "department", id: departmentId } } });
    await owner.crm.roles.add({ businessId, entityId: customer.id, role: { role: "customer", stage: "churned", ownerRef: { kind: "agent", id: agentId } } });

    const list = await owner.crm.entity.list({ businessId, limit: 500 });
    const row = (id: string) => list.items.find((e) => e.id === id)!;
    expect(row(supplier.id).roles).toEqual([expect.objectContaining({ role: "supplier", stage: "shortlisted", ownerRef: { kind: "department", id: departmentId } })]);
    expect(row(customer.id).roles.map((r) => r.role)).toEqual(["customer"]);
    expect(row(hz.A.entityId).roles).toEqual([]);

    const ids = async (filter: Record<string, unknown>) => (await owner.crm.entity.list({ businessId, limit: 500, ...filter })).items.map((e) => e.id);
    expect(await ids({ kind: "organisation", role: "supplier" })).toEqual([supplier.id]);
    expect(await ids({ role: "customer", stage: "churned" })).toEqual([customer.id]);
    expect(await ids({ ownerId: agentId })).toEqual([customer.id]);
    expect(await ids({ departmentId })).toEqual([supplier.id]);

    const search = await owner.crm.search({ businessId, q: "Lena" });
    expect(search.hits.find((h) => h.entity.id === customer.id)?.roles.map((r) => r.stage)).toEqual(["churned"]);
    // A stage stored as words is found from its normalized chip, and the page says how many match in all.
    await owner.crm.roles.add({ businessId, entityId: customer.id, role: { role: "supplier_contact", stage: "Account manager" } });
    expect(await ids({ role: "Supplier contact", stage: "account_manager" })).toEqual([customer.id]);
    const page = await owner.crm.entity.list({ businessId, limit: 1, role: "supplier" });
    expect(page).toMatchObject({ total: 1, nextCursor: null });
    expect((await owner.crm.entity.list({ businessId, limit: 1 })).total).toBe(list.items.length);
    // Another business's member sees none of it.
    await expect(hz.caller({ userId: hz.B.ownerId }).crm.entity.list({ businessId, limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).crm.entity.count({ businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("pages the list with a cursor and the search with an offset, and counts every record the filters match", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    for (const n of ["Pagetest Alpha", "Pagetest Beta", "Pagetest Gamma"]) await owner.crm.entity.create({ businessId, kind: "person", displayName: n });
    const { total } = await owner.crm.entity.count({ businessId });
    // Walk the list two at a time: every record, once, and the count says how many there are.
    const walked: string[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await owner.crm.entity.list({ businessId, limit: 2, cursor });
      walked.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(walked).toHaveLength(total);
    expect(new Set(walked).size).toBe(total);
    expect((await owner.crm.entity.count({ businessId, role: "no-such-role" })).total).toBe(0);
    // The search walks past its first page the same way.
    const first = await owner.crm.search({ businessId, q: "Pagetest", limit: 2 });
    expect(first.hits).toHaveLength(2);
    expect(first.nextOffset).toBe(2);
    const second = await owner.crm.search({ businessId, q: "Pagetest", limit: 2, offset: first.nextOffset! });
    expect(second.hits).toHaveLength(1);
    expect(second.nextOffset).toBeNull();
    expect(new Set([...first.hits, ...second.hits].map((h) => h.entity.displayName))).toEqual(new Set(["Pagetest Alpha", "Pagetest Beta", "Pagetest Gamma"]));
  });

  it("looks up mentioned records for hover cards and links, an agent's record with its agent (audit GTM-19, GTM-26)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId, agentId } = hz.A;
    const agentRecord = await repos.entities.create(hz.db, businessId, { kind: "agent", displayName: "Email Automation Engine", agentId });
    const buyer = await owner.crm.entity.create({ businessId, kind: "organisation", displayName: "Pennine Contract Cosmetics", identifiers: { domain: "pennine.example" } });
    await owner.crm.roles.add({ businessId, entityId: buyer.id, role: { role: "customer", stage: "won" } });
    const missing = "00000000-0000-4000-8000-000000000000";

    const found = await owner.crm.entity.lookup({ businessId, entityIds: [agentRecord.id, buyer.id, missing] });
    const byId = new Map(found.map((e) => [e.id, e]));
    expect(byId.get(agentRecord.id)).toMatchObject({ kind: "agent", displayName: "Email Automation Engine", agentId });
    expect(byId.get(buyer.id)).toMatchObject({ kind: "organisation", agentId: null, domain: "pennine.example", roles: [{ role: "customer", stage: "won" }] });
    expect(byId.has(missing)).toBe(false);
    // Another business's member learns nothing.
    await expect(hz.caller({ userId: hz.B.ownerId }).crm.entity.lookup({ businessId, entityIds: [buyer.id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("palette operators alone list records (audit GTM-27: role:supplier returned nothing)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const vendor = await owner.crm.entity.create({ businessId, kind: "organisation", displayName: "Operator Only Supplies" });
    await owner.crm.roles.add({ businessId, entityId: vendor.id, role: { role: "vendor" } });
    const res = await owner.crm.search({ businessId, role: "vendor" });
    expect(res.hits.map((h) => h.entity.id)).toEqual([vendor.id]);
    await expect(owner.crm.search({ businessId, q: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("unmerge keeps the founder's later edits and a later merge; a merge a later one relies on is refused with the reason", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const x = await owner.crm.entity.create({ businessId, kind: "person", displayName: "Vera Verify", identifiers: { email: "vera@verify.example" } });
    const y = await owner.crm.entity.create({ businessId, kind: "person", displayName: "V. Verify", identifiers: { linkedin: "https://linkedin.com/in/vera" } });
    const z = await owner.crm.entity.create({ businessId, kind: "person", displayName: "Vera Z Verify", identifiers: { phone: "+15550199" } });
    const first = await owner.crm.entity.merge({ businessId, keptId: x.id, mergedId: y.id });
    await owner.crm.entity.update({ businessId, entityId: x.id, patch: { displayName: "Vera Renamed", identifiers: { email: "vera@new.example", linkedin: "https://linkedin.com/in/vera" } } });
    await owner.crm.entity.merge({ businessId, keptId: x.id, mergedId: z.id });

    await owner.crm.entity.unmerge({ businessId, mergeLogId: first.log.id });
    const got = await owner.crm.entity.get({ businessId, entityId: x.id });
    expect(got.entity.displayName).toBe("Vera Renamed");
    expect(got.entity.identifiers).toEqual({ email: "vera@new.example", phone: "+15550199" });
    expect(got.entity.aliases).toEqual(["Vera Z Verify"]);
    expect((await owner.crm.entity.get({ businessId, entityId: z.id })).entity.id).toBe(x.id);
    expect((await owner.crm.entity.get({ businessId, entityId: y.id })).redirectedFrom).toBeNull();

    // A later merge that relies on an earlier one (both carried an email; only the first one's was kept).
    const p = await owner.crm.entity.create({ businessId, kind: "person", displayName: "Pia Kept" });
    const q = await owner.crm.entity.create({ businessId, kind: "person", displayName: "Pia Q", identifiers: { email: "pia@q.example" } });
    const s = await owner.crm.entity.create({ businessId, kind: "person", displayName: "Pia S", identifiers: { email: "pia@s.example" } });
    const early = await owner.crm.entity.merge({ businessId, keptId: p.id, mergedId: q.id });
    const late = await owner.crm.entity.merge({ businessId, keptId: p.id, mergedId: s.id });
    const reason = "Undo the later merge of “Pia S” first: it relies on what this merge brought in (the email).";
    await expect(owner.crm.entity.unmerge({ businessId, mergeLogId: early.log.id })).rejects.toMatchObject({ code: "CONFLICT", message: reason });
    const history = (await owner.crm.entity.get({ businessId, entityId: p.id })).mergeHistory;
    expect(Object.fromEntries(history.map((m) => [m.id, m.undoBlocked]))).toEqual({ [early.log.id]: reason, [late.log.id]: null });
    await owner.crm.entity.unmerge({ businessId, mergeLogId: late.log.id });
    await owner.crm.entity.unmerge({ businessId, mergeLogId: early.log.id });
    expect((await owner.crm.entity.get({ businessId, entityId: p.id })).entity.identifiers).toEqual({});
  });
  it("refuses a new record whose email or domain a live record already holds, unless the founder confirms (audit #331)", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const first = await owner.crm.entity.create({ businessId, kind: "person", displayName: "Dana Dup", identifiers: { email: "dana@dup.example" } });
    await expect(owner.crm.entity.create({ businessId, kind: "person", displayName: "Dana Again", identifiers: { email: "DANA@dup.example" } })).rejects.toMatchObject({
      code: "CONFLICT",
      cause: { code: "duplicate_entity", details: { existing: { id: first.id, displayName: "Dana Dup" }, identifier: "email" } },
    });
    const org = await owner.crm.entity.create({ businessId, kind: "organisation", displayName: "Dup Co", identifiers: { domain: "dup.example" } });
    await expect(owner.crm.entity.create({ businessId, kind: "organisation", displayName: "Dup Co 2", identifiers: { domain: "dup.example" } })).rejects.toMatchObject({ code: "CONFLICT", cause: { details: { existing: { id: org.id } } } });
    // A weak identifier is no match; confirming adds the second record anyway.
    await owner.crm.entity.create({ businessId, kind: "person", displayName: "Phone Only", identifiers: { phone: "+15550100" } });
    await owner.crm.entity.create({ businessId, kind: "person", displayName: "Phone Only 2", identifiers: { phone: "+15550100" } });
    const second = await owner.crm.entity.create({ businessId, kind: "person", displayName: "Dana Again", identifiers: { email: "dana@dup.example" }, allowDuplicate: true });
    expect(second.id).not.toBe(first.id);
  });
});
