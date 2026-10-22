/**
 * The faces of anthropomorphic agents (docs/DECISIONS.md, Anthropomorphic agents). One AI-generated portrait per persona
 * catalog key, a platform asset in `persona_portraits` (at most 240 ever), made on first need and served by
 * `GET /personas/:key`.
 *
 * `ensurePortraits` is what `team.personas.ensure` calls with a business's persona keys: it answers at once with what is
 * ready and what is not, and starts the missing ones in the background. The request never waits for an image:
 *  - a key already being generated in this process is not started twice (in-flight dedupe);
 *  - at most `PORTRAIT_CONCURRENCY` images are made at the same time, the rest wait their turn in a queue;
 *  - a failure is logged (the key, never a prompt or image) and the key is not tried again for `PORTRAIT_RETRY_MS`, so a
 *    broken key or an unreachable gateway is retried by a later call, never in a tight loop;
 *  - a queued key whose portrait another replica stored meanwhile is skipped.
 * In mock mode (`INTEGRATIONS_MODE=mock` and `openai_images` not in `LIVE_CONNECTORS`) the connector's deterministic
 * placeholder is drawn right here, with no gateway, like the domain checks; live, the gateway makes the image with the
 * platform key and its own prompt, built from the key (the api can never send one).
 */
import { MOCK_IMAGE_MODEL, openaiImagesMock, OPENAI_IMAGES_KEY, mockIntegrationRecord } from "@foundmill/connectors";
import { repos, type Db } from "@foundmill/db";
import { connectorMode, personaByKey, personaPortraitPrompt, type Env } from "@foundmill/shared";
import type { ApiGatewayClient, GatewayPortrait } from "./gateway";
import type { ApiLogger } from "./log";

/** Images made at the same time, whatever the number of businesses asking. */
export const PORTRAIT_CONCURRENCY = 3;
/** How long a key that failed is left alone before a later call may try it again. */
export const PORTRAIT_RETRY_MS = 60_000;

export interface PortraitDeps {
  db: Db;
  env: Pick<Env, "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">;
  gateway: ApiGatewayClient;
  log: Pick<ApiLogger, "info" | "warn">;
  /** Clock for the retry window; tests move it. */
  now?: () => number;
}

export interface PortraitStatus {
  /** Keys with a stored portrait, in the order asked. */
  ready: string[];
  /** Catalog keys without one yet (generation started, queued, or waiting out a failure). */
  pending: string[];
}

interface State {
  inFlight: Set<string>;
  queue: { key: string; deps: PortraitDeps; businessId?: string }[];
  failedAt: Map<string, number>;
  active: number;
  idle: (() => void)[];
}

const state: State = { inFlight: new Set(), queue: [], failedAt: new Map(), active: 0, idle: [] };

/** Forgets every in-flight key, queued key and failure (tests). */
export function resetPortraitState(): void {
  state.inFlight.clear();
  state.queue.length = 0;
  state.failedAt.clear();
  state.active = 0;
  state.idle.length = 0;
}

/** Resolves when nothing is queued or being made (tests wait on it; the request path never does). */
export function portraitsIdle(): Promise<void> {
  return state.inFlight.size === 0 ? Promise.resolve() : new Promise((resolve) => state.idle.push(resolve));
}

/** One portrait: the local placeholder in mock mode, the gateway otherwise. */
export async function generatePortraitFor(deps: Pick<PortraitDeps, "env" | "gateway">, personaKey: string, businessId?: string): Promise<GatewayPortrait> {
  const persona = personaByKey(personaKey);
  if (!persona) throw new Error("not a persona catalog key");
  if (connectorMode(deps.env, OPENAI_IMAGES_KEY) === "live") return deps.gateway.generatePortrait(personaKey, businessId);
  const id = businessId ?? "00000000-0000-0000-0000-000000000000";
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const result = await openaiImagesMock.callTool("generate_image", { prompt: personaPortraitPrompt(persona), size: "1024x1024", quality: "medium" }, { businessId: id, agentId: id, sessionId: id, integration: mockIntegrationRecord(OPENAI_IMAGES_KEY, id), log, mode: "mock" });
  if (!result.ok) throw new Error(result.error?.message ?? "the placeholder portrait could not be drawn");
  const data = result.data as GatewayPortrait;
  return { mime: data.mime, base64: data.base64, model: data.model || MOCK_IMAGE_MODEL };
}

function finish(): void {
  if (state.inFlight.size === 0) for (const resolve of state.idle.splice(0)) resolve();
}

async function run(job: State["queue"][number]): Promise<void> {
  const { key, deps } = job;
  try {
    // Another replica may have stored it while this key waited in the queue.
    if ((await repos.personaPortraits.readyKeys(deps.db, [key])).length > 0) return;
    const image = await generatePortraitFor(deps, key, job.businessId);
    await repos.personaPortraits.put(deps.db, { key, mime: image.mime, content: new Uint8Array(Buffer.from(image.base64, "base64")), model: image.model });
    state.failedAt.delete(key);
    deps.log.info({ personaKey: key, model: image.model }, "persona portrait stored");
  } catch (err) {
    state.failedAt.set(key, (deps.now ?? Date.now)());
    deps.log.warn({ personaKey: key, err: err instanceof Error ? err.message : "unknown", retryInSeconds: PORTRAIT_RETRY_MS / 1000 }, "persona portrait failed; a later call will try again");
  }
}

function pump(): void {
  while (state.active < PORTRAIT_CONCURRENCY && state.queue.length > 0) {
    const job = state.queue.shift()!;
    state.active += 1;
    void run(job).finally(() => {
      state.active -= 1;
      state.inFlight.delete(job.key);
      pump();
      finish();
    });
  }
}

/**
 * Says which of `keys` have a portrait and starts generating the others in the background. Keys outside the catalog are
 * dropped. Only the stored-portrait lookup is awaited; the images are never awaited by the caller.
 */
export async function ensurePortraits(deps: PortraitDeps, keys: readonly (string | null | undefined)[], options: { businessId?: string } = {}): Promise<PortraitStatus> {
  const wanted = [...new Set(keys.filter((k): k is string => typeof k === "string" && personaByKey(k) !== null))];
  if (wanted.length === 0) return { ready: [], pending: [] };
  const ready = await repos.personaPortraits.readyKeys(deps.db, wanted);
  const have = new Set(ready);
  const pending = wanted.filter((k) => !have.has(k));
  const now = (deps.now ?? Date.now)();
  for (const key of pending) {
    if (state.inFlight.has(key)) continue;
    const failed = state.failedAt.get(key);
    if (failed !== undefined && now - failed < PORTRAIT_RETRY_MS) continue;
    state.inFlight.add(key);
    state.queue.push({ key, deps, ...(options.businessId ? { businessId: options.businessId } : {}) });
  }
  pump();
  return { ready, pending };
}

/** The stored portrait of a catalog key for `GET /personas/:key`, or null (unknown key, not generated yet). */
export async function storedPortrait(db: Db, key: string): Promise<{ mime: string; content: Uint8Array } | null> {
  if (personaByKey(key) === null) return null;
  const row = await repos.personaPortraits.get(db, key);
  return row ? { mime: row.mime, content: row.content } : null;
}
