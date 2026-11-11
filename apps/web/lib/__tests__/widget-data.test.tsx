import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { WidgetDataProvider, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { createWidgetSource, isAccountRead, readInput } from "../widget-data";
import { createApiClient, trpcQueryKey, type AppRouter, type UntypedApiClient } from "../trpc";

function fakeClient() {
  const query = vi.fn(async (path: string, input: unknown) => ({ path, input, items: [1, 2] }));
  const mutation = vi.fn(async (path: string, input: unknown) => ({ ok: true, path, input }));
  return { client: { query, mutation } as unknown as UntypedApiClient, query, mutation };
}

describe("WidgetDataSource over tRPC", () => {
  it("queries by dotted path with businessId merged and caches under the tRPC query key", async () => {
    const { client, query } = fakeClient();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const source = createWidgetSource({ businessId: "b1", glossary: { customer: "client" }, gameMode: "personal", currency: "EUR", client, queryClient, navigate: vi.fn(), subscribe: () => () => {} });
    function Widget() {
      const q = useWidgetQuery<{ items: number[] }>("inbox.list", { limit: 2 });
      return <span data-testid="out">{q.isLoading ? "loading" : String(q.data?.items.length)}</span>;
    }
    render(
      <WidgetDataProvider source={source}>
        <Widget />
      </WidgetDataProvider>,
    );
    expect(screen.getByTestId("out").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("2"));
    expect(query).toHaveBeenCalledWith("inbox.list", { businessId: "b1", limit: 2 });
    expect(queryClient.getQueryData([["inbox", "list"], { input: { businessId: "b1", limit: 2 }, type: "query" }])).toBeTruthy();
  });

  it("mutates and invalidates the related routers; exposes glossary, navigate and subscribe", async () => {
    const { client, mutation } = fakeClient();
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const navigate = vi.fn();
    const unsub = vi.fn();
    const subscribe = vi.fn(() => unsub);
    const source = createWidgetSource({ businessId: "b1", glossary: { customer: "client" }, gameMode: "live", currency: "GBP", client, queryClient, navigate, subscribe });
    const result = await source.mutate("inbox.decide", { itemId: "i" });
    expect(result).toMatchObject({ ok: true });
    expect(mutation).toHaveBeenCalledWith("inbox.decide", { businessId: "b1", itemId: "i" });
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toEqual(expect.arrayContaining([JSON.stringify([["inbox"]]), JSON.stringify([["plan"]])]));
    function Probe() {
      const d = useWidgetData();
      return <span data-testid="g">{`${d.glossary.customer}|${d.gameMode}|${d.currency}`}</span>;
    }
    render(
      <WidgetDataProvider source={source}>
        <Probe />
      </WidgetDataProvider>,
    );
    expect(screen.getByTestId("g").textContent).toBe("client|live|GBP");
    source.navigate("/b/b1/inbox");
    expect(navigate).toHaveBeenCalledWith("/b/b1/inbox");
    const off = source.subscribe("ev:b1", () => {});
    expect(subscribe).toHaveBeenCalled();
    act(() => off());
    expect(unsub).toHaveBeenCalled();
  });

  it("hands the widgets the business time zone, so their today is the business's day (audit #196)", () => {
    const { client } = fakeClient();
    const queryClient = new QueryClient();
    const base = { businessId: "b1", glossary: {}, gameMode: "personal", currency: "USD", client, queryClient, navigate: vi.fn(), subscribe: () => () => {} } as const;
    expect(createWidgetSource({ ...base, timeZone: "Asia/Tokyo" }).timeZone).toBe("Asia/Tokyo");
    expect(createWidgetSource(base).timeZone).toBeNull();
  });

  it("passes a tile's focus through to the stream (RES-12)", () => {
    const subscribe = vi.fn((_ch: string, _h: (e: unknown) => void, _o?: { focused?: boolean }) => () => {});
    const setFocus = vi.fn();
    const { client } = fakeClient();
    const source = createWidgetSource({ businessId: "b1", glossary: {}, gameMode: "personal", currency: "USD", client, queryClient: new QueryClient(), navigate: vi.fn(), subscribe, setFocus });
    const handler = () => {};
    source.subscribe("as:s1", handler, { focused: false });
    expect(subscribe).toHaveBeenCalledWith("as:s1", handler, { focused: false });
    source.setFocus?.("as:s1", true);
    expect(setFocus).toHaveBeenCalledWith("as:s1", true);
  });

  it("reads account-level procedures without a businessId, under the shell's own key (audit WEB-9)", async () => {
    const { client, query } = fakeClient();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const source = createWidgetSource({ businessId: "b1", glossary: {}, gameMode: "personal", currency: "USD", client, queryClient, navigate: vi.fn(), subscribe: () => () => {} });
    function Widget() {
      const profile = useWidgetQuery<{ path: string }>("founder.profile.get", undefined);
      const views = useWidgetQuery<{ path: string }>("founder.tableViews.get", { tableKey: "crm.list" });
      return <span data-testid="out">{profile.data && views.data ? "ready" : "loading"}</span>;
    }
    render(
      <WidgetDataProvider source={source}>
        <Widget />
      </WidgetDataProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("ready"));
    expect(query).toHaveBeenCalledWith("founder.profile.get", undefined);
    // A business read that lives in an account router still gets its business.
    expect(query).toHaveBeenCalledWith("founder.tableViews.get", { businessId: "b1", tableKey: "crm.list" });
    // The key the shell's typed hook uses (BusinessShell: trpc.founder.profile.get.queryOptions()).
    const shellKey = createTRPCOptionsProxy<AppRouter>({ client: createApiClient({ getToken: () => null }), queryClient }).founder.profile.get.queryKey();
    expect(queryClient.getQueryData(shellKey)).toBeTruthy();
    expect(trpcQueryKey("founder.profile.get")).toEqual(shellKey);
  });

  it("classifies reads by whether they belong to a business", () => {
    for (const path of ["founder.profile.get", "founder.preferences.get", "live.summary", "live.people.lookup", "live.communities.list", "idea.list", "import.status", "business.listArchived", "health"]) expect(isAccountRead(path), path).toBe(true);
    for (const path of ["inbox.list", "business.get", "business.autopilot.get", "dev.tasks.list", "journey.ribbon"]) expect(isAccountRead(path), path).toBe(false);
    // Saved table views are kept per business: the read names it, as the save does.
    expect(isAccountRead("founder.tableViews.get")).toBe(false);
    expect(readInput("b1", "founder.tableViews.get", { tableKey: "crm" })).toEqual({ businessId: "b1", tableKey: "crm" });
    expect(readInput("b1", "live.communities.list", {})).toEqual({});
    expect(readInput("b1", "inbox.list", { limit: 4 })).toEqual({ businessId: "b1", limit: 4 });
  });

  it("answers a change as soon as the API has it; the stale reads refetch behind it (audit WEB-6)", async () => {
    const { client, mutation } = fakeClient();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release: (v: string) => void = () => undefined;
    let fetches = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: trpcQueryKey("inbox.list", { businessId: "b1" }) as unknown[],
      queryFn: () => {
        fetches += 1;
        return fetches === 1 ? Promise.resolve("before") : new Promise<string>((r) => (release = r));
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await waitFor(() => expect(observer.getCurrentResult().data).toBe("before"));
    const source = createWidgetSource({ businessId: "b1", glossary: {}, gameMode: "personal", currency: "USD", client, queryClient, navigate: vi.fn(), subscribe: () => () => {} });
    const pending = source.mutate<{ ok: boolean }>("inbox.decide", { itemId: "i" });
    let settled = false;
    void pending.settled.then(() => (settled = true));
    // The answer is back while the refetch it started is still on its way.
    expect(await pending).toMatchObject({ ok: true });
    expect(mutation).toHaveBeenCalledWith("inbox.decide", { businessId: "b1", itemId: "i" });
    await waitFor(() => expect(fetches).toBe(2));
    expect(settled).toBe(false);
    expect(observer.getCurrentResult().data).toBe("before");
    // `settled` waits for the refetch, for a caller that must read the fresh data.
    release("after");
    await pending.settled;
    expect(observer.getCurrentResult().data).toBe("after");
    unsubscribe();
  });

  it("rejects a refused change and refetches nothing; its settled still resolves", async () => {
    const { client, mutation } = fakeClient();
    mutation.mockRejectedValueOnce(new Error("refused"));
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const source = createWidgetSource({ businessId: "b1", glossary: {}, gameMode: "personal", currency: "USD", client, queryClient, navigate: vi.fn(), subscribe: () => () => {} });
    const pending = source.mutate("inbox.decide", { itemId: "i" });
    await expect(pending).rejects.toThrow("refused");
    await pending.settled;
    expect(invalidate).not.toHaveBeenCalled();
  });
});

