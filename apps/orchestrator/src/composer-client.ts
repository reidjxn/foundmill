/**
 * HTTP client for apps/composer (docs/ARCHITECTURE.md §11): `POST /v1/narrate { businessId, eventIds }` → one inbox
 * item; `POST /v1/commentary { journeyId }`; `POST /v1/chapter-title`. Transport failures, timeouts and 5xx answers
 * surface as `ComposerUnavailableError` (worth retrying: narrate is idempotent per event set, so a retry returns the
 * note a slow first attempt wrote instead of writing another); a 4xx answer is the composer's verdict on the request
 * and surfaces as `ComposerRequestError`, which retrying cannot change (audit CML-05); a 4xx about timing (408, 409, 425,
 * 429) is an outage like a 5xx.
 */
import { LIMITS } from "@foundmill/config";
import { AppError } from "@foundmill/shared";

export interface NarrateRequest {
  businessId: string;
  eventIds: string[];
}

export interface NarrateResponse {
  /** The inbox_items row id the composer wrote (null when it chose not to narrate). */
  inboxItemId: string | null;
  item?: unknown;
  /** True when the composer had already narrated these events (a retried call): the earlier note, nothing new written. */
  replayed: boolean;
}

export interface CommentaryResponse {
  headline?: string;
  lines: unknown[];
}

export interface ComposerClient {
  readonly baseUrl: string;
  narrate(input: NarrateRequest): Promise<NarrateResponse>;
  commentary(input: { businessId: string; journeyId: string }): Promise<CommentaryResponse>;
  chapterTitle(input: { businessId: string; chapterId: string }): Promise<{ title: string }>;
  /** Founder titles for the business's open tasks without one (0070): how many were written. */
  founderTitles(input: { businessId: string; taskIds?: string[] }): Promise<{ written: number; skipped: number }>;
}

export class ComposerUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super("composer_unavailable", message, 503, details);
    this.name = "ComposerUnavailableError";
  }
}

/** The composer answered 4xx (validation, unknown events, no agents, links rejected after the re-ask): sending it again gets the same answer. */
export class ComposerRequestError extends AppError {
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(code, message, status, details);
    this.name = "ComposerRequestError";
  }
}

/** A 4xx a later attempt may still pass (timeout, conflict, too early, rate limit) is not a refusal. */
const RETRYABLE_4XX = new Set([408, 409, 425, 429]);

export interface ComposerClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /**
   * Longest wait for one call (default `LIMITS.composerClientTimeoutMs`): above the composer's own deadline for a note
   * (a live Opus call, a re-ask and the entity sweep), so a narration is not abandoned while it is still being written.
   */
  timeoutMs?: number;
}

export function createComposerClient(options: ComposerClientOptions): ComposerClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? LIMITS.composerClientTimeoutMs;

  async function post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) throw new ComposerUnavailableError(`Composer ${path} did not answer within ${Math.round(timeoutMs / 1000)} s`);
      throw new ComposerUnavailableError(`Composer ${path} unreachable: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown;
    let parsed = true;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      parsed = false;
    }
    // A refusal is a refusal whatever its body says (a proxy's HTML 404 included): sending it again cannot pass. A 4xx a
    // later attempt may still pass (timeout, conflict, too early, rate limit) is an outage like a 5xx.
    if (res.status >= 400 && res.status < 500 && !RETRYABLE_4XX.has(res.status)) {
      const body = (parsed && json && typeof json === "object" ? json : {}) as { error?: unknown; message?: unknown; details?: unknown };
      throw new ComposerRequestError(typeof body.error === "string" ? body.error : "composer_rejected", typeof body.message === "string" ? body.message : `Composer ${path} returned ${res.status}`, res.status, body.details ?? (parsed ? undefined : text.slice(0, 300)));
    }
    if (!parsed) throw new ComposerUnavailableError(`Composer ${path} returned non-JSON (${res.status})`, text.slice(0, 300));
    if (!res.ok) throw new ComposerUnavailableError(`Composer ${path} returned ${res.status}`, json);
    return json as T;
  }

  return {
    baseUrl,
    async narrate(input) {
      const out = await post<Record<string, unknown>>("/v1/narrate", input);
      const item = (out.item ?? out) as Record<string, unknown> | null;
      const id = typeof out.inboxItemId === "string" ? out.inboxItemId : item && typeof item.id === "string" ? item.id : null;
      return { inboxItemId: id, item, replayed: out.replayed === true };
    },
    async commentary(input) {
      const out = await post<Record<string, unknown>>("/v1/commentary", input);
      return { headline: typeof out.headline === "string" ? out.headline : undefined, lines: Array.isArray(out.lines) ? out.lines : [] };
    },
    async chapterTitle(input) {
      const out = await post<Record<string, unknown>>("/v1/chapter-title", input);
      return { title: typeof out.title === "string" ? out.title : "" };
    },
    async founderTitles(input) {
      const out = await post<Record<string, unknown>>("/v1/founder-titles", input);
      return { written: Array.isArray(out.written) ? out.written.length : 0, skipped: Array.isArray(out.skipped) ? out.skipped.length : 0 };
    },
  };
}

/** A composer that is never there (tests / no COMPOSER_URL): every call throws ComposerUnavailableError. */
export function createOfflineComposerClient(): ComposerClient {
  const unavailable = () => Promise.reject(new ComposerUnavailableError("Composer is not configured"));
  return { baseUrl: "http://composer.offline", narrate: unavailable, commentary: unavailable, chapterTitle: unavailable, founderTitles: unavailable };
}
