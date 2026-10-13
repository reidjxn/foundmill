"use client";
/**
 * A fake `WidgetDataSource` for tests and stories (import from "@foundmill/widgets/testing").
 *
 * Responses are keyed by procedure path: a value, a function of the input, an `Error`, or the `LOADING` sentinel.
 * `setResponse` re-renders every mounted widget; `emit` delivers a realtime frame to `ev:<businessId>` subscribers;
 * navigations and mutations are recorded for assertions.
 */
import { useSyncExternalStore } from "react";
import type { GameMode } from "@foundmill/shared";
import type { QueryOptions, QueryState, WidgetDataSource } from "./data";

export const LOADING = Symbol("loading");
export type FakeResponse = unknown | ((input: Record<string, unknown> | undefined) => unknown) | Error | typeof LOADING;

export interface FakeSourceOptions {
  businessId?: string;
  responses?: Record<string, FakeResponse>;
  gameMode?: GameMode;
  currency?: string;
  glossary?: Record<string, string>;
  /** The business time zone (default unset: UTC). */
  timeZone?: string | null;
  /** Default for paths with no response: LOADING (never resolves) or undefined data (not loading). */
  missing?: "loading" | "empty";
  /** Handler for `mutate`; defaults to resolving `{}` (recorded either way). */
  onMutate?: (path: string, input: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface FakeSource {
  source: WidgetDataSource;
  setResponse(path: string, value: FakeResponse): void;
  /** Deliver a frame to subscribers of `channel` (default the business event channel). */
  emit(event: unknown, channel?: string): void;
  navigations: string[];
  mutations: { path: string; input: Record<string, unknown> }[];
  /** Number of refetch() calls per path. */
  refetches: Record<string, number>;
  /** Paths queried at least once, with the latest input. */
  queried: Map<string, Record<string, unknown> | undefined>;
  subscriberCount(channel?: string): number;
}

export function createFakeSource(opts: FakeSourceOptions = {}): FakeSource {
  const businessId = opts.businessId ?? "00000000-0000-4000-8000-000000000001";
  const responses = new Map<string, FakeResponse>(Object.entries(opts.responses ?? {}));
  const listeners = new Set<() => void>();
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const cache = new Map<string, QueryState<unknown>>();
  let version = 0;
  const bump = () => {
    version += 1;
    cache.clear();
    for (const l of listeners) l();
  };
  const navigations: string[] = [];
  const mutations: { path: string; input: Record<string, unknown> }[] = [];
  const refetches: Record<string, number> = {};
  const queried = new Map<string, Record<string, unknown> | undefined>();

  const compute = (path: string, input: Record<string, unknown> | undefined, options?: QueryOptions): QueryState<unknown> => {
    const key = `${path}|${JSON.stringify(input ?? null)}|${options?.enabled === false ? "off" : "on"}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const refetch = () => {
      refetches[path] = (refetches[path] ?? 0) + 1;
      bump();
    };
    let state: QueryState<unknown>;
    if (options?.enabled === false) state = { data: undefined, isLoading: false, error: null, refetch };
    else {
      queried.set(path, input);
      const raw = responses.has(path) ? responses.get(path) : opts.missing === "empty" ? undefined : LOADING;
      // A function of the input may answer one input with data and another with an Error (or LOADING).
      const r = typeof raw === "function" ? (raw as (i: Record<string, unknown> | undefined) => unknown)(input) : raw;
      if (r === LOADING) state = { data: undefined, isLoading: true, error: null, refetch };
      else if (r instanceof Error) state = { data: undefined, isLoading: false, error: r, refetch };
      else state = { data: r, isLoading: false, error: null, refetch };
    }
    cache.set(key, state);
    return state;
  };

  const source: WidgetDataSource = {
    businessId,
    glossary: opts.glossary ?? {},
    gameMode: opts.gameMode ?? "personal",
    currency: opts.currency ?? "EUR",
    timeZone: opts.timeZone ?? null,
    useQuery<T>(path: string, input: Record<string, unknown> | undefined, options?: QueryOptions): QueryState<T> {
      useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => version,
        () => version,
      );
      return compute(path, input, options) as QueryState<T>;
    },
    async mutate<T>(path: string, input: Record<string, unknown>): Promise<T> {
      mutations.push({ path, input });
      const r = opts.onMutate ? await opts.onMutate(path, input) : {};
      return r as T;
    },
    navigate(href) {
      navigations.push(href);
    },
    subscribe(channel, handler) {
      const set = handlers.get(channel) ?? new Set();
      set.add(handler);
      handlers.set(channel, set);
      return () => {
        set.delete(handler);
      };
    },
  };

  return {
    source,
    setResponse(path, value) {
      responses.set(path, value);
      bump();
    },
    emit(event, channel = `ev:${businessId}`) {
      for (const h of handlers.get(channel) ?? []) h(event);
    },
    navigations,
    mutations,
    refetches,
    queried,
    subscriberCount(channel = `ev:${businessId}`) {
      return handlers.get(channel)?.size ?? 0;
    },
  };
}
