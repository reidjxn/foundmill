/**
 * The one composer call ingest makes (docs/ARCHITECTURE.md §11): `POST /v1/narrate { businessId, eventIds }` for a
 * `customer.converted` that plays a full Customer Update, so the red/gold `customer_won` item lands within seconds of the
 * payment (AC-11.4.1). The composer is on the private network (COMPOSER_URL); a transport failure or a non-2xx answer is
 * a `ComposerUnavailableError`, which the follow-up logs and leaves to journeyBuild's fallback.
 */
import { AppError } from "@foundmill/shared";

export interface ComposerNarrator {
  narrate(input: { businessId: string; eventIds: string[] }): Promise<{ inboxItemId: string | null }>;
}

export class ComposerUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super("composer_unavailable", message, 503, details);
    this.name = "ComposerUnavailableError";
  }
}

export interface ComposerNarratorOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** The composer writes the note with one model call (and one re-ask); 20 s covers a slow answer. */
  timeoutMs?: number;
}

export function createComposerNarrator(options: ComposerNarratorOptions): ComposerNarrator {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  return {
    async narrate(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/v1/narrate`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(input), signal: controller.signal });
      } catch (e) {
        throw new ComposerUnavailableError(`Composer /v1/narrate unreachable: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
      const text = await res.text();
      if (!res.ok) throw new ComposerUnavailableError(`Composer /v1/narrate returned ${res.status}`, text.slice(0, 300));
      try {
        const body = (text ? JSON.parse(text) : {}) as { inboxItemId?: unknown };
        return { inboxItemId: typeof body.inboxItemId === "string" ? body.inboxItemId : null };
      } catch {
        throw new ComposerUnavailableError("Composer /v1/narrate returned non-JSON", text.slice(0, 300));
      }
    },
  };
}
