/**
 * Deterministic fixtures for mock mode (BUILD §13.3, docs/ARCHITECTURE.md §8). Everything here is a pure
 * function of a seed: the same seed gives the same ids, amounts, dates and embeddings on every machine, so
 * e2e runs and snapshots are stable. `simulate()` backs the dev-only Simulate panel in Settings →
 * Integrations and returns events already validated against the catalogue in `packages/events`.
 */
import { createHash } from "node:crypto";
import seedrandom from "seedrandom";
import { parsePayload, type EventPayloadInput, type PlatformEvent } from "@foundmill/events/catalogue";
import type { Actor, ChannelKey, EventType, IntegrationStatus } from "@foundmill/shared";
import type { HealthResult, IntegrationRecord, SimulateParams } from "./contract";
import { canonicalJson } from "./quarantine";

// ---------------------------------------------------------------------------------------------------
// Seeded randomness and stable ids
// ---------------------------------------------------------------------------------------------------

export interface Rng {
  /** Uniform [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  bool(probability?: number): boolean;
  /** Normal distribution (Box–Muller). */
  gaussian(mean: number, sd: number): number;
  /** Deterministic UUID-shaped id drawn from the stream. */
  uuid(): string;
  /** Shuffle a copy. */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: string): Rng {
  const prng = seedrandom(seed);
  const rng: Rng = {
    next: () => prng.quick(),
    int: (min, max) => Math.floor(prng.quick() * (max - min + 1)) + min,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick: empty list");
      return items[Math.floor(prng.quick() * items.length)] as (typeof items)[number];
    },
    bool: (p = 0.5) => prng.quick() < p,
    gaussian: (mean, sd) => {
      let u = 0;
      let v = 0;
      while (u === 0) u = prng.quick();
      while (v === 0) v = prng.quick();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    uuid: () => uuidFromSeed(seed, "uuid", prng.int32()),
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(prng.quick() * (i + 1));
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
  };
  return rng;
}

/** sha256 hex of the canonical JSON of `value`, truncated to `length` characters. */
export function stableHash(value: unknown, length = 64): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex").slice(0, length);
}

/** Name-based UUID (RFC 9562 layout, version nibble 5) from any seed parts. `z.guid()` accepts it. */
export function uuidFromSeed(...parts: readonly (string | number)[]): string {
  const h = createHash("sha256").update(parts.map(String).join("\u001f")).digest("hex");
  const variant = ((parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Deterministic unit-length embedding of `text` with `dimension` components (Voyage mock). Not semantic —
 * but identical inputs embed identically and near-identical inputs do not, which is what retrieval tests need.
 */
export function deterministicEmbedding(text: string, dimension = 1024): number[] {
  const out = new Array<number>(dimension);
  let block = 0;
  let filled = 0;
  while (filled < dimension) {
    const digest = createHash("sha256").update(`${block}\u0000${text}`).digest();
    for (let i = 0; i + 1 < digest.length && filled < dimension; i += 2) {
      const v = digest.readUInt16BE(i) / 65535; // [0, 1]
      out[filled++] = v * 2 - 1;
    }
    block++;
  }
  const norm = Math.sqrt(out.reduce((acc, x) => acc + x * x, 0)) || 1;
  return out.map((x) => Number((x / norm).toFixed(8)));
}

// ---------------------------------------------------------------------------------------------------
// Dates and money
// ---------------------------------------------------------------------------------------------------

/** Fixed "now" for mocks so fixtures never drift; override per connector with `now`. */
export const MOCK_NOW = new Date("2026-10-05T09:00:00.000Z");

export const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** `"12.34"` / `12.34` → 1234 minor units (two-decimal currencies). */
export function minorFromDecimal(value: string | number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) throw new Error(`minorFromDecimal: not a number: ${value}`);
  return Math.round(n * 100);
}

export const decimalFromMinor = (amountMinor: number): string => (amountMinor / 100).toFixed(2);

// ---------------------------------------------------------------------------------------------------
// Per-business worlds for stateful mocks
// ---------------------------------------------------------------------------------------------------

/** How many businesses a stateful mock keeps at once; the least recently used one is forgotten first. */
export const MOCK_BUSINESS_LIMIT = 200;

export interface PerBusiness<W> {
  /** The business's world, created from the fixtures on first use (and again after it was forgotten). */
  (businessId: string): W;
  /** The world if this business has one, without creating or refreshing it. */
  peek(businessId: string): W | undefined;
  size(): number;
  clear(): void;
}

/**
 * One world per business for a stateful mock connector. Staging runs `INTEGRATIONS_MODE=mock` for real founders, so
 * what one business's agents write (drafts, customers, events, suppressions...) must never be visible to another:
 * `create` copies the fixtures for each business, and handlers read and write `world(ctx.businessId)` only. Bounded
 * like the GitHub mock: beyond `limit` businesses the least recently used world is dropped and starts again from the
 * fixtures the next time that business calls.
 */
export function perBusiness<W>(create: (businessId: string) => W, limit = MOCK_BUSINESS_LIMIT): PerBusiness<W> {
  const worlds = new Map<string, W>();
  const world = ((businessId: string): W => {
    let w = worlds.get(businessId);
    if (w !== undefined) worlds.delete(businessId);
    else w = create(businessId);
    worlds.set(businessId, w);
    while (worlds.size > limit) worlds.delete(worlds.keys().next().value!);
    return w;
  }) as PerBusiness<W>;
  world.peek = (businessId) => worlds.get(businessId);
  world.size = () => worlds.size;
  world.clear = () => worlds.clear();
  return world;
}

// ---------------------------------------------------------------------------------------------------
// Mock integration records and health
// ---------------------------------------------------------------------------------------------------

export function mockIntegrationRecord(connectorKey: string, businessId: string, overrides: Partial<IntegrationRecord> = {}): IntegrationRecord {
  return {
    id: uuidFromSeed("integration", connectorKey, businessId),
    businessId,
    connectorKey,
    status: "mock" as IntegrationStatus,
    scopes: [],
    accountLabel: `${connectorKey} (mock)`,
    externalAccountId: `mock_${connectorKey}_${stableHash(businessId, 8)}`,
    config: {},
    credentialRef: null,
    expiresAt: null,
    lastHealthAt: MOCK_NOW.toISOString(),
    createdAt: MOCK_NOW.toISOString(),
    ...overrides,
  };
}

export function mockHealth(connectorKey: string, details: Record<string, unknown> = {}): HealthResult {
  return { ok: true, status: "mock", checkedAt: MOCK_NOW.toISOString(), latencyMs: 1, message: `${connectorKey} mock healthy`, details };
}

// ---------------------------------------------------------------------------------------------------
// Platform events
// ---------------------------------------------------------------------------------------------------

export const SIMULATE_ACTOR: Actor = { kind: "system", id: "simulate" };

export interface MakeEventInput<T extends EventType> {
  businessId: string;
  payload: EventPayloadInput<T>;
  actor?: Actor;
  entityIds?: string[];
  occurredAt?: Date;
  /** Id seed; defaults to a hash of type + payload so re-simulating the same thing yields the same id. */
  seed?: string;
}

/** Build a validated PlatformEvent (payload parsed against the catalogue; throws ValidationError on drift). */
export function makeEvent<T extends EventType>(type: T, input: MakeEventInput<T>): PlatformEvent<T> {
  const payload = parsePayload(type, input.payload);
  const occurredAt = input.occurredAt ?? MOCK_NOW;
  const id = uuidFromSeed("event", type, input.businessId, input.seed ?? stableHash(payload));
  return { id, businessId: input.businessId, type, occurredAt, actor: input.actor ?? SIMULATE_ACTOR, entityIds: input.entityIds ?? [], payload, narrated: false } as PlatformEvent<T>;
}

// ---------------------------------------------------------------------------------------------------
// simulate(): the dev Simulate panel (BUILD §13.3)
// ---------------------------------------------------------------------------------------------------

export const SIMULATE_EVENTS = [
  { name: "signup.created", label: "New signup", description: "A visitor signs up (Match Day: friendly).", emits: "signup.created" },
  { name: "payment.received", label: "Payment received", description: "A first Stripe payment lands (Match Day: cup tie).", emits: "payment.received" },
  { name: "lead.replied", label: "Lead replied", description: "An outbound email gets a reply.", emits: "lead.replied" },
  { name: "bank.sync", label: "Bank sync", description: "Open-banking sync updates the balance.", emits: "bank.balance_updated" },
  { name: "cpa.spike", label: "CPA spike", description: "Paid campaign CPA over cap for 48 h; engine pauses it.", emits: "channel.threshold_breached" },
  { name: "credential.expiry", label: "Credential expiry", description: "A connector credential is about to expire.", emits: "credential.expiring" },
] as const satisfies readonly { name: string; label: string; description: string; emits: EventType }[];

export type SimulateEventName = (typeof SIMULATE_EVENTS)[number]["name"];
export const SIMULATE_EVENT_NAMES = SIMULATE_EVENTS.map((e) => e.name) as readonly SimulateEventName[];

export const isSimulateEventName = (name: string): name is SimulateEventName => (SIMULATE_EVENT_NAMES as readonly string[]).includes(name);

const str = (v: unknown, fallback: string): string => (typeof v === "string" && v.length > 0 ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

const SIM_CHANNELS: readonly ChannelKey[] = ["seo", "content", "paid_ads", "email_automation", "social", "pr"];

/**
 * Produce platform events for a Simulate panel action. Deterministic in `(eventName, businessId, seed)`.
 * Overrides are read from `params` by name (`amountMinor`, `currency`, `email`, `sentiment`, ...).
 */
export function simulate(eventName: string, params: SimulateParams): PlatformEvent[] {
  if (!isSimulateEventName(eventName)) throw new Error(`simulate: unknown event "${eventName}" (expected one of ${SIMULATE_EVENT_NAMES.join(", ")})`);
  const seed = str(params.seed, "default");
  const rng = createRng(`simulate:${eventName}:${params.businessId}:${seed}`);
  const occurredAt = params.occurredAt ?? MOCK_NOW;
  const businessId = params.businessId;
  const email = str(params.email, `founder+${stableHash(seed, 6)}@example.com`);
  const entityId = uuidFromSeed("sim", businessId, "entity", email);
  const currency = str(params.currency, "EUR");

  switch (eventName) {
    case "signup.created": {
      const channelKey = (params.channelKey as ChannelKey | undefined) ?? rng.pick(SIM_CHANNELS);
      return [
        makeEvent("signup.created", {
          businessId,
          occurredAt,
          seed,
          entityIds: [entityId],
          payload: {
            entityId,
            conversionId: uuidFromSeed("sim", businessId, "conversion", "signup", email),
            visitorId: uuidFromSeed("sim", businessId, "visitor", email),
            channelKey,
            campaignId: null,
            source: { utmSource: channelKey === "paid_ads" ? "google" : null, utmMedium: channelKey === "paid_ads" ? "cpc" : null, utmCampaign: null, referrer: channelKey === "seo" ? "https://www.google.com/" : null, code: null },
            provider: str(params.provider, "supabase_auth"),
            consentState: (params.consentState as "granted" | "denied" | "unknown" | undefined) ?? "granted",
          },
        }),
      ];
    }
    case "payment.received": {
      const amountMinor = num(params.amountMinor, 4900);
      return [
        makeEvent("payment.received", {
          businessId,
          occurredAt,
          seed,
          entityIds: [entityId],
          payload: {
            entityId,
            conversionId: uuidFromSeed("sim", businessId, "conversion", "payment", email, seed),
            amount: { amountMinor, currency },
            provider: (params.provider as "stripe" | "shopify" | "paddle" | "contract" | "bank" | "manual" | "other" | undefined) ?? "stripe",
            externalId: `in_sim_${stableHash([businessId, email, seed], 14)}`,
            firstPayment: bool(params.firstPayment, true),
            recurring: bool(params.recurring, true),
            productRef: str(params.productRef, "Pro monthly"),
            fee: params.feeMinor === undefined ? { amountMinor: Math.round(amountMinor * 0.029) + 25, currency } : { amountMinor: num(params.feeMinor, 0), currency },
          },
        }),
      ];
    }
    case "lead.replied": {
      const sentiment = (params.sentiment as "positive" | "neutral" | "negative" | "unsubscribe" | "out_of_office" | undefined) ?? "positive";
      const requestsMeeting = bool(params.requestsMeeting, sentiment === "positive");
      return [
        makeEvent("lead.replied", {
          businessId,
          occurredAt,
          seed,
          entityIds: [entityId],
          payload: {
            entityId,
            channelKey: "email_automation",
            campaignId: params.campaignId ? String(params.campaignId) : null,
            interactionId: uuidFromSeed("sim", businessId, "interaction", email, seed),
            sentiment,
            summary: str(params.summary, sentiment === "positive" ? `${email} is interested and asks for a 20-minute call next week.` : sentiment === "unsubscribe" ? `${email} asked to be removed from all emails.` : `${email} replied: ${sentiment.replace("_", " ")}.`),
            requestsMeeting,
          },
        }),
      ];
    }
    case "bank.sync": {
      const previous = num(params.previousBalanceMinor, 18_420_000 + rng.int(-500_000, 500_000));
      const delta = num(params.deltaMinor, rng.int(-900_000, 1_400_000));
      const accountId = uuidFromSeed("sim", businessId, "bank-account", "main");
      return [
        makeEvent("bank.balance_updated", {
          businessId,
          occurredAt,
          seed,
          payload: {
            accountId,
            provider: str(params.provider, "tink"),
            accountName: str(params.accountName, "Business current account"),
            balance: { amountMinor: previous + delta, currency },
            previousBalance: { amountMinor: previous, currency },
            delta: { amountMinor: delta, currency },
            balanceAt: occurredAt.toISOString(),
            newTransactions: num(params.newTransactions, rng.int(3, 14)),
            consentExpiresAt: addDays(occurredAt, num(params.consentDays, 62)).toISOString(),
          },
        }),
      ];
    }
    case "cpa.spike": {
      const channelKey = (params.channelKey as ChannelKey | undefined) ?? "paid_ads";
      const threshold = num(params.threshold, 12_000);
      return [
        makeEvent("channel.threshold_breached", {
          businessId,
          occurredAt,
          seed,
          payload: {
            channelId: uuidFromSeed("sim", businessId, "channel", channelKey),
            channelKey,
            campaignId: uuidFromSeed("sim", businessId, "campaign", channelKey, seed),
            metric: "cpa",
            value: num(params.value, Math.round(threshold * 1.55)),
            threshold,
            direction: "above",
            windowHours: num(params.windowHours, 48),
            action: (params.action as "none" | "alerted" | "paused" | "reallocated" | undefined) ?? "paused",
          },
        }),
      ];
    }
    case "credential.expiry": {
      const connectorKey = str(params.connectorKey, "sendgrid");
      const daysRemaining = num(params.daysRemaining, 7);
      return [
        makeEvent("credential.expiring", {
          businessId,
          occurredAt,
          seed,
          payload: {
            integrationId: uuidFromSeed("integration", connectorKey, businessId),
            credentialId: uuidFromSeed("credential", connectorKey, businessId),
            connectorKey,
            accountLabel: str(params.accountLabel, `${connectorKey} (mock)`),
            expiresAt: addDays(occurredAt, daysRemaining).toISOString(),
            daysRemaining,
            affectedAgentIds: [uuidFromSeed("sim", businessId, "agent", connectorKey)],
            expired: daysRemaining <= 0,
          },
        }),
      ];
    }
    default:
      return [];
  }
}
