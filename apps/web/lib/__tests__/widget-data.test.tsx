import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { WidgetDataProvider, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { createWidgetSource } from "../widget-data";
import type { UntypedApiClient } from "../trpc";

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
});
