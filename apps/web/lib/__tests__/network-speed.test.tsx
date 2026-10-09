/**
 * Speed work in the web app that must keep behaviour: server-started queries land under the keys the browser's hooks
 * read (shell, Home, the shared ribbon and departments), the hand-over carries a pending query into the browser cache,
 * polling and freshness follow the event stream, and foundations are ensured only while there is something to do
 * (shell links: components/shell/__tests__/next-shell-link.test.tsx).
 */
import { QueryClient, dehydrate, hashKey, hydrate } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { act } from "@testing-library/react";
import superjson from "superjson";
import { afterEach, describe, expect, it } from "vitest";
import { SHELL_DEPARTMENTS_INPUT } from "@foundmill/widgets/shared/departments";
import { recentRibbonInput } from "@foundmill/widgets/shared/ribbon";
import { INVALIDATE_ON_EVENT, foundationsNeedEnsure } from "@/components/shell/BusinessShell";
import { pickDashboardId } from "@/components/home/pick-dashboard";
import { createServerPrefetch, shouldHandOver } from "../hydrate.server";
import { DEFAULT_STALE_MS, STREAM_KEPT_ROUTERS, STREAM_KEPT_STALE_MS, makeQueryClient, routerOfKey, streamAwareStaleTime } from "../query-client";
import { SHELL_INBOX_PAGE, shellQueryInputs } from "../shell-queries";
import { isStreamOpen, pollUnlessStreaming, setStreamStatus, streamStatus } from "../stream-status";
import { createApiClient, type AppRouter } from "../trpc";
import { withBusiness } from "../widget-data";
import { trpcQueryKey } from "../trpc";

const BID = "b1e5e5e5-0000-4000-8000-000000000001";

/** A browser-side options proxy, the way `useTRPC()` builds keys. */
function browserProxy() {
  return createTRPCOptionsProxy<AppRouter>({ client: createApiClient({ getToken: () => null }), queryClient: new QueryClient() });
}

afterEach(() => setStreamStatus("idle"));

describe("server-started queries use the browser's keys", () => {
  it("shell, Home and the shared queries hash the same on the server, in the typed hooks and in the widget source", () => {
    const server = createServerPrefetch(createApiClient({ getToken: () => "t", url: "http://api.test/trpc" })).trpc;
    const browser = browserProxy();
    const inputs = shellQueryInputs(BID);
    expect(inputs.inbox).toEqual({ businessId: BID, limit: SHELL_INBOX_PAGE });
    const same = (a: readonly unknown[], b: readonly unknown[]) => expect(hashKey(a as unknown[])).toBe(hashKey(b as unknown[]));
    same(server.inbox.list.queryKey(inputs.inbox), browser.inbox.list.queryKey({ businessId: BID, limit: 50 }));
    same(server.finance.overview.queryKey(inputs.finance), browser.finance.overview.queryKey({ businessId: BID }));
    same(server.cycle.status.queryKey(inputs.cycle), browser.cycle.status.queryKey({ businessId: BID }));
    same(server.dashboard.list.queryKey({ businessId: BID }), trpcQueryKey("dashboard.list", { businessId: BID }));
    same(server.dashboard.get.queryKey({ businessId: BID, dashboardId: "d1" }), browser.dashboard.get.queryKey({ businessId: BID, dashboardId: "d1" }));
    // Widgets (dotted paths, businessId merged first) and the shell share department.list…
    same(trpcQueryKey("department.list", withBusiness(BID, SHELL_DEPARTMENTS_INPUT)), browser.department.list.queryKey(inputs.departments));
    // …and Home's day-one check shares the cards' recent ribbon.
    same(trpcQueryKey("journey.ribbon", withBusiness(BID, recentRibbonInput())), browser.journey.ribbon.queryKey({ businessId: BID, ...recentRibbonInput() }));
  });

  it("hands a still-pending server query to the browser cache, which resolves it without fetching again", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const fetchStub: typeof fetch = async () => {
      calls += 1;
      await gate;
      const body = [{ result: { data: superjson.serialize({ ok: true, at: new Date("2026-10-09T10:00:00Z") }) } }];
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    };
    const { queryClient, trpc } = createServerPrefetch(createApiClient({ getToken: () => "t", url: "http://api.test/trpc", fetch: fetchStub }));
    void queryClient.prefetchQuery(trpc.cycle.status.queryOptions({ businessId: BID }));
    const state = dehydrate(queryClient, { shouldDehydrateQuery: shouldHandOver });
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]!.state.status).toBe("pending");

    const browser = makeQueryClient();
    hydrate(browser, state);
    const key = browserProxy().cycle.status.queryKey({ businessId: BID });
    const query = browser.getQueryCache().find({ queryKey: key, exact: true });
    expect(query?.state.fetchStatus).toBe("fetching");
    release();
    await act(async () => {
      await query!.promise;
    });
    expect(browser.getQueryData(key)).toEqual({ ok: true, at: new Date("2026-10-09T10:00:00Z") });
    expect(calls).toBe(1);
  });

  it("picks the dashboard on the server the way Home does", () => {
    expect(pickDashboardId("z", [])).toBe("z");
    expect(pickDashboardId(undefined, [{ id: "a", isActive: false }, { id: "b", isActive: true }])).toBe("b");
    expect(pickDashboardId(undefined, [])).toBeUndefined();
  });
});

describe("freshness and polling follow the event stream", () => {
  it("tracks the stream status", () => {
    setStreamStatus("open");
    expect(streamStatus()).toBe("open");
    expect(isStreamOpen()).toBe(true);
    setStreamStatus("reconnecting");
    expect(isStreamOpen()).toBe(false);
  });

  it("polls only while the stream is down", () => {
    expect(pollUnlessStreaming(false, 30_000)).toBe(30_000);
    expect(pollUnlessStreaming(true, 30_000)).toBe(false);
  });

  it("keeps stream-kept routers fresh for minutes while connected, and falls back otherwise", () => {
    const staleTime = streamAwareStaleTime(10_000);
    const inbox = { queryKey: [["inbox", "list"], { input: { businessId: BID }, type: "query" }] };
    const crm = { queryKey: [["crm", "search"], { input: { businessId: BID }, type: "query" }] };
    expect(staleTime(inbox)).toBe(10_000);
    setStreamStatus("open");
    expect(staleTime(inbox)).toBe(STREAM_KEPT_STALE_MS);
    expect(staleTime(crm)).toBe(10_000);
    expect(streamAwareStaleTime()(crm)).toBe(DEFAULT_STALE_MS);
    expect(routerOfKey([["finance", "overview"]])).toBe("finance");
    expect(routerOfKey(["plain"])).toBeNull();
  });

  it("only routers the shell invalidates on events are treated as stream-kept", () => {
    const invalidated = new Set(Object.values(INVALIDATE_ON_EVENT).flat());
    for (const router of STREAM_KEPT_ROUTERS) expect(invalidated.has(router), router).toBe(true);
  });
});

describe("foundations are ensured only while there is work", () => {
  it("calls ensure for pending and drafting (and an older API without the status), not for ready, failed or none", () => {
    expect(foundationsNeedEnsure("pending")).toBe(true);
    expect(foundationsNeedEnsure("drafting")).toBe(true);
    expect(foundationsNeedEnsure(undefined)).toBe(true);
    for (const s of ["ready", "failed", "none"]) expect(foundationsNeedEnsure(s)).toBe(false);
  });
});
