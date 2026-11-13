/**
 * The landing page's idea box (founder, 2026-11-13; docs/IDEA_BOX.md): one rated card for a visitor who has not signed
 * up, kept by a token in their browser's cookie (and a claim token their sign-in link carries) until they sign in and
 * claim it into their deck.
 *
 * A draft, in order, before any model call: the request's shape and the honeypot; the browser's live card (one per
 * browser: it gets that card back, nothing is drafted); the bot check (Turnstile, through the gateway); the per-address
 * windows; the day's spend ceiling across every visitor ($20, `IDEA_BOX_DAILY_CEILING_CENTS`). Then the Ideation
 * agent's idea-box card on the platform key, streamed: the name and pitch as soon as they are written, then each rating.
 * The card is stored only when it is complete and valid.
 */
import { createHash, randomBytes } from "node:crypto";
import { buildIdeaBoxCardRequest } from "@foundmill/agents";
import { repos, type IdeaDraftRow } from "@foundmill/db";
import { IdeaAttribute, isModelBillingError, ModelOutputError, streamStructured, type ConceptCard, type ModelClient } from "@foundmill/models";
import { IDEA_BOX_ERRORS, IdeaBoxDraftRequest, IdeaToken, type IdeaBoxCard, type IdeaBoxErrorCode, type IdeaBoxEvent, type IdeaBoxPartialCard } from "@foundmill/shared";
import type { Env } from "@foundmill/shared";
import { ideaFromCard } from "./ideation";
import { callerLimitKey } from "./pages";
import type { ApiGatewayClient } from "./gateway";
import type { LimitEntry, LimitTicket, RateLimitStore, WindowLimit } from "./rate-limit";

const HOUR = 60 * 60_000;
/** The token the web sends without a Turnstile site key (development stacks); the gateway's mock passes it. */
export const MOCK_TURNSTILE_TOKEN = "mock-ok";
const DAY = 24 * HOUR;

/** Per connection: about five cards a day (founder, 2026-11-13), three in any hour; and a backstop across all of them. */
export const IDEA_BOX_LIMITS = {
  perAddressHour: { limit: 3, windowMs: HOUR },
  perAddressDay: { limit: 5, windowMs: DAY },
  allHour: { limit: 400, windowMs: HOUR },
} as const satisfies Record<string, WindowLimit>;

/** A new browser or claim token: 32 random bytes, base64url (43 characters). */
export const newIdeaToken = (): string => randomBytes(32).toString("base64url");
/** What the database stores for a token: its SHA-256, lowercase hex. */
export const ideaTokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

export interface IdeaBoxDeps {
  db: Parameters<typeof repos.ideaDrafts.create>[0];
  models: ModelClient;
  limits: RateLimitStore;
  env: Pick<Env, "SESSION_TOKEN_SECRET" | "APP_ENV" | "IDEA_BOX_DAILY_CEILING_CENTS">;
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
export function cardEvent(row: IdeaDraftRow, again: boolean, claim: string | null): IdeaBoxEvent {
  return { type: "card", card: boxCard(row.card), prompt: row.prompt, interest: row.interest, sample: row.modelMode === "mock", again, claim };
}

/** The browser's live card with a fresh claim token (the old one is stored only as a hash), or null. */
async function liveCardEvent(deps: Pick<IdeaBoxDeps, "db">, cookieToken: string, now: Date): Promise<IdeaBoxEvent | null> {
  const hash = ideaTokenHash(cookieToken);
  const row = await repos.ideaDrafts.liveByToken(deps.db, hash, now);
  if (!row) return null;
  const claim = newIdeaToken();
  const rotated = await repos.ideaDrafts.rotateClaim(deps.db, hash, ideaTokenHash(claim), now);
  return cardEvent(row, true, rotated ? claim : null);
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

  // One card per browser: the card it already holds.
  if (input.cookieToken && IdeaToken.safeParse(input.cookieToken).success) {
    const held = await liveCardEvent(deps, input.cookieToken, now);
    if (held) return { setToken: null, events: once(held) };
  }

  // The bot check, through the gateway (it holds the secret).
  if (deps.gateway.verifyTurnstile) {
    const check = await deps.gateway.verifyTurnstile({ token: req.turnstile, remoteIp: input.address, hostname: input.hostname }).catch((err: unknown) => {
      // A development or test stack may run without the gateway: the mock token passes there, as the gateway's mock would.
      if (devStack(deps.env.APP_ENV) && req.turnstile === MOCK_TURNSTILE_TOKEN) return { ok: true, reason: "ok" as const, simulated: true };
      deps.log.warn({ err: err instanceof Error ? err.message : String(err) }, "idea box: turnstile check failed");
      return { ok: false, reason: "unavailable" as const, simulated: false };
    });
    if (!check.ok) return refuse(check.reason === "unavailable" || check.reason === "unconfigured" ? "unavailable" : "bot");
  } else if (!devStack(deps.env.APP_ENV)) {
    return refuse("unavailable");
  }

  // Per connection, and across all of them.
  const entries: LimitEntry[] = [{ key: "idea-box:all:hour", rule: IDEA_BOX_LIMITS.allHour }];
  if (input.address) {
    entries.push({ key: `${callerLimitKey(deps.env, "idea-box", input.address)}:hour`, rule: IDEA_BOX_LIMITS.perAddressHour });
    entries.push({ key: `${callerLimitKey(deps.env, "idea-box", input.address)}:day`, rule: IDEA_BOX_LIMITS.perAddressDay });
  }
  const taken = await deps.limits.take(entries);
  if (!taken.ok) return refuse("limit");
  const ticket: LimitTicket = taken.ticket;

  // The day's ceiling on model spend across every visitor (Estimate from what today's cards cost).
  const ceilingMicro = deps.env.IDEA_BOX_DAILY_CEILING_CENTS * 1_000_000;
  const spent = await repos.ideaDrafts.spentSince(deps.db, startOfUtcDay(now));
  if (spent >= ceilingMicro) {
    await deps.limits.refund(ticket);
    deps.log.info({ spent, ceilingMicro }, "idea box: daily ceiling reached");
    return refuse("resting");
  }

  const token = newIdeaToken();
  return { setToken: token, events: draftStream(deps, { prompt: req.prompt.trim(), interest: req.interest, token, ticket }, signal) };
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
async function* draftStream(deps: IdeaBoxDeps, input: { prompt: string; interest: string | null; token: string; ticket: LimitTicket }, signal?: AbortSignal): AsyncGenerator<IdeaBoxEvent, void, undefined> {
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
      const card: ConceptCard = res.json;
      const claim = newIdeaToken();
      const row = await repos.ideaDrafts.create(deps.db, {
        tokenHash: ideaTokenHash(input.token),
        claimHash: ideaTokenHash(claim),
        prompt: input.prompt,
        interest: input.interest,
        card,
        modelMode: deps.models.mode,
        costMicro: res.cost.costMicroMinor,
      });
      deps.log.info({ mode: deps.models.mode, costMicro: res.cost.costMicroMinor, firstTextMs: res.firstTextMs ?? null }, "idea box: card drafted");
      push(cardEvent(row, false, claim));
    } catch (err) {
      const refused = err instanceof ModelOutputError && err.code === "refusal";
      if (!refused) await deps.limits.refund(input.ticket).catch(() => undefined);
      if (!controller.signal.aborted) {
        deps.log.warn({ err: err instanceof Error ? err.message : String(err), billing: isModelBillingError(err) }, "idea box: draft failed");
        push(errorEvent(refused ? "refused" : isModelBillingError(err) ? "unavailable" : "failed"));
      }
    } finally {
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
    await run;
  } finally {
    // The visitor left: the model call stops; nothing is stored for a card that did not finish.
    controller.abort();
    signal?.removeEventListener("abort", onAbort);
  }
}

/** `GET /idea-box/mine`: the browser's live card (with a fresh claim token), or null. */
export async function mineIdeaBox(deps: Pick<IdeaBoxDeps, "db" | "now">, cookieToken: string | null): Promise<IdeaBoxEvent | null> {
  if (!cookieToken || !IdeaToken.safeParse(cookieToken).success) return null;
  return liveCardEvent(deps, cookieToken, deps.now?.() ?? new Date());
}

/**
 * Claims the visitor's card into `userId`'s deck: by the browser's token (the cookie, same browser) or the claim token
 * (the sign-in link, any device). The idea keeps the visitor's own words as its brief, and says when a mock wrote it.
 */
export async function claimIdeaBoxDraft(db: IdeaBoxDeps["db"], userId: string, input: { token?: string | null; claim?: string | null }, now = new Date()): Promise<{ ideaId: string; again: boolean } | null> {
  const attempts: { hash: string; by: "token" | "claim" }[] = [];
  if (input.token && IdeaToken.safeParse(input.token).success) attempts.push({ hash: ideaTokenHash(input.token), by: "token" });
  if (input.claim && IdeaToken.safeParse(input.claim).success) attempts.push({ hash: ideaTokenHash(input.claim), by: "claim" });
  for (const a of attempts) {
    const res = await repos.ideaDrafts.claim(db, {
      userId,
      hash: a.hash,
      by: a.by,
      now,
      toIdea: (row) => ideaFromCard(row.card as ConceptCard, { ...(row.prompt ? { brief: row.prompt } : {}), idea_box: true, ...(row.modelMode === "mock" ? { sample: true } : {}) }),
    });
    if (res.status === "claimed") return { ideaId: res.ideaId, again: res.again };
  }
  return null;
}

/** The sweep runs at boot and every hour: drafts past their expiry and any hold are deleted (7 days, 90 when held). */
export const IDEA_BOX_SWEEP_MS = HOUR;

export function startIdeaBoxSweep(deps: Pick<IdeaBoxDeps, "db" | "log">, everyMs = IDEA_BOX_SWEEP_MS): { stop(): void } {
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    try {
      const deleted = await repos.ideaDrafts.sweep(deps.db);
      if (deleted > 0) deps.log.info({ deleted }, "idea box: expired cards deleted");
    } catch (err) {
      deps.log.warn({ err: err instanceof Error ? err.message : String(err) }, "idea box: sweep failed (tried again next hour)");
    }
  };
  void run();
  const timer = setInterval(() => void run(), everyMs);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
