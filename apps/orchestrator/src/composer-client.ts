/**
 * HTTP client for apps/composer (docs/ARCHITECTURE.md §11): `POST /v1/narrate { businessId, eventIds }` → one inbox
 * item; `POST /v1/commentary { journeyId }`; `POST /v1/chapter-title`. Transport failures surface as
 * `ComposerUnavailableError` so activities can fall back (a plain summary item) instead of failing a cycle.
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
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new ComposerUnavailableError(`Composer ${path} returned non-JSON (${res.status})`, text.slice(0, 300));
    }
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
