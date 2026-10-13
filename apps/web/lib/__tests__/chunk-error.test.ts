import { describe, expect, it, vi } from "vitest";
import { CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS, isChunkLoadError, reloadForChunkError } from "../chunk-error";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe("isChunkLoadError (audit RES-06: a deploy while the tab is open)", () => {
  it("recognises Turbopack's and webpack's chunk failures by name or message", () => {
    const turbopack = Object.assign(new Error("Failed to load chunk /_next/static/chunks/2dldrprwzv1ji.js from module 47731"), { name: "ChunkLoadError" });
    expect(isChunkLoadError(turbopack)).toBe(true);
    expect(isChunkLoadError(new Error("Failed to load chunk /_next/static/chunks/1xoy2k3acyr47.js from module 47731"))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 482 failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/_next/a.js"))).toBe(true);
  });

  it("leaves every other error to the normal panel", () => {
    expect(isChunkLoadError(new Error("Internal server error"))).toBe(false);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError("Failed to load chunk")).toBe(false);
  });
});

describe("reloadForChunkError", () => {
  it("reloads once and remembers when", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadForChunkError({ storage, reload, now: () => 1_000_000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.data.get(CHUNK_RELOAD_KEY)).toBe("1000000");
  });

  it("does not loop: a second chunk error right after the reload shows the panel instead", () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_KEY]: "1000000" });
    const reload = vi.fn();
    expect(reloadForChunkError({ storage, reload, now: () => 1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1 })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads again for a later deploy", () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_KEY]: "1000000" });
    const reload = vi.fn();
    expect(reloadForChunkError({ storage, reload, now: () => 1_000_000 + CHUNK_RELOAD_WINDOW_MS + 1 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads without storage to remember it (it could loop)", () => {
    const reload = vi.fn();
    expect(reloadForChunkError({ storage: null, reload })).toBe(false);
    const throwing = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => undefined };
    expect(reloadForChunkError({ storage: throwing, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
