/**
 * The landing page's idea box (founder, 2026-11-13; docs/IDEA_BOX.md): one rated card for a visitor who has not signed
 * up, kept by a token in their browser's cookie (and a claim token their sign-in link carries) until they sign in and
 * claim it into their deck.
 *
 * A draft, in order, before any model call: the request's shape and the honeypot; the browser's live card (one per
 * browser: it gets that card back, nothing is drafted, unless it asks for another with `again`, up to
 * `IDEA_BOX_REDRAWS_PER_BROWSER` a day, and then every check below still runs); the bot check (Turnstile, through the gateway); the per-address
 * windows; the day's spend ceiling across every visitor ($20, `IDEA_BOX_DAILY_CEILING_CENTS`). Then the Ideation
 * agent's idea-box card on the platform key, streamed: the name and pitch as soon as they are written, then each rating.
 * The card is stored only when it is complete and valid.
 */
import { createHash, randomBytes } from "node:crypto";
import { buildIdeaBoxCardRequest, IDEATION_CARD_MAX_TOKENS, IDEATION_CARD_ROUTE } from "@foundmill/agents";
import { IDEA_DRAFT_SWEEP_BATCH, repos, type IdeaDraftRow } from "@foundmill/db";
import { IdeaAttribute, isModelBillingError, meter, ModelOutputError, resolveModel, streamStructured, type ConceptCard, type ModelClient } from "@foundmill/models";
import { IDEA_BOX_DEADLINE_MS, IDEA_BOX_ERRORS, IDEA_BOX_REDRAWS_PER_BROWSER, IdeaBoxDraftRequest, IdeaToken, limitAddress, type IdeaBoxCard, type IdeaBoxErrorCode, type IdeaBoxEvent, type IdeaBoxPartialCard } from "@foundmill/shared";
import type { Env } from "@foundmill/shared";
import { ideaFromCard } from "./ideation";
import { callerLimitKey } from "./pages";
import type { ApiGatewayClient } from "./gateway";
import type { LimitEntry, RateLimitStore, WindowLimit } from "./rate-limit";

const HOUR = 60 * 60_000;
/** The token the web sends without a Turnstile site key (development stacks); the gateway's mock passes it. */
export const MOCK_TURNSTILE_TOKEN = "mock-ok";
/** The action the widget runs with; the gateway checks Cloudflare reports the same (security review P3-1). */
export const IDEA_BOX_TURNSTILE_ACTION = "idea_box";
const DAY = 24 * HOUR;

/** Per connection: about five cards a day (founder, 2026-11-13), three in any hour; and a backstop across all of them. */
export const IDEA_BOX_LIMITS = {
  perAddressHour: { limit: 3, windowMs: HOUR },
  perAddressDay: { limit: 5, windowMs: DAY },
  allHour: { limit: 400, windowMs: HOUR },
  /** "Try another idea" (WP-03 T7): per browser token, on top of the address's own windows. */
  redrawsPerBrowserDay: { limit: IDEA_BOX_REDRAWS_PER_BROWSER, windowMs: DAY },
} as const satisfies Record<string, WindowLimit>;

/**
 * What one card can cost at most (Estimate, millionths of a US cent): the card route's model at its full output budget
 * and a generous prompt. The day's ceiling is reserved card by card at this price before any model call, and a call
 * once started is never given back (security review 2026-11-13, P1-1: a visitor who closes the stream early still cost
 * the call), so the ceiling holds however the calls end.
 */
export const IDEA_BOX_CARD_RESERVE_MICRO = (() => {
  const route = resolveModel(IDEATION_CARD_ROUTE);
  return meter({ inputTokens: 4_000, outputTokens: IDEATION_CARD_MAX_TOKENS, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, route.modelId, route.speed ? { speed: route.speed } : {}).costMicroMinor;
})();

/** How many cards the day's ceiling reserves for (at least one while the ceiling is above zero). */
export function ideaBoxDailyCards(ceilingCents: number): number {
  if (ceilingCents <= 0) return 0;
  return Math.max(1, Math.floor((ceilingCents * 1_000_000) / IDEA_BOX_CARD_RESERVE_MICRO));
}

/**
 * The address a per-address window counts (security review P2-2): @foundmill/shared's `limitAddress`, the one copy
 * (an IPv4-mapped IPv6 address as its IPv4, any other IPv6 address as its /64, IPv4 as it is). Re-exported for the
 * idea box's tests.
 */
export { limitAddress };

/** A new browser or claim token: 32 random bytes, base64url (43 characters). */
export const newIdeaToken = (): string => randomBytes(32).toString("base64url");
/** What the database stores for a token: its SHA-256, lowercase hex. */
export const ideaTokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

export interface IdeaBoxDeps {
  db: Parameters<typeof repos.ideaDrafts.create>[0];
  models: ModelClient;
  limits: RateLimitStore;
  env: Pick<Env, "SESSION_TOKEN_SECRET" | "APP_ENV" | "APP_URL" | "IDEA_BOX_DAILY_CEILING_CENTS">;
  gateway: Pick<ApiGatewayClient, "verifyTurnstile">;
  log: { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
  now?: () => Date;
}

export interface IdeaBoxDraftInput {
  body: unknown;
  /** The `fm_idea` cookie, when the browser sent one. */
  cookieToken: string | null;
  /** The visitor's address as the api sees it (`clientAddressOf`). */
  address: string | null;
  /** The site's hostname the widget must have run on (production: foundmill.com); null skips the check. */
  hostname: string | null;
}

/** What the route answers: a cookie to set (a new draft), and the stream's events. */
export interface IdeaBoxDraftPlan {
  setToken: string | null;
  events: AsyncGenerator<IdeaBoxEvent, void, undefined>;
}

const errorEvent = (code: IdeaBoxErrorCode): IdeaBoxEvent => ({ type: "error", code, message: IDEA_BOX_ERRORS[code] });

async function* once(...events: IdeaBoxEvent[]): AsyncGenerator<IdeaBoxEvent, void, undefined> {
  for (const e of events) yield e;
}

/** The card as the box shows it (the stored ConceptCard, typed for the page). */
export const boxCard = (card: unknown): IdeaBoxCard => card as IdeaBoxCard;

/** A card as the `card` event, with the claim token its sign-in link carries (null when none could be issued). */
export function cardEvent(row: IdeaDraftRow, again: boolean, claim: string | null, redrawsLeft: number | null = null): IdeaBoxEvent {
  return { type: "card", card: boxCard(row.card), prompt: row.prompt, interest: row.interest, sample: row.modelMode === "mock", again, claim, redrawsLeft };
}

/** The limit-store key that counts a browser's redraws (the token's hash, never the token). */
const redrawKey = (token: string) => `idea-box:redraw:${ideaTokenHash(token)}`;

/** How many redraws this browser has left today, recording nothing; null when the store cannot say. */
async function redrawsLeftFor(limits: RateLimitStore | undefined, token: string): Promise<number | null> {
  if (!limits) return null;
  return limits.peek({ key: redrawKey(token), rule: IDEA_BOX_LIMITS.redrawsPerBrowserDay }).catch(() => null);
}

/** The browser's live card with a fresh claim token (the old one is stored only as a hash), or null. */
async function liveCardEvent(deps: Pick<IdeaBoxDeps, "db"> & { limits?: RateLimitStore }, cookieToken: string, now: Date): Promise<IdeaBoxEvent | null> {
  const hash = ideaTokenHash(cookieToken);
  const row = await repos.ideaDrafts.liveByToken(deps.db, hash, now);
  if (!row) return null;
  const claim = newIdeaToken();
  const rotated = await repos.ideaDrafts.rotateClaim(deps.db, hash, ideaTokenHash(claim), now);
  return cardEvent(row, true, rotated ? claim : null, await redrawsLeftFor(deps.limits, cookieToken));
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const devStack = (appEnv: string) => appEnv === "development" || appEnv === "test";

/**
 * Decides and starts a draft. Every refusal is a stream of one `error` line (and no cookie); a browser that holds a
 * live card gets it back; otherwise a new token (the cookie) and the drafting stream.
 */
export async function planIdeaBoxDraft(deps: IdeaBoxDeps, input: IdeaBoxDraftInput, signal?: AbortSignal): Promise<IdeaBoxDraftPlan> {
  const now = deps.now?.() ?? new Date();
  const refuse = (code: IdeaBoxErrorCode): IdeaBoxDraftPlan => ({ setToken: null, events: once(errorEvent(code)) });

  const parsed = IdeaBoxDraftRequest.safeParse(input.body);
  if (!parsed.success) return refuse("invalid");
  const req = parsed.data;
  // A field no person sees: whoever filled it is a bot. The same answer as a failed bot check.
  if (req.website.trim()) return refuse("bot");

  // One card per browser: the card it already holds; or, with `again` ("Try another idea"), a new card in its place,
  // after the same checks and limits below and at most `IDEA_BOX_REDRAWS_PER_BROWSER` a day.
  let redraw: string | null = null;
  if (input.cookieToken && IdeaToken.safeParse(input.cookieToken).success) {
    if (req.again && (await repos.ideaDrafts.liveByToken(deps.db, ideaTokenHash(input.cookieToken), now))) redraw = input.cookieToken;
    else {
      const held = await liveCardEvent(deps, input.cookieToken, now);
      if (held) return { setToken: null, events: once(held) };
    }
  }

  // The bot check, through the gateway (it holds the secret).
  if (deps.gateway.verifyTurnstile) {
    const check = await deps.gateway.verifyTurnstile({ token: req.turnstile, remoteIp: input.address, hostname: input.hostname, action: IDEA_BOX_TURNSTILE_ACTION }).catch((err: unknown) => {
      // A development or test stack may run without the gateway: the mock token passes there, as the gateway's mock would.
      if (devStack(deps.env.APP_ENV) && deps.models.mode === "mock" && req.turnstile === MOCK_TURNSTILE_TOKEN) return { ok: true, reason: "ok" as const, simulated: true };
      deps.log.warn({ err: err instanceof Error ? err.message : String(err) }, "idea box: turnstile check failed");
      return { ok: false, reason: "unavailable" as const, simulated: false };
    });
    if (!check.ok) return refuse(check.reason === "unavailable" || check.reason === "unconfigured" ? "unavailable" : "bot");
  } else if (!devStack(deps.env.APP_ENV) || deps.models.mode !== "mock") {
    return refuse("unavailable");
  }

  // Per connection, and across all of them.
  const entries: LimitEntry[] = [{ key: "idea-box:all:hour", rule: IDEA_BOX_LIMITS.allHour }];
  if (input.address) {
    const key = callerLimitKey(deps.env, "idea-box", limitAddress(input.address));
    entries.push({ key: `${key}:hour`, rule: IDEA_BOX_LIMITS.perAddressHour });
    entries.push({ key: `${key}:day`, rule: IDEA_BOX_LIMITS.perAddressDay });
  }
  if (redraw) entries.push({ key: redrawKey(redraw), rule: IDEA_BOX_LIMITS.redrawsPerBrowserDay });
  const taken = await deps.limits.take(entries);
  if (!taken.ok) return refuse("limit");

  // The day's ceiling on model spend across every visitor: first what today's stored cards cost (Estimate), then one
  // card's worst case reserved atomically in the limit store, never given back once the model is called.
  const ceilingMicro = deps.env.IDEA_BOX_DAILY_CEILING_CENTS * 1_000_000;
  const spent = await repos.ideaDrafts.spentSince(deps.db, startOfUtcDay(now));
  const reserved = spent < ceilingMicro ? await deps.limits.take([{ key: "idea-box:all:cards", rule: { limit: ideaBoxDailyCards(deps.env.IDEA_BOX_DAILY_CEILING_CENTS), windowMs: DAY } }]) : null;
  if (!reserved?.ok) {
    await deps.limits.refund(taken.ticket);
    deps.log.info({ spent, ceilingMicro }, "idea box: daily ceiling reached");
    return refuse("resting");
  }

  // A redraw keeps the browser's token (the cookie is set again for the card's fresh 7 days).
  const token = redraw ?? newIdeaToken();
  return { setToken: token, events: draftStream(deps, { prompt: req.prompt.trim(), interest: req.interest, token, replace: redraw !== null }, signal) };
}

const PARTIAL_KEYS = ["name", "pitch", "archetype", "stars_current", "stars_potential"] as const;

function partialOf(snapshot: unknown): IdeaBoxPartialCard {
  const out: IdeaBoxPartialCard = {};
  if (!snapshot || typeof snapshot !== "object") return out;
  const s = snapshot as Record<string, unknown>;
  for (const k of PARTIAL_KEYS) {
    const v = s[k];
    if ((k === "stars_current" || k === "stars_potential") && typeof v === "number") out[k] = v;
    else if (k !== "stars_current" && k !== "stars_potential" && typeof v === "string" && v) out[k] = v;
  }
  return out;
}

/** The drafting stream: started, partials, ratings, then the stored card (or one error line). */
async function* draftStream(deps: IdeaBoxDeps, input: { prompt: string; interest: string | null; token: string; replace: boolean }, signal?: AbortSignal): AsyncGenerator<IdeaBoxEvent, void, undefined> {
  const queue: IdeaBoxEvent[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  // Read through a function: TypeScript would otherwise narrow `wake` to null where it is called after an await.
  const wakeUp = () => (wake as (() => void) | null)?.();
  const push = (e: IdeaBoxEvent) => {
    queue.push(e);
    wakeUp();
  };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  push({ type: "started" });
  // The deadline (WP-03 T7): past it the call is stopped and the visitor reads the `failed` line, whether or not the
  // model honors the abort. The reserved card is not given back.
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
    deps.log.warn({ deadlineMs: IDEA_BOX_DEADLINE_MS }, "idea box: draft passed its deadline");
    push(errorEvent("failed"));
    done = true;
    wakeUp();
  }, IDEA_BOX_DEADLINE_MS);
  let lastPartial = "";
  const request = buildIdeaBoxCardRequest({ words: input.prompt || null, interest: input.interest });
  const run = (async () => {
    try {
      const res = await streamStructured(deps.models, {
        ...request,
        signal: controller.signal,
        scope: "idea-box",
        attribution: { kind: "ideation" },
        elementPath: "attributes",
        elementSchema: IdeaAttribute,
        partialThrottleMs: 120,
        onPartial: (p) => {
          const partial = partialOf(p.snapshot());
          const key = JSON.stringify(partial);
          if (key !== lastPartial && Object.keys(partial).length > 0) {
            lastPartial = key;
            push({ type: "partial", card: partial });
          }
        },
        onElement: ({ index, value }) => push({ type: "rating", index, rating: value }),
      });
      // An answer after the deadline is not stored: the visitor was already told it could not be finished.
      if (timedOut) return;
      const card: ConceptCard = res.json;
      const claim = newIdeaToken();
      const fields = { claimHash: ideaTokenHash(claim), prompt: input.prompt, interest: input.interest, card, modelMode: deps.models.mode, costMicro: res.cost.costMicroMinor };
      const row = input.replace ? await repos.ideaDrafts.replace(deps.db, ideaTokenHash(input.token), fields) : await repos.ideaDrafts.create(deps.db, { tokenHash: ideaTokenHash(input.token), ...fields });
      // The card was kept (claimed) or ran out while the new one was drafted: nothing to replace.
      if (!row) {
        push(errorEvent("failed"));
        return;
      }
      deps.log.info({ mode: deps.models.mode, costMicro: res.cost.costMicroMinor, firstTextMs: res.firstTextMs ?? null }, "idea box: card drafted");
      push(cardEvent(row, false, claim, await redrawsLeftFor(deps.limits, input.token)));
    } catch (err) {
      // Nothing is given back: the call was made (and paid for) whether it finished, failed or the visitor left.
      const refused = err instanceof ModelOutputError && err.code === "refusal";
      if (!controller.signal.aborted) {
        deps.log.warn({ err: err instanceof Error ? err.message : String(err), billing: isModelBillingError(err) }, "idea box: draft failed");
        push(errorEvent(refused ? "refused" : isModelBillingError(err) ? "unavailable" : "failed"));
      }
    } finally {
      clearTimeout(deadline);
      done = true;
      wakeUp();
    }
  })();
  try {
    for (;;) {
      while (queue.length > 0) yield queue.shift()!;
      if (done) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
    // Past the deadline the call may never settle; `run` catches its own errors, so it is left behind.
    if (!timedOut) await run;
  } finally {
    // The visitor left: the model call stops; nothing is stored for a card that did not finish.
    clearTimeout(deadline);
    controller.abort();
    signal?.removeEventListener("abort", onAbort);
  }
}

/** `GET /idea-box/mine`: the browser's live card (with a fresh claim token), or null. */
export async function mineIdeaBox(deps: Pick<IdeaBoxDeps, "db" | "now"> & { limits?: RateLimitStore }, cookieToken: string | null): Promise<IdeaBoxEvent | null> {
  if (!cookieToken || !IdeaToken.safeParse(cookieToken).success) return null;
  return liveCardEvent(deps, cookieToken, deps.now?.() ?? new Date());
}

/** Where the card to keep was found: this browser's cookie, the sign-in link's claim token, or the person's waitlist entry. */
export type IdeaBoxSource = "browser" | "link" | "waitlist";

export interface IdeaBoxKeepInput {
  token?: string | null;
  /** The sign-in link's claim token; the caller passes it only right after a sign-in. */
  claim?: string | null;
}

/** The draft to keep for `userId`, in order: the cookie's, the link's, the one their waitlist entry holds. */
async function findKeepable(db: IdeaBoxDeps["db"], userId: string, input: IdeaBoxKeepInput, now: Date): Promise<{ row: IdeaDraftRow; by: "token" | "claim" | "id"; hash: string; source: IdeaBoxSource; then?: "studio" | null } | null> {
  if (input.token && IdeaToken.safeParse(input.token).success) {
    const hash = ideaTokenHash(input.token);
    const row = await repos.ideaDrafts.liveByToken(db, hash, now);
    if (row) return { row, by: "token", hash, source: "browser" };
  }
  if (input.claim && IdeaToken.safeParse(input.claim).success) {
    const hash = ideaTokenHash(input.claim);
    const row = await repos.ideaDrafts.liveByClaim(db, hash, now);
    if (row) return { row, by: "claim", hash, source: "link" };
  }
  const entry = await repos.waitlist.get(db, userId);
  if (entry?.ideaDraftId) {
    const row = await repos.ideaDrafts.liveById(db, entry.ideaDraftId, now);
    if (row) return { row, by: "id", hash: row.id, source: "waitlist", then: entry.cardThen ?? null };
  }
  return null;
}

/**
 * What /new/card/keep shows before anything is claimed (security review 2026-11-13, P2-1 and P3-3): the card, the
 * visitor's words, and where it was found. Claiming is a separate press of "Keep this card". `then`: where the card goes
 * once kept, as the person chose before they met the waitlist (0124; the waitlist's card only, a browser's or a link's
 * carries its choice in the address).
 */
export async function previewIdeaBoxDraft(db: IdeaBoxDeps["db"], userId: string, input: IdeaBoxKeepInput, now = new Date()): Promise<{ card: IdeaBoxCard; prompt: string; interest: string | null; sample: boolean; source: IdeaBoxSource; then: "studio" | null } | null> {
  const found = await findKeepable(db, userId, input, now);
  return found ? { card: boxCard(found.row.card), prompt: found.row.prompt, interest: found.row.interest, sample: found.row.modelMode === "mock", source: found.source, then: found.then ?? null } : null;
}

/**
 * Claims the card into `userId`'s deck after they pressed "Keep this card": the cookie's, the link's or the waitlist's.
 * The idea keeps the visitor's own words as its brief (the person saw them and chose to keep the card), and says when a
 * mock wrote it.
 */
export async function claimIdeaBoxDraft(db: IdeaBoxDeps["db"], userId: string, input: IdeaBoxKeepInput, now = new Date()): Promise<{ ideaId: string; again: boolean } | null> {
  const found = await findKeepable(db, userId, input, now);
  // Already kept from this browser (a second tab, a reload): the same idea.
  if (!found) {
    if (input.token && IdeaToken.safeParse(input.token).success) {
      const res = await repos.ideaDrafts.claim(db, { userId, hash: ideaTokenHash(input.token), by: "token", now, toIdea: () => ({ title: "-" }) });
      if (res.status === "claimed" && res.again) return { ideaId: res.ideaId, again: true };
    }
    return null;
  }
  const res = await repos.ideaDrafts.claim(db, {
    userId,
    hash: found.hash,
    by: found.by,
    now,
    toIdea: (row) => ideaFromCard(row.card as ConceptCard, { ...(row.prompt ? { brief: row.prompt } : {}), idea_box: true, ...(row.modelMode === "mock" ? { sample: true } : {}) }),
  });
  return res.status === "claimed" ? { ideaId: res.ideaId, again: res.again } : null;
}

/**
 * The sweep runs at boot and every hour: drafts past their expiry and any hold are deleted (7 days, 90 when held). It
 * runs on the api's own connection (`deps.db`, never a request's gated view), in batches of `IDEA_DRAFT_SWEEP_BATCH`
 * (one statement each, no transaction held across a wait), at most `IDEA_BOX_SWEEP_MAX_BATCHES` a run, and `stop()`
 * ends it before the next batch and waits for the one in flight.
 */
export const IDEA_BOX_SWEEP_MS = HOUR;
export const IDEA_BOX_SWEEP_MAX_BATCHES = 25;

export function startIdeaBoxSweep(deps: Pick<IdeaBoxDeps, "db" | "log">, everyMs = IDEA_BOX_SWEEP_MS): { stop(): Promise<void> } {
  let stopped = false;
  let running: Promise<void> | null = null;
  const run = async () => {
    let deleted = 0;
    try {
      for (let i = 0; i < IDEA_BOX_SWEEP_MAX_BATCHES && !stopped; i++) {
        const n = await repos.ideaDrafts.sweep(deps.db);
        deleted += n;
        if (n < IDEA_DRAFT_SWEEP_BATCH) break;
      }
      if (deleted > 0) deps.log.info({ deleted }, "idea box: expired cards deleted");
    } catch (err) {
      deps.log.warn({ err: err instanceof Error ? err.message : String(err), deleted }, "idea box: sweep failed (tried again next hour)");
    }
  };
  const tick = () => {
    if (stopped || running) return;
    running = run().finally(() => {
      running = null;
    });
  };
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
