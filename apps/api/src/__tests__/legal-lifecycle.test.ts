/**
 * Legal (audit W03): cancel and abandon an incorporation, a start that never reached the orchestrator, the registry
 * details the founder records after filing, an idempotent registry import, friendly registry errors, one
 * `contract.signed` per signature, the first publication of a policy, and the saved regulated-sector choices.
 */
import { repos } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officerName } from "../routers/legal";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
const temporal = fakeTemporalClient();
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "legal-lifecycle", temporalClient: temporal });
}, 120_000);
afterAll(() => hz.close());

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};
const messageOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "";
  } catch (err) {
    return err instanceof TRPCError ? err.message : String(err);
  }
};

describe("legal.incorporate.cancel (#167)", () => {
  it("cancels an incorporation waiting for the founder: signals the workflow, abandons the row and archives the forming entity", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const started = await owner.legal.incorporate.start({ businessId: hz.A.businessId, route: "companies_house_web", jurisdiction: "United Kingdom", entityType: "Ltd", legalName: "Cancel Me Ltd" });
    const incorporationId = started.incorporation.id;
    await repos.legal.updateIncorporation(hz.db, hz.A.businessId, incorporationId, { status: "awaiting_founder" });

    // another business's admin, and a plain member of this one, cannot cancel it
    expect(await code(hz.caller({ userId: hz.B.ownerId }).legal.incorporate.cancel({ businessId: hz.B.businessId, incorporationId }))).toBe("NOT_FOUND");
    expect(await code(hz.caller({ userId: hz.A.memberId }).legal.incorporate.cancel({ businessId: hz.A.businessId, incorporationId }))).toBe("FORBIDDEN");

    const cancelled = await owner.legal.incorporate.cancel({ businessId: hz.A.businessId, incorporationId });
    expect(cancelled.incorporation.status).toBe("abandoned");
    const sent = temporal.signals.filter((s) => s.workflowId === `incorporation:${incorporationId}`);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ signal: "founderSubmit", args: [{ kind: "cancel", by: hz.A.ownerId }] });
    const entity = await repos.legal.getEntity(hz.db, hz.A.businessId, started.entity.id);
    expect(entity.archivedAt).not.toBeNull();

    // nothing is in flight now: a new incorporation can start, and cancelling twice is refused
    expect((await owner.legal.incorporate.status({ businessId: hz.A.businessId })).incorporation).toBeNull();
    expect(await code(owner.legal.incorporate.cancel({ businessId: hz.A.businessId, incorporationId }))).toBe("BAD_REQUEST");
    const again = await owner.legal.incorporate.start({ businessId: hz.A.businessId, route: "kit", jurisdiction: "se", entityType: "AB", legalName: "Second Try AB" });
    expect(again.incorporation.status).toBe("in_progress");
    await owner.legal.incorporate.cancel({ businessId: hz.A.businessId, incorporationId: again.incorporation.id });
  });

  it("refuses to cancel a filing that is already with the registry, and a second submit no longer reopens a completed one", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const started = await owner.legal.incorporate.start({ businessId: hz.A.businessId, route: "kit", jurisdiction: "de", entityType: "GmbH", legalName: "Filed GmbH" });
    const id = started.incorporation.id;
    await repos.legal.updateIncorporation(hz.db, hz.A.businessId, id, { status: "submitted" });
    expect(await messageOf(owner.legal.incorporate.cancel({ businessId: hz.A.businessId, incorporationId: id }))).toMatch(/already with the registry/);
    await repos.legal.updateIncorporation(hz.db, hz.A.businessId, id, { status: "complete" });
    expect(await code(owner.legal.incorporate.cancel({ businessId: hz.A.businessId, incorporationId: id }))).toBe("BAD_REQUEST");
    const before = temporal.signals.length;
    expect(await code(owner.legal.incorporate.founderSubmitted({ businessId: hz.A.businessId, incorporationId: id }))).toBe("BAD_REQUEST");
    expect((await repos.legal.getIncorporation(hz.db, hz.A.businessId, id)).status).toBe("complete");
    expect(temporal.signals.length).toBe(before); // nothing was signaled either
  });

  it("founderSubmitted passes the registration number on to the workflow and records it nowhere else", async () => {
    const owner = hz.caller({ userId: hz.B.ownerId });
    const started = await owner.legal.incorporate.start({ businessId: hz.B.businessId, route: "kit", jurisdiction: "gb", entityType: "ltd", legalName: "Ref Ltd" });
    await repos.legal.updateIncorporation(hz.db, hz.B.businessId, started.incorporation.id, { status: "awaiting_founder" });
    const result = await owner.legal.incorporate.founderSubmitted({ businessId: hz.B.businessId, incorporationId: started.incorporation.id, reference: " 15432198 " });
    expect(result.incorporation.status).toBe("submitted");
    const sent = temporal.signals.filter((s) => s.workflowId === `incorporation:${started.incorporation.id}`);
    expect(sent[0]).toMatchObject({ signal: "founderSubmit", args: [{ kind: "submitted", payload: { reference: "15432198" } }] });
    await repos.legal.updateIncorporation(hz.db, hz.B.businessId, started.incorporation.id, { status: "abandoned" });
  });
});

describe("legal.incorporate.start without an orchestrator (#167)", () => {
  it("marks a start that could not be queued as abandoned instead of leaving a draft that blocks every later start", async () => {
    const offline = await createApiHarness({ prefix: "legal-offline" });
    try {
      const owner = offline.caller({ userId: offline.A.ownerId });
      const started = await owner.legal.incorporate.start({ businessId: offline.A.businessId, route: "kit", jurisdiction: "gb", entityType: "ltd", legalName: "Offline Ltd" });
      expect(started.workflow.queued).toBe(false);
      expect(started.incorporation.status).toBe("abandoned");
      expect((await owner.legal.incorporate.status({ businessId: offline.A.businessId })).incorporation).toBeNull();
      const again = await owner.legal.incorporate.start({ businessId: offline.A.businessId, route: "kit", jurisdiction: "gb", entityType: "ltd", legalName: "Offline Ltd" });
      expect(again.incorporation.id).not.toBe(started.incorporation.id);
      // a submit nobody could hear is refused and changes nothing
      await repos.legal.updateIncorporation(offline.db, offline.A.businessId, again.incorporation.id, { status: "awaiting_founder" });
      expect(await code(owner.legal.incorporate.founderSubmitted({ businessId: offline.A.businessId, incorporationId: again.incorporation.id }))).toBe("SERVICE_UNAVAILABLE");
      expect((await repos.legal.getIncorporation(offline.db, offline.A.businessId, again.incorporation.id)).status).toBe("awaiting_founder");
    } finally {
      await offline.close();
    }
  }, 120_000);
});

describe("legal.entity.update (#166)", () => {
  it("lets an admin record the registration number and formation date, and nobody else", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const updated = await owner.legal.entity.update({ businessId: hz.A.businessId, legalEntityId: hz.A.legalEntityId, regNo: " 15432198 ", formedAt: "2026-10-05" });
    expect(updated).toMatchObject({ regNo: "15432198", formedAt: "2026-10-05" });
    expect(await code(hz.caller({ userId: hz.A.memberId }).legal.entity.update({ businessId: hz.A.businessId, legalEntityId: hz.A.legalEntityId, regNo: "1" }))).toBe("FORBIDDEN");
    expect(await code(hz.caller({ userId: hz.B.ownerId }).legal.entity.update({ businessId: hz.B.businessId, legalEntityId: hz.A.legalEntityId, regNo: "1" }))).toBe("NOT_FOUND");
  });
});

describe("legal.import (#175, #349)", () => {
  const confirmInput = (businessId: string, patch: Record<string, unknown> = {}) => ({
    businessId,
    source: "companies_house" as const,
    legalName: "RE-IMPORT TRADING LIMITED",
    regNo: "00112233",
    jurisdiction: "england-wales",
    entityType: "ltd",
    formedAt: "2020-01-15",
    registeredAddress: { line1: "1 Example Street" },
    officers: [{ name: "LINDQVIST, Sara", role: "director", appointedOn: "2020-01-15" }, { name: "PATEL, Dev", role: "secretary", appointedOn: null }],
    shareCapitalMinor: 10_000,
    currency: "GBP",
    deadlines: [{ kind: "annual_accounts", dueAt: "2027-01-31" }, { kind: "confirmation_statement", dueAt: "2026-12-14" }],
    ...patch,
  });

  it("importing the same company again updates it in place: one entity, one person per officer, one deadline each, no 500 on the share class", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const entitiesBefore = (await repos.legal.listEntities(hz.db, hz.A.businessId)).length;
    const complianceBefore = (await repos.legal.listCompliance(hz.db, hz.A.businessId)).length;
    const first = await owner.legal.import.confirm(confirmInput(hz.A.businessId));
    expect(first.created).toBe(true);
    const second = await owner.legal.import.confirm(confirmInput(hz.A.businessId, { legalName: "RE-IMPORT TRADING LTD", regNo: "001 122 33", shareCapitalMinor: 25_000 }));
    expect(second.created).toBe(false);
    expect(second.entity.id).toBe(first.entity.id);
    expect(second.entity.legalName).toBe("RE-IMPORT TRADING LTD"); // a correction shows
    expect(second.people.sort()).toEqual(first.people.sort());

    expect((await repos.legal.listEntities(hz.db, hz.A.businessId)).length).toBe(entitiesBefore + 1);
    expect((await repos.legal.listCompliance(hz.db, hz.A.businessId)).length).toBe(complianceBefore + 2);
    const officers = await repos.entities.listByRole(hz.db, hz.A.businessId, "officer", { limit: 200 });
    const names = officers.items.map((o) => o.displayName);
    expect(names.filter((n) => n === "Sara Lindqvist")).toHaveLength(1); // the registry's "SURNAME, Forename" form is a person's name
    expect(names.filter((n) => n === "Dev Patel")).toHaveLength(1);
    expect(names).not.toContain("LINDQVIST, Sara");
    // the share class is reused and carries the corrected capital
    const ordinary = await repos.capTable.findSecurityByClass(hz.db, hz.A.businessId, "Ordinary");
    expect((ordinary!.terms as { shareCapitalMinor: number }).shareCapitalMinor).toBe(25_000);
    // a third import without share capital also works
    expect((await owner.legal.import.confirm(confirmInput(hz.A.businessId, { shareCapitalMinor: null }))).created).toBe(false);
  });

  it("reuses an 'Ordinary' class that the cap table already has instead of failing", async () => {
    const owner = hz.caller({ userId: hz.B.ownerId });
    if (!(await repos.capTable.findSecurityByClass(hz.db, hz.B.businessId, "Ordinary"))) await owner.finance.capTable.createSecurity({ businessId: hz.B.businessId, class: "Ordinary", kind: "common", currency: "GBP" });
    const result = await owner.legal.import.confirm(confirmInput(hz.B.businessId, { regNo: "00998877", legalName: "CAP TABLE FIRST LTD" }));
    expect(result.created).toBe(true);
    expect((await repos.capTable.listSecurities(hz.db, hz.B.businessId)).filter((s) => s.class === "Ordinary")).toHaveLength(1);
  });

  it("names officers the way a person is named", () => {
    expect(officerName("LINDQVIST, Sara")).toBe("Sara Lindqvist");
    expect(officerName("O'BRIEN-SMITH, Mary Jane")).toBe("Mary Jane O'Brien-Smith");
    expect(officerName("Sara Lindqvist")).toBe("Sara Lindqvist");
    expect(officerName("ACME SERVICES LIMITED")).toBe("ACME SERVICES LIMITED");
    expect(officerName("Holdings, Acme Ltd")).toBe("Holdings, Acme Ltd"); // a company is not turned around
  });

  it("looks up the Import form's own example and the demo businesses' numbers, and answers an unknown one in plain words", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect((await owner.legal.import.lookup({ businessId: hz.A.businessId, country: "gb", regNo: "12345678" })).legalName).toBe("EXAMPLE TRADING LTD");
    expect((await owner.legal.import.lookup({ businessId: hz.A.businessId, country: "gb", regNo: "15432198" })).legalName).toBe("NORTHWIND SKINCARE LTD");
    expect((await owner.legal.import.lookup({ businessId: hz.A.businessId, country: "gb", regNo: "15106734" })).legalName).toBe("LEDGERLY LTD");
    const missing = owner.legal.import.lookup({ businessId: hz.A.businessId, country: "gb", regNo: "99999999" });
    expect(await code(missing)).toBe("NOT_FOUND");
    const text = await messageOf(owner.legal.import.lookup({ businessId: hz.A.businessId, country: "gb", regNo: "99999999" }));
    expect(text).toBe("No company with number 99999999 at Companies House");
    expect(text).not.toMatch(/companies_house\.|get_company|failed/);
  });
});

describe("legal.contracts.setStatus (#351)", () => {
  it("records one contract.signed and one audit row however often 'signed' is sent, concurrently or not", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const contract = await owner.legal.contracts.create({ businessId: hz.A.businessId, kind: "customer", title: "Double click MSA", counterpartyEntityId: hz.A.entityId, docRef: "https://sign.example/req-1" });
    await owner.legal.contracts.setStatus({ businessId: hz.A.businessId, contractId: contract.id, status: "awaiting_signature" });
    const signedEvents = async () => (await repos.events.list(hz.db, hz.A.businessId, { type: "contract.signed", limit: 200 })).items.filter((e) => (e.payload as { contractId: string }).contractId === contract.id);
    const sends = await Promise.all([1, 2, 3].map(() => owner.legal.contracts.setStatus({ businessId: hz.A.businessId, contractId: contract.id, status: "signed", provider: "manual" })));
    expect(sends.every((c) => c.status === "signed")).toBe(true);
    await owner.legal.contracts.setStatus({ businessId: hz.A.businessId, contractId: contract.id, status: "signed", provider: "manual" });
    expect(await signedEvents()).toHaveLength(1);
    const audits = (await repos.audit.list(hz.db, hz.A.businessId, { action: "legal.contracts.set_status", limit: 200 })).items.filter((a) => (a.target as { id?: string } | null)?.id === contract.id);
    expect(audits).toHaveLength(2); // awaiting_signature, then signed
  });

  it("does not offer DocuSign: it has no connector", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const contract = await owner.legal.contracts.create({ businessId: hz.A.businessId, kind: "nda", counterpartyEntityId: hz.A.entityId });
    expect(await code(owner.legal.contracts.setStatus({ businessId: hz.A.businessId, contractId: contract.id, status: "awaiting_signature", provider: "docusign" as never }))).toBe("BAD_REQUEST");
  });
});

describe("legal.policies.publish (#174)", () => {
  const doc = (title: string) => ({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] }, { type: "paragraph", content: [{ type: "text", text: "We keep your data safe." }] }] });

  it("creates the Policies block as a pinned human edit, once", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const block = await owner.legal.policies.publish({ businessId: hz.A.businessId, title: "Privacy policy", content: doc("Privacy policy") });
    expect(block).toMatchObject({ section: "Policies", pinned: true, authoredByKind: "user", authoredBy: hz.A.ownerId });
    const spec = await owner.product.spec.get({ businessId: hz.A.businessId, section: "Policies" });
    expect(spec.blocks.map((b) => b.id)).toContain(block.id);
    expect(await code(owner.legal.policies.publish({ businessId: hz.A.businessId, title: "Privacy policy", content: doc("Privacy policy") }))).toBe("CONFLICT");
    expect(await code(owner.legal.policies.publish({ businessId: hz.A.businessId, title: "Terms of service", content: doc("Privacy policy") }))).toBe("BAD_REQUEST");
    expect(await code(hz.caller({ userId: hz.B.memberId }).legal.policies.publish({ businessId: hz.A.businessId, title: "Cookie policy", content: doc("Cookie policy") }))).toBe("FORBIDDEN");
  });
});

describe("legal.regulatory (#176)", () => {
  it("saves whether a sector applies and which checklist items are done, per business", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await owner.legal.regulatory.list({ businessId: hz.A.businessId })).toEqual([]);
    await owner.legal.regulatory.set({ businessId: hz.A.businessId, sector: "health", applies: true, done: ["claims", "claims", "classification"] });
    await owner.legal.regulatory.set({ businessId: hz.A.businessId, sector: "cosmetics", applies: false });
    const rows = await owner.legal.regulatory.list({ businessId: hz.A.businessId });
    expect(rows.map((r) => [r.sector, r.applies, r.done])).toEqual([["cosmetics", false, []], ["health", true, ["claims", "classification"]]]);
    // ticking one item keeps the switch; switching a sector back on keeps what was ticked
    await owner.legal.regulatory.set({ businessId: hz.A.businessId, sector: "health", done: ["claims"] });
    expect((await owner.legal.regulatory.list({ businessId: hz.A.businessId })).find((r) => r.sector === "health")).toMatchObject({ applies: true, done: ["claims"] });
    expect(await hz.caller({ userId: hz.B.ownerId }).legal.regulatory.list({ businessId: hz.B.businessId })).toEqual([]);
    expect(await code(owner.legal.regulatory.set({ businessId: hz.A.businessId, sector: "health", done: ["not-on-the-list"] }))).toBe("BAD_REQUEST");
  });
});

describe("legal.recommend (#354)", () => {
  it("returns cards inside realistic bounds in mock mode", async () => {
    const result = await hz.caller({ userId: hz.A.ownerId }).legal.recommend({ businessId: hz.A.businessId, fundraising: "vc", coFounders: 1 });
    expect(result.cards.length).toBeGreaterThanOrEqual(2);
    for (const c of result.cards) {
      expect(c.formation_cost_minor).toBeLessThanOrEqual(100_000_000);
      expect(c.annual_cost_minor).toBeLessThanOrEqual(100_000_000);
      expect(c.time_to_form_days).toBeLessThanOrEqual(730);
      expect(c.entity_type).not.toMatch(/mock/i);
      expect(c.jurisdiction).not.toMatch(/mock/i);
    }
  });
});
