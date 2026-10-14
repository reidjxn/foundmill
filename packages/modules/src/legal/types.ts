/**
 * Structural shapes of the API responses the legal screens read (apps/api routers legal.*, crm.roles.byRole,
 * integrations.list, business.get, product.proposals.list). Modules never import the tRPC client
 * (docs/ARCHITECTURE.md §18); these mirror the rows the routers return so the screens stay typed end to end.
 */
import type { Archetype, IncorporationRoute } from "@foundmill/shared";

export type DateLike = string | Date;

export const LEGAL_ENTITY_STATUSES = ["planned", "forming", "active", "dissolved"] as const;
export type LegalEntityStatus = (typeof LEGAL_ENTITY_STATUSES)[number];
export const INCORPORATION_STATUSES = ["draft", "in_progress", "awaiting_founder", "submitted", "complete", "abandoned"] as const;
export type IncorporationStatus = (typeof INCORPORATION_STATUSES)[number];
export const FILING_STATUSES = ["upcoming", "due", "overdue", "filed", "waived"] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];
export const CONTRACT_STATUSES = ["draft", "review", "awaiting_signature", "signed", "active", "expired", "terminated"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/* legal.incorporate.status */
export interface LegalEntityRow {
  id: string;
  jurisdiction: string;
  entityType: string;
  legalName: string;
  regNo: string | null;
  registeredAddress: Record<string, string> | null;
  /** Officers as imported (`{ name, role, appointedOn }`), before they become CRM people. */
  officers: unknown[];
  shareCapitalMinor: number | null;
  currency: string;
  formedAt: string | null;
  source: string | null;
  status: LegalEntityStatus;
  createdAt?: DateLike;
  updatedAt?: DateLike;
  archivedAt?: DateLike | null;
}

/** One entry of `incorporations.steps` as the orchestrator's `incorporationStep` activity writes it. */
export interface IncorporationStepRecord {
  step: string;
  at: string;
  note: string;
  payload?: Record<string, unknown>;
}

export interface IncorporationRow {
  id: string;
  legalEntityId: string | null;
  route: IncorporationRoute;
  status: IncorporationStatus;
  steps: unknown[];
  browserSessionId: string | null;
  workflowId: string | null;
  submittedAt: DateLike | null;
  completedAt: DateLike | null;
  createdAt?: DateLike;
  updatedAt?: DateLike;
}

export interface IncorporationStatusResponse {
  incorporation: IncorporationRow | null;
  entity: LegalEntityRow | null;
  history: IncorporationRow[];
}

/* legal.incorporate.start */
export interface IncorporationStartResponse {
  entity: LegalEntityRow;
  incorporation: IncorporationRow;
  workflow: { queued: boolean };
  founderSubmits: true;
}

/* legal.recommend */
export interface JurisdictionCard {
  jurisdiction: string;
  entity_type: string;
  formation_cost_minor: number;
  annual_cost_minor: number;
  minimum_capital_minor: number;
  time_to_form_days: number;
  banking: string;
  investor_familiarity: number;
  tax_notes: string;
  advantages: string[];
  disadvantages: string[];
  route: IncorporationRoute;
  dateChecked: string;
  costLabel: "Estimate";
}

export interface RecommendResponse {
  headline: string;
  cards: JurisdictionCard[];
  disclaimer: string;
  mode?: string;
}

/* legal.import.lookup */
export type LookupSource = "companies_house" | "bolagsverket" | "opencorporates";
export interface LookupResult {
  source: LookupSource;
  legalName: string;
  regNo: string;
  jurisdiction: string;
  entityType: string;
  status: string | null;
  formedAt: string | null;
  registeredAddress: Record<string, string>;
  officers: { name: string; role: string; appointedOn: string | null }[];
  deadlines: { kind: string; dueAt: string }[];
  checkedAt: string;
  untrusted: true;
}

/* legal.compliance.list */
export interface FilingRow {
  id: string;
  legalEntityId: string | null;
  kind: string;
  title: string;
  dueAt: DateLike | null;
  filedAt: DateLike | null;
  status: FilingStatus;
  ref: string | null;
  createdAt?: DateLike;
}

export interface ComplianceEventRow {
  id: string;
  legalEntityId: string | null;
  kind: string;
  title: string;
  dueAt: DateLike;
  recurrence: string | null;
  completedAt: DateLike | null;
  createdAt?: DateLike;
}

export interface ComplianceListResponse {
  events: ComplianceEventRow[];
  upcoming: { filings: FilingRow[]; compliance: ComplianceEventRow[] };
  filings: FilingRow[];
}

/* legal.contracts.list / get */
export interface ContractRow {
  id: string;
  counterpartyEntityId: string | null;
  kind: string;
  title: string;
  status: ContractStatus;
  docRef: string | null;
  signedAt: DateLike | null;
  startsAt: string | null;
  endsAt: string | null;
  valueMinor: number | null;
  currency: string;
  obligations: unknown[];
  createdAt?: DateLike;
  updatedAt?: DateLike;
  archivedAt?: DateLike | null;
  /** Joined by `contracts.list`. */
  counterparty?: { id: string; displayName: string } | null;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}

export type ContractsListResponse = Page<ContractRow>;

/* crm.roles.byRole */
export interface OfficerEntityRow {
  id: string;
  kind: string;
  displayName: string;
  role: { id: string; role: string; stage: string | null; startedAt?: DateLike | null; endedAt?: DateLike | null };
}
export type OfficersResponse = Page<OfficerEntityRow>;

/* integrations.list */
export interface IntegrationRow {
  id: string;
  connectorKey: string;
  status: "connected" | "degraded" | "expired" | "disconnected" | "mock";
  accountLabel: string | null;
  scopes: string[];
}
export interface CatalogueEntry {
  key: string;
  displayName: string;
  phase?: number | string;
  integration: IntegrationRow | null;
}
export interface IntegrationsListResponse {
  mode: "mock" | "live";
  integrations: IntegrationRow[];
  catalogue: CatalogueEntry[];
}

/* business.get */
export interface BusinessGetResponse {
  business: { id: string; name: string; slug: string; archetype: Archetype | null; region: "eu" | "us"; glossary: Record<string, string>; gameMode?: string };
  role: string;
  departments?: { id: string; slug: string; module?: string | null }[];
}

/* product.proposals.list */
export interface ProposalRow {
  id: string;
  title: string;
  status: "open" | "accepted" | "partially_accepted" | "rejected";
  severity: "low" | "normal" | "critical";
  createdAt?: DateLike;
}
export type ProposalsListResponse = Page<ProposalRow>;

/** One stored sector choice (`legal.regulatory.list`): whether the sector applies and the checklist items done. */
export interface RegulatoryGateRow {
  id: string;
  sector: string;
  applies: boolean;
  done: string[];
}
