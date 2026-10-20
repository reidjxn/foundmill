/**
 * A fake `WidgetDataSource` for the product screen tests (the widgets package's own fake lives in a .tsx file that its
 * `./*` export map does not reach, so this is a small local equivalent with the same semantics).
 */
import { useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { render } from "@testing-library/react";
import { GuidanceProvider, type GuidanceMode } from "@foundmill/dugout";
import { TERMS } from "@foundmill/shared/terms";
import { WidgetDataProvider, type QueryOptions, type QueryState, type WidgetDataSource } from "@foundmill/widgets";
import { ModuleEnvProvider, type ModuleEnv } from "../../env";

/**
 * The guided layer in tests: off by default, so a screen renders the operator's view (the general saved view, plain
 * words, no explainer) the assertions were written against; "on" renders it as a first-timer sees it, with the
 * definitions map, so Terms are buttons and the Simple view opens first.
 */
export interface RenderOptions {
  guidance?: GuidanceMode;
}

export function guidanceValue(guidance: GuidanceMode = "off") {
  return guidance === "on" ? { guidance, terms: TERMS } : { guidance };
}

export const LOADING = Symbol("loading");
export type FakeResponse = unknown | ((input: Record<string, unknown> | undefined) => unknown) | Error | typeof LOADING;

export interface FakeSource {
  source: WidgetDataSource;
  setResponse(path: string, value: FakeResponse): void;
  emit(event: unknown, channel?: string): void;
  navigations: string[];
  mutations: { path: string; input: Record<string, unknown> }[];
  refetches: Record<string, number>;
  queried: Map<string, Record<string, unknown> | undefined>;
  /** The latest `refetchIntervalMs` each path was queried with (undefined: not polling). */
  intervals: Record<string, number | undefined>;
}

export function createFakeSource(opts: { businessId?: string; responses?: Record<string, FakeResponse>; missing?: "loading" | "empty"; onMutate?: (path: string, input: Record<string, unknown>) => unknown; /** A host whose event stream is connected (`useStreamOpen`); omitted: a host without one. */ streamOpen?: boolean } = {}): FakeSource {
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
  const intervals: Record<string, number | undefined> = {};

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
      const r = responses.has(path) ? responses.get(path) : opts.missing === "empty" ? undefined : LOADING;
      if (r === LOADING) state = { data: undefined, isLoading: true, error: null, refetch };
      else if (r instanceof Error) state = { data: undefined, isLoading: false, error: r, refetch };
      else state = { data: typeof r === "function" ? (r as (i: Record<string, unknown> | undefined) => unknown)(input) : r, isLoading: false, error: null, refetch };
    }
    cache.set(key, state);
    return state;
  };

  const source: WidgetDataSource = {
    businessId,
    glossary: {},
    gameMode: "personal",
    currency: "EUR",
    useQuery<T>(path: string, input: Record<string, unknown> | undefined, options?: QueryOptions): QueryState<T> {
      useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => version,
        () => version,
      );
      intervals[path] = options?.refetchIntervalMs;
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
    ...(opts.streamOpen !== undefined ? { useStreamOpen: () => opts.streamOpen! } : {}),
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
    intervals,
  };
}

/** Render a screen inside the data provider and module env. */
export function renderScreen(fake: FakeSource, ui: ReactNode, env: Partial<ModuleEnv> = {}, opts: RenderOptions = {}) {
  const el: ReactElement = (
    <GuidanceProvider value={guidanceValue(opts.guidance)}>
      <ModuleEnvProvider value={env}>
        <WidgetDataProvider source={fake.source}>{ui}</WidgetDataProvider>
      </ModuleEnvProvider>
    </GuidanceProvider>
  );
  return render(el);
}
