/**
 * Speed work in the web app that must keep behaviour: server-started queries land under the keys the browser's hooks
 * read (shell, Home, the shared ribbon and departments), the hand-over carries a pending query into the browser cache,
 * polling and freshness follow each business's event channel (and a channel back after a gap refetches its business),
 * and foundations are ensured only while there is something to do (shell links:
 * components/shell/__tests__/next-shell-link.test.tsx).
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
import { DEFAULT_STALE_MS, STREAM_KEPT_ROUTERS, STREAM_KEPT_STALE_MS, businessOfKey, getQueryClient, makeQueryClient, resyncBusiness, routerOfKey, streamAwareStaleTime } from "../query-client";
import { SHELL_INBOX_PAGE, shellQueryInputs } from "../shell-queries";
import { businessChannel } from "../stream";
import { onStreamChannel } from "../stream-client";
import { SAFETY_POLL_MS, businessLiveSince, clearChannelLiveness, isBusinessLive, isStreamOpen, setChannelLive, setStreamStatus, streamPollInterval, streamStatus } from "../stream-status";
import { createApiClient, type AppRouter } from "../trpc";
import { withBusiness } from "../widget-data";
import { trpcQueryKey } from "../trpc";

const BID = "b1e5e5e5-0000-4000-8000-000000000001";
const OTHER = "b1e5e5e5-0000-4000-8000-000000000002";

/** A browser-side options proxy, the way `useTRPC()` builds keys. */
function browserProxy() {
  return createTRPCOptionsProxy<AppRouter>({ client: createApiClient({ getToken: () => null }), queryClient: new QueryClient() });
}

afterEach(() => {
  setStreamStatus("idle");
  clearChannelLiveness();
});

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
    const shared = "5f2b8c1e-9a4d-4c3b-8e7f-1a2b3c4d5e6f";
    expect(pickDashboardId(shared, [])).toBe(shared);
    expect(pickDashboardId("z", [])).toBeUndefined();
    expect(pickDashboardId(undefined, [{ id: "a", isActive: false }, { id: "b", isActive: true }])).toBe("b");
    expect(pickDashboardId(undefined, [])).toBeUndefined();
  });
});

describe("freshness and polling follow each business's event channel (audit RES-01/02/03, RUI-09)", () => {
  it("tracks the socket, and separately which businesses' channels the server acknowledged", () => {
    setStreamStatus("open");
    expect(streamStatus()).toBe("open");
    expect(isStreamOpen()).toBe(true);
    // An open socket says nothing about a business whose channel it does not carry (yet).
    expect(isBusinessLive(BID)).toBe(false);
    setChannelLive(businessChannel(BID), true, 1_000);
    expect(isBusinessLive(BID)).toBe(true);
    expect(businessLiveSince(BID)).toBe(1_000);
    expect(isBusinessLive(OTHER)).toBe(false);
    setChannelLive(businessChannel(BID), true, 2_000); // still the same live period
    expect(businessLiveSince(BID)).toBe(1_000);
    setChannelLive(businessChannel(BID), false);
    expect(businessLiveSince(BID)).toBeNull();
    setStreamStatus("reconnecting");
    expect(isStreamOpen()).toBe(false);
  });

  it("polls every interval while the business's channel is not live, and keeps a slow safety net while it is", () => {
    expect(streamPollInterval(false, 30_000)).toBe(30_000);
    expect(streamPollInterval(true, 30_000)).toBe(SAFETY_POLL_MS);
    expect(SAFETY_POLL_MS).toBeLessThanOrEqual(60_000);
  });

  it("keeps stream-kept data fresh for minutes only while its business's channel has stayed live since the fetch", () => {
    const staleTime = streamAwareStaleTime(10_000);
    const read = (router: string, businessId: string, dataUpdatedAt: number) => ({ queryKey: [[router, "list"], { input: { businessId }, type: "query" }], state: { dataUpdatedAt } });
    expect(staleTime(read("inbox", BID, 5_000))).toBe(10_000);
    setStreamStatus("open");
    expect(staleTime(read("inbox", BID, 5_000))).toBe(10_000); // the socket alone is not enough
    setChannelLive(businessChannel(BID), true, 4_000);
    expect(staleTime(read("inbox", BID, 5_000))).toBe(STREAM_KEPT_STALE_MS);
    // Fetched before the channel went live: an event may have been missed in between.
    expect(staleTime(read("inbox", BID, 3_000))).toBe(10_000);
    // Another business whose channel this tab does not carry (it was left for this one) keeps the short default.
    expect(staleTime(read("inbox", OTHER, 5_000))).toBe(10_000);
    expect(staleTime(read("crm", BID, 5_000))).toBe(10_000);
    expect(streamAwareStaleTime()(read("crm", BID, 5_000))).toBe(DEFAULT_STALE_MS);
    // department.list carries the roster and tabs, which change without an event (a hire, a rename by another member).
    expect(staleTime(read("department", BID, 5_000))).toBe(10_000);
    setChannelLive(businessChannel(BID), false);
    expect(staleTime(read("inbox", BID, 5_000))).toBe(10_000);
    expect(routerOfKey([["finance", "overview"]])).toBe("finance");
    expect(routerOfKey(["plain"])).toBeNull();
    expect(businessOfKey(trpcQueryKey("inbox.list", { businessId: BID, limit: 50 }))).toBe(BID);
    expect(businessOfKey(trpcQueryKey("founder.profile.get"))).toBeNull();
  });

  it("a channel back after a gap refetches every query of its business, and nothing of another", async () => {
    const qc = makeQueryClient();
    const keys = {
      inbox: trpcQueryKey("inbox.list", { businessId: BID, limit: 50 }),
      live: trpcQueryKey("dev.sessions.list", { businessId: BID, openOnly: true, limit: 200 }),
      other: trpcQueryKey("inbox.list", { businessId: OTHER, limit: 50 }),
      profile: trpcQueryKey("founder.profile.get"),
    };
    for (const key of Object.values(keys)) qc.setQueryData(key as unknown[], { ok: true });
    await resyncBusiness(qc, BID);
    const invalidated = (key: readonly unknown[]) => qc.getQueryState(key as unknown[])?.isInvalidated;
    expect(invalidated(keys.inbox)).toBe(true);
    expect(invalidated(keys.live)).toBe(true); // Live sessions refresh on events too
    expect(invalidated(keys.other)).toBe(false);
    expect(invalidated(keys.profile)).toBe(false);
  });

  it("the tab's stream client records liveness and resyncs only a channel that comes back", () => {
    const qc = getQueryClient();
    const key = trpcQueryKey("cycle.status", { businessId: BID }) as unknown[];
    qc.setQueryData(key, { running: true });
    onStreamChannel(businessChannel(BID), true, { resync: false }); // first time: what the page loaded is current
    expect(isBusinessLive(BID)).toBe(true);
    expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
    onStreamChannel(businessChannel(BID), false, { resync: false });
    expect(isBusinessLive(BID)).toBe(false);
    onStreamChannel(businessChannel(BID), true, { resync: true }); // a missed cycle.completed is fetched, not waited for
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    qc.removeQueries({ queryKey: key });
  });

  it("a tab that becomes visible again refetches the business's stale reads, not account-level ones", () => {
    const focus = makeQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus as (q: { queryKey: readonly unknown[] }) => boolean;
    expect(focus({ queryKey: trpcQueryKey("inbox.list", { businessId: BID }) })).toBe(true);
    expect(focus({ queryKey: trpcQueryKey("idea.list") })).toBe(false);
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
