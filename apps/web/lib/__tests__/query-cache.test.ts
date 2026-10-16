/**
 * The browser's query cache (audit WEB-10, WEB-6): a left screen's data stays for `BROWSER_GC_MS`, so coming back
 * paints it at once; an event's refetch keeps a read already on its way (its answer paints) and asks once more after it
 * lands, so the screen still ends on the change the event announced.
 */
import { QueryObserver, type QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_GC_MS, invalidateForEvent, makeQueryClient } from "../query-client";
import { trpcQueryKey } from "../trpc";

/** A query function whose answers the test releases one by one. */
function controlled() {
  const calls: { resolve: (v: string) => void; signal: AbortSignal }[] = [];
  const fn = ({ signal }: { signal: AbortSignal }) => new Promise<string>((resolve) => calls.push({ resolve, signal }));
  return { calls, fn };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function watch(queryClient: QueryClient, queryKey: readonly unknown[], queryFn: (ctx: { signal: AbortSignal }) => Promise<string>) {
  const observer = new QueryObserver(queryClient, { queryKey: queryKey as unknown[], queryFn, staleTime: 60_000, retry: false });
  const unsubscribe = observer.subscribe(() => undefined);
  return { observer, unsubscribe };
}

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

describe("query cache in the browser", () => {
  it("keeps a left screen's data for an hour, not TanStack's 5 minutes", () => {
    expect(BROWSER_GC_MS).toBeGreaterThanOrEqual(30 * 60_000);
    expect(makeQueryClient().getDefaultOptions().queries?.gcTime).toBe(BROWSER_GC_MS);
  });
});

describe("refetch after an event", () => {
  it("lets a read already on its way land, then asks once more", async () => {
    const queryClient = makeQueryClient();
    const key = trpcQueryKey("inbox.list", { businessId: "b1" });
    const { calls, fn } = controlled();
    const { observer, unsubscribe } = watch(queryClient, key, fn);
    cleanups.push(unsubscribe);
    await flush();
    calls[0]!.resolve("first");
    await flush();
    // A change's own refetch is on its way when the change's event arrives.
    void queryClient.invalidateQueries({ queryKey: [["inbox"]] });
    await flush();
    expect(calls).toHaveLength(2);
    const done = invalidateForEvent(queryClient, ["inbox"]);
    await flush();
    // Not thrown away: the read on its way is still the only one, and its answer paints.
    expect(calls[1]!.signal.aborted).toBe(false);
    expect(calls).toHaveLength(2);
    calls[1]!.resolve("after the change");
    await flush();
    expect(observer.getCurrentResult().data).toBe("after the change");
    // Then once more, in case that read was made before the event's change was saved.
    expect(calls).toHaveLength(3);
    calls[2]!.resolve("after the event");
    await done;
    expect(observer.getCurrentResult().data).toBe("after the event");
  });

  it("refetches an idle read once, and leaves other routers alone", async () => {
    const queryClient = makeQueryClient();
    const inbox = controlled();
    const finance = controlled();
    cleanups.push(watch(queryClient, trpcQueryKey("inbox.list", { businessId: "b1" }), inbox.fn).unsubscribe);
    cleanups.push(watch(queryClient, trpcQueryKey("finance.overview", { businessId: "b1" }), finance.fn).unsubscribe);
    await flush();
    inbox.calls[0]!.resolve("a");
    finance.calls[0]!.resolve("f");
    await flush();
    const done = invalidateForEvent(queryClient, ["inbox"]);
    await flush();
    expect(inbox.calls).toHaveLength(2);
    inbox.calls[1]!.resolve("b");
    await done;
    expect(inbox.calls).toHaveLength(2);
    expect(finance.calls).toHaveLength(1);
  });

  it("refetches a procedure group named by a dotted path (business.autopilot)", async () => {
    const queryClient = makeQueryClient();
    const autopilot = controlled();
    const business = controlled();
    cleanups.push(watch(queryClient, trpcQueryKey("business.autopilot.get", { businessId: "b1" }), autopilot.fn).unsubscribe);
    cleanups.push(watch(queryClient, trpcQueryKey("business.get", { businessId: "b1" }), business.fn).unsubscribe);
    await flush();
    autopilot.calls[0]!.resolve("x");
    business.calls[0]!.resolve("y");
    await flush();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const done = invalidateForEvent(queryClient, ["business.autopilot"]);
    await flush();
    autopilot.calls[1]?.resolve("x2");
    await done;
    expect(autopilot.calls).toHaveLength(2);
    expect(business.calls).toHaveLength(1);
    expect(spy.mock.calls.every(([, options]) => options?.cancelRefetch === false)).toBe(true);
  });
});
