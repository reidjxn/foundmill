/**
 * Test harness: PGlite (packages/db testing), two businesses from the RLS fixture, the real MockModelClient with the
 * composer's usage sink, and a service factory (debounce off by default so suites control timing explicitly).
 */
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type Db, type Event } from "@foundmill/db";
import { buildManifest, type Manifest } from "@foundmill/entity-linker";
import { createModelClient, type ModelClient, type MockGenerator, type ModelLogger, type RouteKey, type UsageEvent } from "@foundmill/models";
import type { EntityKind, EventType } from "@foundmill/shared";
import { createComposerService, type ComposerService, type ComposerServiceOptions } from "../service";
import { createUsageSink } from "../usage";

export interface ComposerHarness {
  h: TestHarness;
  db: Db;
  A: BusinessFixture;
  B: BusinessFixture;
  log: ModelLogger;
  /** Every metered model call (through the usage sink). */
  usage: UsageEvent[];
  models: ModelClient;
  /** A service over the shared mock client; `overrides` builds a separate client for scripted model behaviour. */
  service(options?: ComposerServiceOptions, overrides?: Partial<Record<RouteKey, MockGenerator>>): ComposerService;
  writeEvent(businessId: string, type: EventType, payload?: Record<string, unknown>, entityIds?: string[]): Promise<Event>;
  /** The manifest the composer sees for a business (CRM entities + agents), for independent link validation. */
  manifest(businessId: string): Promise<Manifest>;
  close(): Promise<void>;
}

export const silentLog: ModelLogger = { debug() {}, info() {}, warn() {}, error() {} };

export async function createComposerHarness(prefix: string): Promise<ComposerHarness> {
  const h = await createTestDb();
  const db = h.db as unknown as Db;
  const usage: UsageEvent[] = [];
  const onUsage = createUsageSink(db, silentLog, { onRecorded: (e) => usage.push(e) });
  const models = createModelClient({ mode: "mock", logger: silentLog, onUsage });
  const [A, B] = await Promise.all([createBusinessFixture(h, `${prefix}-a`), createBusinessFixture(h, `${prefix}-b`)]);
  return {
    h,
    db,
    A,
    B,
    log: silentLog,
    usage,
    models,
    service(options = {}, overrides) {
      const client = overrides ? createModelClient({ mode: "mock", logger: silentLog, onUsage, mock: { overrides } }) : models;
      return createComposerService({ db, models: client, log: silentLog }, { debounceMs: 0, persistDrafts: false, ...options });
    },
    writeEvent(businessId, type, payload = {}, entityIds = []) {
      return repos.events.write(db, businessId, { type, actor: { kind: "system", id: "test" }, payload, entityIds });
    },
    async manifest(businessId) {
      const [crm, agents] = await Promise.all([repos.entities.manifest(db, businessId, { limit: 300 }), repos.agents.list(db, businessId, { limit: 200 })]);
      return buildManifest(
        [
          ...crm.map((e) => ({ id: e.id, kind: e.kind as EntityKind, name: e.displayName, aliases: e.aliases })),
          ...agents.items.map((a) => ({ id: a.id, kind: "agent" as const, name: a.name, aliases: [] as string[] })),
        ],
        { strictKinds: false },
      );
    },
    close: () => h.close(),
  };
}

/** Un-narrated narratable events for a business (what Refresh rule 1 sees). */
export async function unnarratedIds(db: Db, businessId: string): Promise<string[]> {
  const rows = await repos.events.unnarrated(db, businessId, 50);
  return rows.filter((e) => e.type !== "inbox.item_created").map((e) => e.id);
}

/** Slot keys Refresh has served for a business (buffer rows with `consumed_at`; one row per key). */
export async function servedKeys(h: TestHarness, businessId: string): Promise<string[]> {
  const res = await h.pg.query<{ key: string }>("select source_hash as key from composer_buffer where business_id = $1 and consumed_at is not null", [businessId]);
  return res.rows.map((r) => r.key);
}

export async function countInbox(db: Db, businessId: string): Promise<number> {
  const page = await repos.inbox.list(db, businessId, { limit: 500 });
  return page.items.length;
}

/** The founder answers every decision that is waiting (a new press can then write a new one: audit CML-02). */
export async function answerOpenDecisions(db: Db, businessId: string): Promise<number> {
  const open = await repos.inbox.list(db, businessId, { type: "decision", state: ["unread", "read"], limit: 200 });
  for (const item of open.items) {
    const options = (item.decision as { options?: { id: string; recommended?: boolean }[] } | null)?.options ?? [];
    const choice = options.find((o) => o.recommended) ?? options[0];
    await repos.inbox.decide(db, businessId, item.id, choice ? { chosenOption: choice.id } : { freeText: "Noted" });
  }
  return open.items.length;
}

/** Count of events that are not the composer's own `inbox.item_created` rows (the "never fabricates events" check). */
export async function countSourceEvents(db: Db, businessId: string): Promise<number> {
  const counts = await repos.events.countByType(db, businessId);
  return Object.entries(counts).reduce((n, [type, c]) => (type === "inbox.item_created" ? n : n + c), 0);
}

export const p95 = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};
