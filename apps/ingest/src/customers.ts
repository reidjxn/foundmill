/**
 * Who converted, in the CRM (BUILD §11.4, §11.12): every signup, activation and payment that arrives through ingest is
 * linked to a CRM person, and a payer the CRM has never seen is added to it, so the conversion, the journey's touches
 * and the Customer Update all name the customer.
 *
 * Resolution order: the connector's own deterministic entity id (the demo seeds create customers at those ids) → the
 * business-scoped id ingest gives the customers it adds (`customerEntityId`) → a strong identifier (Stripe customer id,
 * then email) → a new person, created at the business-scoped id so the vendor's next delivery for the same customer
 * resolves without a lookup. Merged records resolve to the survivor. The customer role's stage moves forward only
 * (signed up → activated → customer). Runs inside the delivery's transaction.
 */
import { repos, type CreateEntityInput, type Entity } from "@foundmill/db";
import type { Executor } from "@foundmill/db/repos/_shared";
import { uuidFromSeed } from "@foundmill/connectors";
import { NotFoundError, type ConversionKind } from "@foundmill/shared";

/** The payer as the connector reported them (`payment.received` / `signup.created` payload `customer`). */
export interface ConvertingCustomer {
  externalId: string | null;
  email: string | null;
  name: string | null;
}

export interface LinkCustomerInput {
  /** The connector's deterministic entity id for this customer (`payload.entityId`). */
  connectorEntityId: string;
  /** `stripe`, `shopify`, `supabase_auth`… (becomes the record's source). */
  provider: string;
  customer: ConvertingCustomer | null;
  kind: ConversionKind;
  occurredAt: Date;
  /** The platform event the link comes from (field provenance). */
  sourceEventId: string;
}

export interface LinkedCustomer {
  entityId: string;
  /** True when the CRM had no record and ingest added one. */
  created: boolean;
}

/** The CRM role every converting person carries, and the stage each conversion kind moves it to. */
export const CUSTOMER_ROLE = "customer";
export const STAGE_FOR_KIND: Readonly<Record<ConversionKind, string>> = { signup: "signed_up", activation: "activated", payment: "customer" };
const STAGE_RANK: Readonly<Record<string, number>> = { signed_up: 1, activated: 2, customer: 3 };

/** The id ingest gives a customer it adds: scoped to the business, so two businesses' customers never share an id. */
export const customerEntityId = (businessId: string, connectorEntityId: string): string => uuidFromSeed("crm-customer", businessId, connectorEntityId);

const PROVIDER_LABELS: Readonly<Record<string, string>> = { stripe: "Stripe", shopify: "Shopify", paddle: "Paddle", supabase_auth: "Sign-up" };

/** The name a new record gets: the customer's name, else their email, else "<Vendor> customer <id>". */
export function customerDisplayName(provider: string, customer: ConvertingCustomer): string {
  const name = customer.name?.trim();
  if (name) return name.slice(0, 200);
  const email = customer.email?.trim();
  if (email) return email.slice(0, 200);
  const label = PROVIDER_LABELS[provider] ?? (provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "New");
  return `${label} customer${customer.externalId ? ` ${customer.externalId}` : ""}`.slice(0, 200);
}

async function resolveOrNull(tx: Executor, businessId: string, entityId: string): Promise<Entity | null> {
  try {
    return await repos.entities.resolve(tx, businessId, entityId);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

const hasCustomer = (c: ConvertingCustomer | null): c is ConvertingCustomer => Boolean(c && (c.externalId || c.email?.trim() || c.name?.trim()));

/**
 * Link the conversion to its CRM record, adding the customer when the CRM has none, and move the customer role forward.
 * Null only when the connector's id resolves to nothing and the vendor reported nobody (no id, email or name).
 */
export async function linkCustomer(tx: Executor, businessId: string, input: LinkCustomerInput): Promise<LinkedCustomer | null> {
  const customer = input.customer;
  const scopedId = customerEntityId(businessId, input.connectorEntityId);
  let entity = (await resolveOrNull(tx, businessId, input.connectorEntityId)) ?? (await resolveOrNull(tx, businessId, scopedId));
  if (!entity && hasCustomer(customer)) {
    if (input.provider === "stripe" && customer.externalId) entity = await repos.entities.findByIdentifier(tx, businessId, "stripe_id", customer.externalId);
    if (!entity && customer.email?.trim()) entity = await repos.entities.findByIdentifier(tx, businessId, "email", customer.email.trim());
    if (entity?.mergedIntoId) entity = await resolveOrNull(tx, businessId, entity.id);
  }
  if (!entity && !hasCustomer(customer)) return null;

  const identifiers = identifiersFor(input.provider, customer);
  let created = false;
  if (!entity) {
    const added = await addCustomerRecord(tx, businessId, { id: scopedId, kind: "person", displayName: customerDisplayName(input.provider, customer!), identifiers, lawfulBasis: "contract", source: input.provider });
    entity = added.entity;
    created = added.created;
    if (created) {
      for (const field of ["display_name", ...Object.keys(identifiers)]) {
        await repos.entities.recordProvenance(tx, businessId, entity.id, { field, source: input.provider, sourceRef: `event:${input.sourceEventId}`, confidence: 1, observedAt: input.occurredAt });
      }
    }
  }
  if (!created && Object.keys(identifiers).length > 0) {
    // Enrichment fills only what the record lacks (a founder's edits are never overwritten).
    entity = await repos.entities.enrich(tx, businessId, entity.id, { identifiers, source: input.provider });
  }

  await advanceCustomerRole(tx, businessId, entity.id, STAGE_FOR_KIND[input.kind], input.occurredAt);
  return { entityId: entity.id, created };
}

/**
 * Adds the customer at the business-scoped id. Two deliveries for one new customer can arrive together (Stripe sends a
 * subscription's `customer.subscription.created` and its first `invoice.paid` within milliseconds): the second insert
 * waits for the first transaction and then hits the primary key. It runs in a savepoint, so the loser links to the
 * record the winner committed instead of failing (and losing) its delivery.
 */
export async function addCustomerRecord(tx: Executor, businessId: string, input: CreateEntityInput & { id: string }): Promise<{ entity: Entity; created: boolean }> {
  try {
    return { entity: await tx.transaction((sp) => repos.entities.create(sp, businessId, input)), created: true };
  } catch (e) {
    const existing = await resolveOrNull(tx, businessId, input.id);
    if (existing) return { entity: existing, created: false };
    throw e;
  }
}

function identifiersFor(provider: string, customer: ConvertingCustomer | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!customer) return out;
  const email = customer.email?.trim();
  if (email) out.email = email.toLowerCase();
  if (customer.externalId) {
    if (provider === "stripe") out.stripe_id = customer.externalId;
    else if (/^[a-z][a-z0-9_]{0,40}$/.test(provider)) out[`${provider}_id`] = customer.externalId;
  }
  return out;
}

/** The customer role at `stage`: added when absent, moved forward when behind, never moved back (a late signup event keeps a paying customer a customer). */
export async function advanceCustomerRole(tx: Executor, businessId: string, entityId: string, stage: string, at: Date): Promise<void> {
  const roles = await repos.entities.listRoles(tx, businessId, entityId);
  const current = roles.find((r) => r.role === CUSTOMER_ROLE);
  if (!current) {
    await repos.entities.addRole(tx, businessId, entityId, { role: CUSTOMER_ROLE, stage, startedAt: at });
    return;
  }
  const now = current.stage ? (STAGE_RANK[current.stage] ?? 0) : 0;
  if ((STAGE_RANK[stage] ?? 0) > now) await repos.entities.updateRole(tx, businessId, current.id, { stage });
}
