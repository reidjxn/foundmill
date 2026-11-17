/**
 * One real project for the browser suites (`SEED_E2E_PROJECT=1`, a local PGlite directory only; WP-14 T9). The two demo
 * businesses are samples (`is_demo`): a sample shows nothing in public, so a spec about something only a real project
 * can do (share a Customer Update as a card) has nothing to stand on. This builds the smallest real project that can:
 * committed, the demo founder its owner, its team, a published page, and one win recorded as ingest records a real
 * payment (the event's actor is the payment webhook, so `isRealOutcome` is true of it).
 *
 * It is never built on a hosted database (src/seed.ts reads the flag on the PGlite path only), and it is older than
 * both demo businesses, so `/` still opens Northwind for a founder with no last-business cookie. Built once: a re-run
 * of the seed leaves an existing one as it is.
 */
import { getArchetypeSeed } from "@foundmill/agents";
import { eq, sql } from "drizzle-orm";
import { repos } from "../repos";
import { businesses } from "../schema";
import { DEMO_BUSINESS_IDS } from "./constants";
import type { SeedCtx } from "./context";
import { seedSquad } from "./squad";

export const E2E_PROJECT_BUSINESS_ID = "b1e5e5e5-0000-4000-8000-0000000000e2";
export const E2E_PROJECT_SLUG = "harbor-bikes";
export const E2E_PROJECT_NAME = "Harbor Bikes";
/** The customer of the seeded win: a spec asserts that none of this reaches the public card. */
export const E2E_PROJECT_CUSTOMER = { name: "Marguerite Okonkwo-Bell", email: "marguerite@customer.example", amountMinor: 13_750 } as const;
/** The agent the win's one touch names: the card's standout agent. */
export const E2E_PROJECT_STANDOUT_TEMPLATE = "channel_seo";

export async function seedE2eProject(ctx: SeedCtx): Promise<{ businessId: string; journeyId: string | null; built: boolean }> {
  const { db } = ctx;
  const businessId = E2E_PROJECT_BUSINESS_ID;
  const existing = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (existing.length) return { businessId, journeyId: null, built: false };

  await repos.businesses.create(db, { id: businessId, name: E2E_PROJECT_NAME, slug: E2E_PROJECT_SLUG, gameMode: "personal", businessMode: "assisted", archetype: "dtc_physical", kitPrimary: "#1f5f8b", kitSecondary: "#f4efe6", region: "us", planTier: "free", modelBilling: "credits", currency: "USD", createdBy: ctx.owner.userId });
  await repos.memberships.add(db, businessId, { userId: ctx.owner.userId, role: "owner" });
  await repos.businesses.commit(db, businessId, { archetype: "dtc_physical", committedAt: ctx.startDate });
  // Older than both samples: `/` opens a founder's newest business, and that stays Northwind.
  await db.execute(sql`update businesses set created_at = (select min(created_at) from businesses where id in (${sql.join(DEMO_BUSINESS_IDS.map((id) => sql`${id}::uuid`), sql`, `)})) - interval '1 day' where id = ${businessId}::uuid`);

  const squad = await seedSquad(ctx, businessId, getArchetypeSeed("dtc_physical"), { currency: "USD" });
  await repos.pages.publish(db, businessId, { content: { pitch: "Bike repairs at your door, booked in a minute", about: "We come to you with a van full of parts and fix the bike where it stands.", forWhom: "", stage: "building", showFounders: false, followForm: true }, slug: E2E_PROJECT_SLUG, userId: ctx.owner.userId });

  // One win, as ingest records a real payment: the customer, a touch an agent worked, the webhook's event, the
  // conversion and its Customer Update.
  const at = new Date(ctx.today.getTime() - 2 * 86_400_000);
  const customer = await repos.entities.create(db, businessId, { kind: "person", displayName: E2E_PROJECT_CUSTOMER.name, identifiers: { email: E2E_PROJECT_CUSTOMER.email }, lawfulBasis: "contract", source: "stripe", visibility: "private" });
  const agent = squad.byTemplate.get(E2E_PROJECT_STANDOUT_TEMPLATE)?.agent ?? squad.chief.agent;
  const touch = await repos.journeys.recordTouch(db, businessId, { entityId: customer.id, channelKey: "seo", occurredAt: new Date(at.getTime() - 86_400_000), source: { agentId: agent.id } });
  const event = await repos.events.write(db, businessId, {
    type: "payment.received",
    actor: { kind: "webhook", id: "stripe" },
    entityIds: [customer.id],
    payload: { entityId: customer.id, amount: { amountMinor: E2E_PROJECT_CUSTOMER.amountMinor, currency: "USD" }, provider: "stripe", externalId: "in_e2e_harbor_bikes_1", firstPayment: true },
    occurredAt: at,
    idempotencyKey: "e2e-project:payment:1",
  });
  const conversion = await repos.journeys.recordConversion(db, businessId, { entityId: customer.id, kind: "payment", amountMinor: E2E_PROJECT_CUSTOMER.amountMinor, currency: "USD", occurredAt: at, sourceEventId: event.id, firstPayment: true });
  const journey = await repos.journeys.create(db, businessId, {
    conversionId: conversion.id,
    touchIds: [touch.id],
    weights: { [touch.id]: 1 },
    agents: [{ agentId: agent.id, name: agent.name, role: null, departmentId: null, contribution: 1, touchIds: [touch.id], rating: 9 }],
    commentary: [],
    matchdayLevel: "league",
  });
  ctx.log(`[${E2E_PROJECT_SLUG}] a real project for the browser suites: 1 Customer Update from a real payment (${journey.id})`);
  return { businessId, journeyId: journey.id, built: true };
}
