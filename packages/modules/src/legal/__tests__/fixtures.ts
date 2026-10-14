/** Northwind Skincare fixtures for the legal screens. Clock is 7 October 2026 (fake-source NOW). */
import type { SpecGetResponse } from "../../product/types";
import type { BusinessGetResponse, ComplianceListResponse, ContractRow, ContractsListResponse, IncorporationRow, IncorporationStatusResponse, IntegrationsListResponse, LegalEntityRow, LookupResult, OfficersResponse, ProposalsListResponse, RecommendResponse } from "../types";

export const BID = "00000000-0000-4000-8000-000000000001";
export const ENTITY = { legal: "11111111-1111-4111-8111-111111111111", inc: "11111111-1111-4111-8111-111111111112", incOld: "11111111-1111-4111-8111-111111111113" } as const;
export const PERSON = { mara: "33333333-3333-4333-8333-333333333331", tomas: "33333333-3333-4333-8333-333333333332", acme: "33333333-3333-4333-8333-333333333340" } as const;
export const CONTRACT = { msa: "44444444-4444-4444-8444-444444444441", nda: "44444444-4444-4444-8444-444444444442", lease: "44444444-4444-4444-8444-444444444443" } as const;
export const DEADLINE = { accounts: "55555555-5555-4555-8555-555555555551", cs: "55555555-5555-4555-8555-555555555552", vat: "55555555-5555-4555-8555-555555555553", filedInc: "55555555-5555-4555-8555-555555555554", overdue: "55555555-5555-4555-8555-555555555555" } as const;
export const BLOCK = { privacy: "66666666-6666-4666-8666-666666666661", terms: "66666666-6666-4666-8666-666666666662" } as const;

export const legalEntity: LegalEntityRow = {
  id: ENTITY.legal,
  jurisdiction: "england-wales",
  entityType: "ltd",
  legalName: "Northwind Skincare Ltd",
  regNo: "12345678",
  registeredAddress: { line1: "1 Market Street", city: "Manchester", postal_code: "M1 1AA", country: "United Kingdom" },
  officers: [
    { name: "Mara Lindqvist", role: "director", appointedOn: "2024-03-01" },
    { name: "Tomas Berg", role: "secretary", appointedOn: "2024-03-01" },
    { name: "Priya Shah", role: "director", appointedOn: "2025-06-15" },
  ],
  shareCapitalMinor: 10_000_00,
  currency: "GBP",
  formedAt: "2024-03-01",
  source: "companies_house",
  status: "active",
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
};

export const incorporationAwaiting: IncorporationRow = {
  id: ENTITY.inc,
  legalEntityId: ENTITY.legal,
  route: "companies_house_web",
  status: "awaiting_founder",
  steps: [
    { step: "prepare_documents", at: "2026-10-05T09:00:00.000Z", note: "Prepared the companies house web document set from the business profile (drafts; nothing filed)." },
    { step: "founder_review", at: "2026-10-06T10:00:00.000Z", note: "Asked the founder to review and submit." },
  ],
  browserSessionId: "supervised:abc123",
  workflowId: "incorporation:inc",
  submittedAt: null,
  completedAt: null,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-06T10:00:00.000Z",
};

export const incorporationAbandoned: IncorporationRow = { ...incorporationAwaiting, id: ENTITY.incOld, route: "stripe_atlas", status: "abandoned", steps: [{ step: "prepare_documents", at: "2026-08-01T09:00:00.000Z", note: "Prepared." }, { step: "abandoned", at: "2026-08-02T09:00:00.000Z", note: "cancelled by the founder" }], browserSessionId: null, createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-02T09:00:00.000Z" };

export const statusActive: IncorporationStatusResponse = { incorporation: incorporationAwaiting, entity: legalEntity, history: [incorporationAwaiting, incorporationAbandoned] };
export const statusNone: IncorporationStatusResponse = { incorporation: null, entity: null, history: [] };
export const statusEntityOnly: IncorporationStatusResponse = { incorporation: null, entity: legalEntity, history: [] };

export const officers: OfficersResponse = {
  items: [
    { id: PERSON.mara, kind: "person", displayName: "Mara Lindqvist", role: { id: "r1", role: "officer", stage: "director", startedAt: "2024-03-01T00:00:00.000Z", endedAt: null } },
    { id: PERSON.tomas, kind: "person", displayName: "Tomas Berg", role: { id: "r2", role: "officer", stage: "secretary", startedAt: "2024-03-01T00:00:00.000Z", endedAt: null } },
  ],
  nextCursor: null,
};

export const lookupResult: LookupResult = {
  source: "companies_house",
  legalName: "Northwind Skincare Ltd",
  regNo: "12345678",
  jurisdiction: "england-wales",
  entityType: "ltd",
  status: "active",
  formedAt: "2024-03-01",
  registeredAddress: { line1: "1 Market Street", city: "Manchester", postal_code: "M1 1AA" },
  officers: [{ name: "Mara Lindqvist", role: "director", appointedOn: "2024-03-01" }, { name: "Tomas Berg", role: "secretary", appointedOn: "2024-03-01" }],
  deadlines: [{ kind: "annual_accounts", dueAt: "2027-03-31" }, { kind: "confirmation_statement", dueAt: "2027-03-14" }],
  checkedAt: "2026-10-07T12:00:00.000Z",
  untrusted: true,
};

export const recommendation: RecommendResponse = {
  headline: "For your business, we recommend Delaware or the United Kingdom",
  disclaimer: "Information, not legal or tax advice. Partner professionals are available for a review.",
  mode: "mock",
  cards: [
    { jurisdiction: "Delaware", entity_type: "C-corp", formation_cost_minor: 50_000, annual_cost_minor: 40_000, minimum_capital_minor: 0, time_to_form_days: 3, banking: "US bank via Atlas partners", investor_familiarity: 5, tax_notes: "Managing a US company from Sweden creates permanent-establishment risk; plan for a Swedish branch filing.", advantages: ["Investor standard", "Fast"], disadvantages: ["Two tax filings"], route: "stripe_atlas", dateChecked: "2026-10-07", costLabel: "Estimate" },
    { jurisdiction: "United Kingdom", entity_type: "Private limited company", formation_cost_minor: 5_000, annual_cost_minor: 3_400, minimum_capital_minor: 100, time_to_form_days: 1, banking: "UK fintech banks same week", investor_familiarity: 4, tax_notes: "UK corporation tax at the small profits rate; check Swedish CFC rules.", advantages: ["Cheap", "Same-day"], disadvantages: ["Less familiar to US VCs"], route: "companies_house_web", dateChecked: "2026-10-07", costLabel: "Estimate" },
    { jurisdiction: "Sweden", entity_type: "Aktiebolag", formation_cost_minor: 220_000, annual_cost_minor: 100_000, minimum_capital_minor: 2_500_000, time_to_form_days: 10, banking: "Local bank with BankID", investor_familiarity: 3, tax_notes: "Home jurisdiction; no permanent-establishment issue.", advantages: ["Home market"], disadvantages: ["Minimum capital 25 000 SEK"], route: "kit", dateChecked: "2026-10-07", costLabel: "Estimate" },
  ],
};

export const compliance: ComplianceListResponse = {
  events: [
    { id: DEADLINE.vat, legalEntityId: ENTITY.legal, kind: "vat_return", title: "VAT return Q3", dueAt: "2026-11-07T00:00:00.000Z", recurrence: "quarterly", completedAt: null },
    { id: DEADLINE.overdue, legalEntityId: ENTITY.legal, kind: "paye_submission", title: "", dueAt: "2026-10-01T00:00:00.000Z", recurrence: "monthly", completedAt: null },
    { id: DEADLINE.cs, legalEntityId: ENTITY.legal, kind: "confirmation_statement", title: "Confirmation statement", dueAt: "2027-03-14T00:00:00.000Z", recurrence: "yearly", completedAt: null },
  ],
  upcoming: {
    filings: [{ id: DEADLINE.accounts, legalEntityId: ENTITY.legal, kind: "annual_accounts", title: "Annual accounts", dueAt: "2026-10-20T00:00:00.000Z", filedAt: null, status: "due", ref: null }],
    compliance: [{ id: DEADLINE.vat, legalEntityId: ENTITY.legal, kind: "vat_return", title: "VAT return Q3", dueAt: "2026-11-07T00:00:00.000Z", recurrence: "quarterly", completedAt: null }],
  },
  filings: [
    { id: DEADLINE.accounts, legalEntityId: ENTITY.legal, kind: "annual_accounts", title: "Annual accounts", dueAt: "2026-10-20T00:00:00.000Z", filedAt: null, status: "due", ref: null },
    { id: DEADLINE.filedInc, legalEntityId: ENTITY.legal, kind: "incorporation", title: "Incorporation via companies_house_web", dueAt: "2024-03-01T00:00:00.000Z", filedAt: "2024-03-01T10:00:00.000Z", status: "filed", ref: "CH-2024-0301" },
  ],
};

export const complianceEmpty: ComplianceListResponse = { events: [], upcoming: { filings: [], compliance: [] }, filings: [] };

export const contractMsa: ContractRow = {
  id: CONTRACT.msa,
  counterpartyEntityId: PERSON.acme,
  kind: "customer",
  title: "Acme Retail master services agreement",
  status: "awaiting_signature",
  docRef: "https://app.hellosign.com/sign/abc",
  signedAt: null,
  startsAt: "2026-11-01",
  endsAt: "2027-10-31",
  valueMinor: 1_200_000,
  currency: "EUR",
  obligations: [
    { title: "Deliver onboarding within 30 days", party: "us", dueAt: "2026-12-01", status: "open" },
    { title: "Pay quarterly in advance", party: "counterparty", dueAt: "2026-11-01" },
    { title: "Provide product samples", party: "us", dueAt: "2026-09-15" },
    "Keep pricing confidential",
  ],
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
  archivedAt: null,
  counterparty: { id: PERSON.acme, displayName: "Acme Retail" },
};

export const contractNda: ContractRow = { ...contractMsa, id: CONTRACT.nda, kind: "nda", title: "Mutual NDA with Acme Retail", status: "active", docRef: null, signedAt: "2026-08-01T00:00:00.000Z", startsAt: "2026-08-01", endsAt: null, valueMinor: null, obligations: [{ title: "Keep information confidential for 3 years", party: "both" }], updatedAt: "2026-08-01T09:00:00.000Z" };
export const contractLease: ContractRow = { ...contractMsa, id: CONTRACT.lease, kind: "lease", title: "", status: "draft", counterpartyEntityId: null, counterparty: null, docRef: null, valueMinor: 240_000, obligations: [], updatedAt: "2026-10-05T09:00:00.000Z" };

export const contracts: ContractsListResponse = { items: [contractMsa, contractNda, contractLease], nextCursor: null };

export const integrations: IntegrationsListResponse = {
  mode: "mock",
  integrations: [
    { id: "i1", connectorKey: "stripe", status: "mock", accountLabel: "Northwind", scopes: [] },
    { id: "i2", connectorKey: "sendgrid", status: "connected", accountLabel: null, scopes: [] },
    { id: "i3", connectorKey: "github", status: "connected", accountLabel: "northwind", scopes: [] },
    { id: "i4", connectorKey: "shopify", status: "disconnected", accountLabel: null, scopes: [] },
    { id: "i5", connectorKey: "mystery_tool", status: "connected", accountLabel: null, scopes: [] },
  ],
  catalogue: [{ key: "mystery_tool", displayName: "Mystery Tool", integration: null }],
};

export const business: BusinessGetResponse = { business: { id: BID, name: "Northwind Skincare", slug: "northwind", archetype: "dtc_physical", region: "eu", glossary: {} }, role: "owner", departments: [] };
export const businessMember: BusinessGetResponse = { ...business, role: "member" };

const privacyText = "# Privacy policy\n\nLast updated 2026-01-01\n\nNorthwind Skincare Ltd collects what it needs.\n\n## Who we share it with\n\nWe use Stripe only.";
const heading = (text: string, level = 1) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

export const specPolicies: SpecGetResponse = {
  blocks: [
    { id: BLOCK.privacy, section: "Policies", position: 0, content: { type: "doc", content: [heading("Privacy policy"), para("Last updated 2026-01-01"), para("Northwind Skincare Ltd collects what it needs."), heading("Who we share it with", 2), para("We use Stripe only.")] }, sources: [], authoredByKind: "agent", authoredBy: null, pinned: false, version: 1 },
    { id: BLOCK.terms, section: "Policies", position: 1, content: { type: "doc", content: [heading("Terms of service"), para("Old terms.")] }, sources: [], authoredByKind: "user", authoredBy: null, pinned: true, version: 2 },
  ],
  latestVersion: null,
  versionCount: 0,
};
export const privacyStoredText = privacyText;

export const proposals: ProposalsListResponse = {
  items: [
    { id: "p1", title: "Update the privacy policy for SendGrid", status: "open", severity: "normal", createdAt: "2026-10-06T09:00:00.000Z" },
    { id: "p2", title: "Roadmap wording", status: "open", severity: "low", createdAt: "2026-10-06T09:00:00.000Z" },
  ],
  nextCursor: null,
};

export const dataResponses = {
  "legal.incorporate.status": statusActive,
  "crm.roles.byRole": officers,
  "legal.compliance.list": compliance,
  "legal.contracts.list": contracts,
  "legal.contracts.get": (input: Record<string, unknown> | undefined) => contracts.items.find((c) => c.id === input?.contractId) ?? contractMsa,
  "business.get": business,
  "legal.regulatory.list": [],
  "integrations.list": integrations,
  "product.spec.get": specPolicies,
  "product.proposals.list": proposals,
  "department.list": [],
};

export const emptyResponses = {
  "legal.incorporate.status": statusNone,
  "crm.roles.byRole": { items: [], nextCursor: null },
  "legal.compliance.list": complianceEmpty,
  "legal.contracts.list": { items: [], nextCursor: null },
  "business.get": { ...business, business: { ...business.business, name: "Blank Co", archetype: null } },
  "legal.regulatory.list": [],
  "integrations.list": { mode: "mock", integrations: [], catalogue: [] },
  "product.spec.get": { blocks: [], latestVersion: null, versionCount: 0 },
  "product.proposals.list": { items: [], nextCursor: null },
  "department.list": [],
};
