/**
 * A screen whose code cannot load (audit RES-06): a deploy replaced the build while the tab stayed open, or the network
 * dropped the chunk request. The runtime caches the failed module load, so re-rendering (`reset`) and even a router
 * refresh (`retry`) answer with the same ChunkLoadError; only a full page load fetches the new build. The route error
 * boundaries reload the page once by themselves, and say so in product words; a second failure within
 * `CHUNK_RELOAD_WINDOW_MS` shows the panel instead of looping.
 */

/** Session key holding the time of the last automatic reload for a chunk error. */
export const CHUNK_RELOAD_KEY = "fm.chunk-reload-at";
/** A chunk error this soon after an automatic reload is not reloaded again (the new build is missing too). */
export const CHUNK_RELOAD_WINDOW_MS = 30_000;

const CHUNK_MESSAGE = /Failed to load chunk|Loading chunk [\w-]+ failed|Loading CSS chunk|ChunkLoadError|error loading dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed/i;

/** True for an error thrown because a code chunk (JavaScript or CSS) could not be loaded. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  return typeof message === "string" && CHUNK_MESSAGE.test(message);
}

interface ReloadDeps {
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  reload?: () => void;
  now?: () => number;
}

function sessionStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reload the page for a chunk error, at most once per `CHUNK_RELOAD_WINDOW_MS` (remembered in sessionStorage, so the
 * reloaded page knows). Returns true when a reload was started; false when one already ran moments ago (or storage is
 * unavailable, which could otherwise loop), and the caller shows the panel with a manual reload.
 */
export function reloadForChunkError({ storage = sessionStore(), reload = () => window.location.reload(), now = Date.now }: ReloadDeps = {}): boolean {
  if (!storage) return false;
  let last: number;
  try {
    last = Number(storage.getItem(CHUNK_RELOAD_KEY));
  } catch {
    return false;
  }
  const at = now();
  if (Number.isFinite(last) && last > 0 && at - last < CHUNK_RELOAD_WINDOW_MS) return false;
  try {
    storage.setItem(CHUNK_RELOAD_KEY, String(at));
  } catch {
    return false;
  }
  reload();
  return true;
}
