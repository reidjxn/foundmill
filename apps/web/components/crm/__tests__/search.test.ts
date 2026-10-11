import { describe, expect, it } from "vitest";
import { chipsToOperators, crmFilterFields, mergeChips, parseCrmQuery, parseNaturalLanguage, toSearchInput } from "../search";

const values = (chips: { field: string; value?: unknown }[]) => Object.fromEntries(chips.map((c) => [c.field, c.value]));

describe("natural-language filters → chips", () => {
  it("recognizes roles, kinds, stages, owners and departments", () => {
    const r = parseNaturalLanguage("churned customers in Growth owned by Mara", { departments: ["Growth", "Product"] });
    expect(values(r.chips)).toEqual({ owner: "mara", department: "growth", stage: "churned", role: "customer" });
    expect(r.text).toBe("");
  });
  it("keeps free text that is not a recognized phrase", () => {
    const r = parseNaturalLanguage("organisations called acme skincare");
    expect(values(r.chips)).toEqual({ kind: "organisation" });
    expect(r.text).toBe("called acme skincare");
  });
  it("handles 'signed up' and 'at stage'", () => {
    expect(values(parseNaturalLanguage("people who signed up").chips)).toEqual({ stage: "signed_up", kind: "person" });
    expect(values(parseNaturalLanguage("suppliers at stage shortlisted").chips)).toEqual({ stage: "shortlisted", role: "supplier" });
  });
});

describe("operators", () => {
  it("operators win over phrases and map aliases", () => {
    const r = parseCrmQuery('kind:company role:leads stage:"signed up" acme');
    expect(values(r.chips)).toEqual({ kind: "organisation", role: "lead", stage: "signed up" });
    expect(r.text).toBe("acme");
  });
  it("round-trips chips to operator text", () => {
    const r = parseCrmQuery("kind:person role:customer");
    expect(chipsToOperators(r.chips)).toBe("kind:person role:customer");
  });
  it("prints the organization kind in US English and parses it back to the stored key", () => {
    const r = parseCrmQuery("kind:organization role:supplier");
    expect(values(r.chips)).toEqual({ kind: "organisation", role: "supplier" });
    expect(chipsToOperators(r.chips)).toBe("kind:organization role:supplier");
    expect(chipsToOperators(parseCrmQuery(chipsToOperators(r.chips)).chips)).toBe("kind:organization role:supplier");
  });
  it("mergeChips replaces a field's chip instead of duplicating it", () => {
    const a = parseCrmQuery("role:lead").chips;
    const b = parseCrmQuery("role:customer kind:person").chips;
    const merged = mergeChips(a, b);
    expect(merged).toHaveLength(2);
    expect(values(merged)).toEqual({ role: "customer", kind: "person" });
    expect(merged[0]!.id).toBe(a[0]!.id);
  });
});

describe("crm.search input", () => {
  it("is null without text and maps chips onto the API filters with resolvers", () => {
    const chips = parseCrmQuery("kind:person role:customer owner:Mara department:Growth").chips;
    expect(toSearchInput("", chips)).toBeNull();
    const input = toSearchInput("ana", chips, { ownerId: (n) => (n === "mara" ? "a1" : undefined), departmentId: (n) => (n === "growth" ? "d1" : undefined) });
    expect(input).toEqual({ q: "ana", kinds: ["person"], role: "customer", ownerId: "a1", departmentId: "d1", limit: 50 });
  });
  it("drops an owner it cannot resolve rather than sending a name as an id", () => {
    const input = toSearchInput("x", parseCrmQuery("owner:nobody").chips, {});
    expect(input?.ownerId).toBeUndefined();
  });
  it("builds filter fields with roles seen in the data merged with the known roles", () => {
    const fields = crmFilterFields({ roles: ["beta_tester"], departments: [{ id: "d1", name: "Growth" }] });
    const role = fields.find((f) => f.id === "role")!;
    expect(role.options?.some((o) => o.value === "beta_tester")).toBe(true);
    expect(fields.find((f) => f.id === "department")?.kind).toBe("select");
  });
});
