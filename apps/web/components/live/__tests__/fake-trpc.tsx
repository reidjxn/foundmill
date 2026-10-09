/**
 * A stand-in for `useTRPC()` in the LIVE screen tests: `trpc.live.connections.list.queryOptions(input, opts)` becomes a
 * TanStack query whose function calls `handlers["live.connections.list"](input)`, and `.mutationOptions(opts)` a mutation
 * calling the same table, so a screen runs against canned answers and every call is recorded in `calls`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";

export interface FakeApi {
  handlers: Record<string, (input: unknown) => unknown>;
  calls: { path: string; input: unknown }[];
}

export function makeApi(): FakeApi {
  return { handlers: {}, calls: [] };
}

export function callsTo(api: FakeApi, path: string): unknown[] {
  return api.calls.filter((c) => c.path === path).map((c) => c.input);
}

export function fakeTrpc(api: FakeApi, path: string[] = []): unknown {
  return new Proxy(() => undefined, {
    get(_target, prop: string) {
      const here = [...path, prop];
      if (prop === "queryOptions") {
        return (input: unknown, opts: Record<string, unknown> = {}) => {
          const name = path.join(".");
          return { queryKey: [path, { input, type: "query" }], queryFn: async () => (api.calls.push({ path: name, input }), api.handlers[name]?.(input)), ...opts, refetchInterval: false };
        };
      }
      if (prop === "mutationOptions") {
        return (opts: Record<string, unknown> = {}) => {
          const name = path.join(".");
          return { mutationKey: [path], mutationFn: async (vars: unknown) => (api.calls.push({ path: name, input: vars }), api.handlers[name]?.(vars)), ...opts };
        };
      }
      return fakeTrpc(api, here);
    },
  });
}

export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider>{ui}</ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

export const ids = {
  me: "00000000-0000-4000-8000-0000000000aa",
  ana: "00000000-0000-4000-8000-0000000000a1",
  ben: "00000000-0000-4000-8000-0000000000b2",
  cal: "00000000-0000-4000-8000-0000000000c3",
  business: "00000000-0000-4000-8000-0000000000b1",
  community: "00000000-0000-4000-8000-0000000000c0",
  board: "00000000-0000-4000-8000-0000000000d0",
};
