/**
 * HTTP client for apps/composer (docs/ARCHITECTURE.md §11): `POST /v1/narrate { businessId, eventIds }` → one inbox
 * item; `POST /v1/commentary { journeyId }`; `POST /v1/chapter-title`. Transport failures surface as
 * `ComposerUnavailableError` so activities can fall back (a plain summary item) instead of failing a cycle; a request
 * the composer refused (`ComposerRejectedError`, a 4xx) is never worth retrying.
 */
import { AppError } from "@foundmill/shared";

export interface NarrateRequest {
  businessId: string;
  eventIds: string[];
}

export interface NarrateResponse {
  /** The inbox_items row id the composer wrote (null when it chose not to narrate). */
  inboxItemId: string | null;
  item?: unknown;
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
}

export class ComposerUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super("composer_unavailable", message, 503, details);
    this.name = "ComposerUnavailableError";
  }
}

/**
 * The composer answered and refused the request (a 4xx that is not about timing: invalid body, unknown business). Sending
 * it again cannot succeed, so callers fall back at once instead of retrying. Still a `ComposerUnavailableError` for
 * callers that only need to know the composer did not narrate.
 */
export class ComposerRejectedError extends ComposerUnavailableError {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number, details?: unknown) {
    super(message, details);
    this.name = "ComposerRejectedError";
    this.httpStatus = httpStatus;
  }
}

/** A 4xx a later attempt may still pass (timeout, conflict, too early, rate limit) is not a refusal. */
const RETRYABLE_4XX = new Set([408, 409, 425, 429]);

export interface ComposerClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createComposerClient(options: ComposerClientOptions): ComposerClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

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
    // A refusal is a refusal whatever its body says (a proxy's HTML 404 included): sending it again cannot pass.
    if (res.status >= 400 && res.status < 500 && !RETRYABLE_4XX.has(res.status)) throw new ComposerRejectedError(`Composer ${path} returned ${res.status}`, res.status, parsed ? json : text.slice(0, 300));
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
      return { inboxItemId: id, item };
    },
    async commentary(input) {
      const out = await post<Record<string, unknown>>("/v1/commentary", input);
      return { headline: typeof out.headline === "string" ? out.headline : undefined, lines: Array.isArray(out.lines) ? out.lines : [] };
    },
    async chapterTitle(input) {
      const out = await post<Record<string, unknown>>("/v1/chapter-title", input);
      return { title: typeof out.title === "string" ? out.title : "" };
    },
  };
}

/** A composer that is never there (tests / no COMPOSER_URL): every call throws ComposerUnavailableError. */
export function createOfflineComposerClient(): ComposerClient {
  const unavailable = () => Promise.reject(new ComposerUnavailableError("Composer is not configured"));
  return { baseUrl: "http://composer.offline", narrate: unavailable, commentary: unavailable, chapterTitle: unavailable };
}
