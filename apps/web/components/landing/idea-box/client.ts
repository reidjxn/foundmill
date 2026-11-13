/**
 * The idea box's calls to the api (docs/IDEA_BOX.md), straight to its own address with credentials, so the api sees the
 * visitor's address and sets or reads the `fm_idea` cookie. `streamIdeaDraft` reads the NDJSON stream line by line;
 * `fetchMine` asks for the browser's live card.
 */
import { IDEA_BOX_ERRORS, type IdeaBoxDraftRequest, type IdeaBoxEvent } from "@foundmill/shared";

const unavailable: IdeaBoxEvent = { type: "error", code: "unavailable", message: IDEA_BOX_ERRORS.unavailable };

/** Calls `onEvent` for every line as it arrives; a broken connection ends with the "not open right now" line. */
export async function streamIdeaDraft(apiUrl: string, body: IdeaBoxDraftRequest, opts: { signal?: AbortSignal; onEvent: (e: IdeaBoxEvent) => void; fetchImpl?: typeof fetch }): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${apiUrl}/idea-box/draft`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: opts.signal });
  } catch {
    if (!opts.signal?.aborted) opts.onEvent(unavailable);
    return;
  }
  if (!res.ok || !res.body) {
    opts.onEvent(unavailable);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const event = JSON.parse(line) as IdeaBoxEvent;
        if (event.type === "card" || event.type === "error") ended = true;
        opts.onEvent(event);
      }
    }
  } catch {
    if (opts.signal?.aborted) return;
  }
  if (!ended && !opts.signal?.aborted) opts.onEvent(unavailable);
}

/** The browser's live card (with a fresh claim token), or null. */
export async function fetchMine(apiUrl: string, fetchImpl: typeof fetch = fetch): Promise<IdeaBoxEvent | null> {
  try {
    const res = await fetchImpl(`${apiUrl}/idea-box/mine`, { credentials: "include", cache: "no-store" });
    if (res.status !== 200) return null;
    const event = (await res.json()) as IdeaBoxEvent;
    return event.type === "card" ? event : null;
  } catch {
    return null;
  }
}
