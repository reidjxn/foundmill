import { describe, expect, it } from "vitest";
import { chip, chipFilters, chipsToOperators, crmFilterFields, matchOwner, mergeChips, parseCrmQuery, parseNaturalLanguage, roleKey, toListFilter, toSearchInput } from "../search";

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
});

describe("crm.entity.list filters (chips without text)", () => {
  it("sends role, stage, kind, owner and department chips to the server and keeps the rest for the rows", () => {
    const chips = parseCrmQuery('kind:organization role:supplier stage:"Signed up" owner:Mara department:Growth').chips;
    const { filters, unresolved } = chipFilters(chips, { ownerId: (n) => (n === "mara" ? "a1" : undefined), departmentId: (n) => (n === "growth" ? "d1" : undefined) });
    expect(filters).toEqual({ kinds: ["organisation"], role: "supplier", stage: "signed_up", ownerId: "a1", departmentId: "d1" });
    expect(unresolved).toEqual([]);
    expect(toListFilter(filters)).toEqual({ kind: ["organisation"], role: "supplier", stage: "signed_up", ownerId: "a1", departmentId: "d1" });
  });
  it("turns natural language into list filters ('customers', 'people owned by Mara')", () => {
    expect(chipFilters(parseCrmQuery("customers").chips).filters).toEqual({ role: "customer" });
    const owned = chipFilters(parseCrmQuery("people owned by Mara").chips, { ownerId: (n) => (n === "mara" ? "a1" : undefined) });
    expect(owned.filters).toEqual({ kinds: ["person"], ownerId: "a1" });
  });
  it("normalizes a role or stage typed as words or picked from a group the way the API compares them", () => {
    expect(roleKey(" Account  manager ")).toBe("account_manager");
    expect(roleKey("signed-up")).toBe("signed_up");
    expect(roleKey("supplier_contact")).toBe("supplier_contact");
    expect(chipFilters([chip("stage", "Account manager"), chip("role", "Supplier contact")]).filters).toEqual({ stage: "account_manager", role: "supplier_contact" });
  });
  it("resolves an owner chip to the one agent or department it names, so the server filters on the id", () => {
    const owners = [
      { id: "a1", name: "Sourcing and Manufacturing Specialist" },
      { id: "a2", name: "Chief of Staff" },
      { id: "a3", name: "Quality Specialist" },
      { id: "d1", name: "Distribution" },
    ];
    expect(matchOwner("chief of staff", owners)).toBe("a2");
    expect(matchOwner("a3", owners)).toBe("a3");
    // "owned by Sourcing" and the natural-language pass's two-word capture ("Chief of") name exactly one owner.
    expect(matchOwner("sourcing", owners)).toBe("a1");
    expect(matchOwner("chief of", owners)).toBe("a2");
    expect(matchOwner("distribution", owners)).toBe("d1");
    // Several owners share "specialist", and nobody is called Mara: the chip stays on the rows.
    expect(matchOwner("specialist", owners)).toBeUndefined();
    expect(matchOwner("mara", owners)).toBeUndefined();
    expect(matchOwner(" ", owners)).toBeUndefined();
    const owned = chipFilters(parseCrmQuery("people owned by Sourcing").chips, { ownerId: (n) => matchOwner(n, owners) });
    expect(owned).toEqual({ filters: { kinds: ["person"], ownerId: "a1" }, unresolved: [] });
  });
  it("keeps an owner or kind the API cannot take as a client-side chip", () => {
    const { filters, unresolved } = chipFilters(parseCrmQuery("owner:nobody kind:spaceship role:lead").chips, {});
    expect(filters).toEqual({ role: "lead" });
    expect(values(unresolved)).toEqual({ owner: "nobody", kind: "spaceship" });
  });
  it("builds filter fields with roles seen in the data merged with the known roles", () => {
    const fields = crmFilterFields({ roles: ["beta_tester"], departments: [{ id: "d1", name: "Growth" }] });
    const role = fields.find((f) => f.id === "role")!;
    expect(role.options?.some((o) => o.value === "beta_tester")).toBe(true);
    expect(fields.find((f) => f.id === "department")?.kind).toBe("select");
  });
});
