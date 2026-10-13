/** 0010 — legal: entities, incorporations, filings, contracts, compliance events; 0038 — regulated-sector gates. */
import { INCORPORATION_ROUTES } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { boolean, date, index, jsonb, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { currency, emptyList, id, minor, timestamps, timestampsWithArchive, tstz } from "./_common";
import { businessId } from "./_refs";
import { entities } from "./crm";

export const LEGAL_ENTITY_STATUSES = ["planned", "forming", "active", "dissolved"] as const;
export const INCORPORATION_STATUSES = ["draft", "in_progress", "awaiting_founder", "submitted", "complete", "abandoned"] as const;
export const FILING_STATUSES = ["upcoming", "due", "overdue", "filed", "waived"] as const;
export const CONTRACT_STATUSES = ["draft", "review", "awaiting_signature", "signed", "active", "expired", "terminated"] as const;

export const legalEntities = pgTable(
  "legal_entities",
  {
    id: id(),
    businessId: businessId(),
    jurisdiction: text("jurisdiction").notNull(),
    entityType: text("entity_type").notNull(),
    legalName: text("legal_name").notNull(),
    regNo: text("reg_no"),
    registeredAddress: jsonb("registered_address").$type<Record<string, string>>(),
    officers: jsonb("officers").$type<unknown[]>().notNull().default(emptyList),
    shareCapitalMinor: minor("share_capital_minor"),
    currency: currency(),
    formedAt: date("formed_at", { mode: "string" }),
    source: text("source"),
    status: text("status", { enum: LEGAL_ENTITY_STATUSES }).notNull().default("planned"),
    ...timestampsWithArchive(),
  },
  (t) => [index("legal_entities_business_id_idx").on(t.businessId)],
);
export type LegalEntity = typeof legalEntities.$inferSelect;
export type NewLegalEntity = typeof legalEntities.$inferInsert;

export const incorporations = pgTable(
  "incorporations",
  {
    id: id(),
    businessId: businessId(),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id, { onDelete: "set null" }),
    route: text("route", { enum: INCORPORATION_ROUTES }).notNull(),
    status: text("status", { enum: INCORPORATION_STATUSES }).notNull().default("draft"),
    steps: jsonb("steps").$type<unknown[]>().notNull().default(emptyList),
    browserSessionId: text("browser_session_id"),
    workflowId: text("workflow_id"),
    submittedAt: tstz("submitted_at"),
    completedAt: tstz("completed_at"),
    ...timestampsWithArchive(),
  },
  (t) => [index("incorporations_business_id_idx").on(t.businessId), index("incorporations_legal_entity_id_idx").on(t.legalEntityId)],
);
export type Incorporation = typeof incorporations.$inferSelect;
export type NewIncorporation = typeof incorporations.$inferInsert;

export const filings = pgTable(
  "filings",
  {
    id: id(),
    businessId: businessId(),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    title: text("title").notNull().default(""),
    dueAt: tstz("due_at"),
    filedAt: tstz("filed_at"),
    status: text("status", { enum: FILING_STATUSES }).notNull().default("upcoming"),
    ref: text("ref"),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("filings_business_id_idx").on(t.businessId, t.dueAt),
    index("filings_legal_entity_id_idx").on(t.legalEntityId),
    index("filings_status_idx").on(t.businessId, t.status),
  ],
);
export type Filing = typeof filings.$inferSelect;
export type NewFiling = typeof filings.$inferInsert;

export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    businessId: businessId(),
    counterpartyEntityId: uuid("counterparty_entity_id").references((): AnyPgColumn => entities.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    title: text("title").notNull().default(""),
    status: text("status", { enum: CONTRACT_STATUSES }).notNull().default("draft"),
    docRef: text("doc_ref"),
    signedAt: tstz("signed_at"),
    startsAt: date("starts_at", { mode: "string" }),
    endsAt: date("ends_at", { mode: "string" }),
    valueMinor: minor("value_minor"),
    currency: currency(),
    obligations: jsonb("obligations").$type<unknown[]>().notNull().default(emptyList),
    ...timestampsWithArchive(),
  },
  (t) => [
    index("contracts_business_id_idx").on(t.businessId),
    index("contracts_counterparty_entity_id_idx").on(t.counterpartyEntityId),
    index("contracts_status_idx").on(t.businessId, t.status),
  ],
);
export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;

export const complianceEvents = pgTable(
  "compliance_events",
  {
    id: id(),
    businessId: businessId(),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    title: text("title").notNull().default(""),
    dueAt: tstz("due_at").notNull(),
    recurrence: text("recurrence"),
    completedAt: tstz("completed_at"),
    ...timestampsWithArchive(),
  },
  (t) => [index("compliance_events_business_id_idx").on(t.businessId, t.dueAt), index("compliance_events_legal_entity_id_idx").on(t.legalEntityId)],
);
export type ComplianceEvent = typeof complianceEvents.$inferSelect;
export type NewComplianceEvent = typeof complianceEvents.$inferInsert;

/** 0038 — the founder's choice per regulated sector (Legal › Regulatory): whether it applies, checklist items done. */
export const regulatoryGates = pgTable(
  "regulatory_gates",
  {
    id: id(),
    businessId: businessId(),
    sector: text("sector").notNull(),
    applies: boolean("applies").notNull().default(true),
    done: text("done").array().notNull().default(sql`'{}'::text[]`),
    decidedBy: uuid("decided_by"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("regulatory_gates_business_id_sector_key").on(t.businessId, t.sector)],
);
export type RegulatoryGate = typeof regulatoryGates.$inferSelect;
export type NewRegulatoryGate = typeof regulatoryGates.$inferInsert;
