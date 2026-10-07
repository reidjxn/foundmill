/**
 * Dev-only Simulate panel backend (BUILD §13.3; Settings → Integrations → Simulate). Enabled only when
 * `APP_ENV` is development or staging and `FLAGS.devSimulatePanel` is on; in every other environment the
 * routes do not exist (404), so production cannot fabricate events.
 *
 * Each of the six panel actions is served by a mock connector's `simulate()` (the panel can name one; otherwise
 * the first mock that offers the simulation in catalogue order is used) and, when no mock offers it, by the
 * shared `simulate()` in packages/connectors. The resulting events take the same write path as webhook
 * deliveries, so a simulated payment records its conversion and its `customer.converted` event exactly like a
 * real one — the actor says `system:simulate` so nothing can pass for a real delivery.
 */
import { FLAGS } from "@foundmill/config";
import { isMockConnector, SIMULATE_EVENTS, SIMULATE_EVENT_NAMES, simulate as simulateGeneric, type MockConnector, type PlatformEvent, type SimulateParams } from "@foundmill/connectors";
import { AppError, NotFoundError, isUuid } from "@foundmill/shared";
import { z } from "zod";
import { ingestPlatformEvents, isValidationError, type IngestResult } from "./ingest";
import type { IngestDeps } from "./types";

export const SIMULATE_ACTOR = { kind: "system" as const, id: "simulate" };

export const SimulateBody = z
  .object({
    businessId: z.guid(),
    /** Which mock connector should produce the events; defaults per event name. */
    connector: z.string().trim().min(1).max(60).optional(),
    seed: z.string().max(120).optional(),
    occurredAt: z.coerce.date().optional(),
    /** Event-specific overrides (amountMinor, email, sentiment, channelKey...). */
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type SimulateBody = z.input<typeof SimulateBody>;

/** Whether the Simulate routes exist for this environment (never in test or production). */
export const simulateEnabledFor = (appEnv: string, flag: boolean = FLAGS.devSimulatePanel): boolean => flag && (appEnv === "development" || appEnv === "staging");

export interface SimulationCatalogueEntry {
  name: string;
  label: string;
  description: string;
  emits: string;
  /** Mock connectors able to produce this simulation (catalogue order); empty = served by the generic simulator. */
  connectors: string[];
}

/** What the panel renders: the six actions and which mocks back them. */
export function simulationCatalogue(deps: Pick<IngestDeps, "registry">): SimulationCatalogueEntry[] {
  const mocks = deps.registry.list("mock").filter(isMockConnector);
  return SIMULATE_EVENTS.map((e) => ({ ...e, connectors: mocks.filter((m) => m.simulations.includes(e.name)).map((m) => m.key) }));
}

/** Which mock serves a panel action when the panel names none (the vendor the BUILD §11.4/§13.3 wording has in mind). */
export const DEFAULT_SIMULATION_CONNECTORS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "payment.received": ["stripe", "shopify"],
  "signup.created": ["stripe", "shopify"],
  "lead.replied": ["sendgrid", "gmail"],
  "bank.sync": ["tink", "plaid"],
  "credential.expiry": ["sendgrid", "tink", "plaid", "anthropic"],
});

export function pickMockFor(deps: Pick<IngestDeps, "registry">, eventName: string, preferred?: string): MockConnector | null {
  if (preferred) {
    if (!deps.registry.has(preferred)) throw new NotFoundError("connector", preferred);
    const mock = deps.registry.getMock(preferred);
    if (!mock.simulations.includes(eventName)) throw new AppError("unknown_simulation", `${preferred} mock cannot simulate "${eventName}" (available: ${mock.simulations.join(", ") || "none"})`, 400);
    return mock;
  }
  for (const key of DEFAULT_SIMULATION_CONNECTORS[eventName] ?? []) {
    if (!deps.registry.has(key)) continue;
    const mock = deps.registry.getMock(key);
    if (mock.simulations.includes(eventName)) return mock;
  }
  return deps.registry.list("mock").filter(isMockConnector).find((m) => m.simulations.includes(eventName)) ?? null;
}

export interface SimulateOutcome {
  eventName: string;
  connector: string | null;
  events: PlatformEvent[];
  result: IngestResult;
}

export async function runSimulation(deps: IngestDeps, eventName: string, body: z.output<typeof SimulateBody>): Promise<SimulateOutcome> {
  if (!deps.simulateEnabled) throw new NotFoundError("route");
  if (!isUuid(body.businessId)) throw new AppError("validation", "businessId must be a UUID", 400);
  const known = (SIMULATE_EVENT_NAMES as readonly string[]).includes(eventName);
  const mock = pickMockFor(deps, eventName, body.connector);
  if (!mock && !known) throw new NotFoundError("simulation", eventName);

  const params: SimulateParams = { ...(body.params ?? {}), businessId: body.businessId, seed: body.seed, occurredAt: body.occurredAt ?? deps.now() };
  const events: PlatformEvent[] = mock ? await mock.simulate(eventName, params) : simulateGeneric(eventName, params);
  const stamped = events.map((e) => ({ ...e, actor: SIMULATE_ACTOR }) as PlatformEvent);
  const source = `simulate:${mock?.key ?? "generic"}`;
  try {
    const result = await ingestPlatformEvents(deps.db, stamped, { source, actor: SIMULATE_ACTOR, log: deps.log });
    deps.log.info({ eventName, connector: mock?.key ?? null, businessId: body.businessId, written: result.written, duplicates: result.duplicates }, "simulation ingested");
    return { eventName, connector: mock?.key ?? null, events: stamped, result };
  } catch (e) {
    if (isValidationError(e)) throw new AppError("invalid_payload", e.message, 422, e.details);
    throw e;
  }
}
