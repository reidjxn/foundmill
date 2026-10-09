"use client";
/**
 * Module packs on demand (docs/ARCHITECTURE.md §18). Each pack's index registers its screens when it loads, so a host
 * that imports this file and `./registry` (instead of the "@foundmill/modules" barrel, which loads all six packs) gets
 * one bundle chunk per pack and loads only the packs it shows.
 *
 *   const ready = useModulePacks(["finance"]);       // starts the load, re-renders when the pack has registered
 *   const screen = ready ? getModuleScreen("finance", "overview") : undefined;
 *
 * A pack counts as loaded once the registry holds it, however it got there (this loader, the barrel, a test import).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ModuleKey } from "@foundmill/shared";
import { getModule } from "./registry";

const LOADERS: Record<ModuleKey, () => Promise<unknown>> = {
  product: () => import("./product"),
  development: () => import("./development"),
  distribution: () => import("./distribution"),
  finance: () => import("./finance"),
  team: () => import("./team"),
  legal: () => import("./legal"),
};

const inflight = new Map<ModuleKey, Promise<void>>();
const listeners = new Set<() => void>();

export function isModulePackLoaded(key: ModuleKey): boolean {
  return getModule(key) !== undefined;
}

/** Loads (once) and registers one module pack. A failed load can be retried by calling again. */
export function loadModulePack(key: ModuleKey): Promise<void> {
  if (isModulePackLoaded(key)) return Promise.resolve();
  const loader = LOADERS[key];
  if (!loader) return Promise.reject(new Error(`Unknown module "${String(key)}"`));
  let p = inflight.get(key);
  if (!p) {
    p = loader().then(
      () => {
        inflight.delete(key);
        for (const l of [...listeners]) l();
      },
      (err: unknown) => {
        inflight.delete(key);
        throw err;
      },
    );
    inflight.set(key, p);
  }
  return p;
}

export function loadModulePacks(keys: readonly ModuleKey[]): Promise<void> {
  return Promise.all(keys.map(loadModulePack)).then(() => undefined);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface ModulePacksState {
  /** Every requested pack has registered. Always false while server rendering and hydrating. */
  ready: boolean;
  /** The last load failed (offline, a deploy replaced the chunk); `retry` tries again. */
  error: Error | null;
  retry: () => void;
}

/**
 * Loads `keys` (registering their screens) and re-renders when they are in. Readiness follows the registry on the
 * client only, so the server render and hydration always agree (a server process may already hold every pack).
 * `preload` packs are fetched alongside but do not gate `ready` (a department's other modules, for its next tab).
 */
export function useModulePacks(keys: readonly ModuleKey[], preload: readonly ModuleKey[] = []): ModulePacksState {
  const id = keys.join(",");
  const preloadId = preload.join(",");
  const ready = useSyncExternalStore(
    subscribe,
    () => id.length === 0 || keys.every(isModulePackLoaded),
    () => id.length === 0,
  );
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    if (id) {
      loadModulePacks(id.split(",") as ModuleKey[]).catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err : new Error(String(err)));
      });
    }
    return () => {
      live = false;
    };
  }, [id, attempt]);

  useEffect(() => {
    if (preloadId) void loadModulePacks(preloadId.split(",") as ModuleKey[]).catch(() => undefined);
  }, [preloadId]);

  return { ready, error: ready ? null : error, retry: () => setAttempt((n) => n + 1) };
}
