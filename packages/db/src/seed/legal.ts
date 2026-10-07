/** Legal records for a demo business (BUILD §11.11): the entity, its incorporation, filings, compliance calendar and contracts. */
import { repos } from "../repos";
import { addDays, type SeedCtx } from "./context";

export interface LegalSpec {
  legalName: string;
  jurisdiction: string;
  entityType: string;
  regNo: string;
  registeredAddress: Record<string, string>;
  officers: Array<{ name: string; role: string; appointedAt: string }>;
  shareCapitalMinor: number;
  currency: string;
  formedDaysAgo: number;
  incorporationRoute: "stripe_atlas" | "companies_house_web" | "kit";
  filings: Array<{ kind: string; title: string; dueInDays: number; status: "upcoming" | "due" | "overdue" | "filed" | "waived"; ref?: string }>;
  compliance: Array<{ kind: string; title: string; dueInDays: number; recurrence?: string }>;
  contracts: Array<{ kind: string; title: string; status: "draft" | "review" | "awaiting_signature" | "signed" | "active" | "expired" | "terminated"; counterpartyEntityId?: string | null; valueMinor?: number; signedDaysAgo?: number; obligations?: string[] }>;
}

export interface LegalSeedResult {
  legalEntityId: string;
  filingIds: string[];
  complianceIds: string[];
  contractIds: string[];
  nextFilingDue: Date | null;
}

export async function seedLegal(ctx: SeedCtx, businessId: string, spec: LegalSpec): Promise<LegalSeedResult> {
  const { db } = ctx;
  const formedAt = addDays(ctx.today, -spec.formedDaysAgo);
  const entity = await repos.legal.createEntity(db, businessId, {
    jurisdiction: spec.jurisdiction,
    entityType: spec.entityType,
    legalName: spec.legalName,
    regNo: spec.regNo,
    registeredAddress: spec.registeredAddress,
    officers: spec.officers,
    shareCapitalMinor: spec.shareCapitalMinor,
    currency: spec.currency,
    formedAt: formedAt.toISOString().slice(0, 10),
    source: spec.incorporationRoute === "stripe_atlas" ? "stripe_atlas" : "companies_house",
    status: "active",
  });
  const inc = await repos.legal.startIncorporation(db, businessId, {
    legalEntityId: entity.id,
    route: spec.incorporationRoute,
    status: "complete",
    steps: [
      { key: "name_check", title: "Name availability screen (screen, not legal clearance)", done: true },
      { key: "officers", title: "Officers and PSC confirmed by the founder", done: true },
      { key: "submit", title: "Submitted by the founder", done: true },
      { key: "certificate", title: "Certificate received", done: true },
    ],
  });
  await repos.legal.updateIncorporation(db, businessId, inc.id, { status: "complete" });

  const filingIds: string[] = [];
  let nextFilingDue: Date | null = null;
  for (const f of spec.filings) {
    const dueAt = addDays(ctx.today, f.dueInDays);
    const row = await repos.legal.createFiling(db, businessId, { legalEntityId: entity.id, kind: f.kind, title: f.title, dueAt, status: f.status, ref: f.ref ?? null });
    if (f.status === "filed") await repos.legal.updateFiling(db, businessId, row.id, { filedAt: addDays(dueAt, -3) });
    filingIds.push(row.id);
    if (f.status !== "filed" && f.status !== "waived" && f.dueInDays >= 0 && (!nextFilingDue || dueAt < nextFilingDue)) nextFilingDue = dueAt;
  }
  const complianceIds: string[] = [];
  for (const c of spec.compliance) {
    const row = await repos.legal.createCompliance(db, businessId, { legalEntityId: entity.id, kind: c.kind, title: c.title, dueAt: addDays(ctx.today, c.dueInDays), recurrence: c.recurrence ?? null });
    complianceIds.push(row.id);
  }
  const contractIds: string[] = [];
  for (const c of spec.contracts) {
    const row = await repos.legal.createContract(db, businessId, {
      counterpartyEntityId: c.counterpartyEntityId ?? null,
      kind: c.kind,
      title: c.title,
      status: "draft",
      valueMinor: c.valueMinor ?? null,
      currency: spec.currency,
      obligations: (c.obligations ?? []).map((text) => ({ text, owner: "founder" })),
      docRef: `docs/${businessId}/contracts/${c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`,
    });
    // Walk the lifecycle so the stored status is reachable from draft (signing is always the founder's act).
    const path: Array<typeof c.status> =
      c.status === "draft" ? [] : c.status === "review" ? ["review"] : c.status === "awaiting_signature" ? ["awaiting_signature"] : c.status === "signed" ? ["awaiting_signature", "signed"] : c.status === "active" ? ["awaiting_signature", "signed", "active"] : c.status === "expired" ? ["awaiting_signature", "signed", "active", "expired"] : ["terminated"];
    for (const s of path) await repos.legal.setContractStatus(db, businessId, row.id, s, { signedAt: s === "signed" ? addDays(ctx.today, -(c.signedDaysAgo ?? 30)) : undefined });
    contractIds.push(row.id);
  }
  return { legalEntityId: entity.id, filingIds, complianceIds, contractIds, nextFilingDue };
}
