/**
 * The business and LIVE layouts hand the founder profile their gate read to the browser cache (audit WEB-9): it must
 * land under the exact key the browser's `founder.profile.get` hooks read (BusinessShell, the Inbox, the reading
 * pane, Settings), fresh, so none of them asks again after hydration. A key that differs by anything (an input, a
 * type) would hand it over silently unused.
 */
import { QueryClient, dehydrate, hashKey, hydrate, QueryObserver } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { describe, expect, it, vi } from "vitest";
import { createServerPrefetch, shouldHandOver } from "../hydrate.server";
import { FOUNDER_PROFILE_KEY, handOverProfile } from "../profile-handover";
import { makeQueryClient } from "../query-client";
import { createApiClient, type AppRouter, type RouterOutputs } from "../trpc";

type Profile = RouterOutputs["founder"]["profile"]["get"];
const PROFILE = { complete: true, email: "founder@example.com", profile: { displayName: "Ada" }, businesses: [{ id: "b1", name: "Northwind" }] } as unknown as Profile;

describe("the layout's founder profile reaches the browser cache", () => {
  it("under the key the browser hooks build (no input), the same on the server's options proxy", () => {
    const browser = createTRPCOptionsProxy<AppRouter>({ client: createApiClient({ getToken: () => null }), queryClient: new QueryClient() });
    const server = createServerPrefetch(createApiClient({ getToken: () => "t", url: "http://api.test/trpc" })).trpc;
    expect(hashKey(FOUNDER_PROFILE_KEY as unknown[])).toBe(hashKey(browser.founder.profile.get.queryKey() as unknown[]));
    expect(hashKey(FOUNDER_PROFILE_KEY as unknown[])).toBe(hashKey(browser.founder.profile.get.queryOptions(undefined, { staleTime: 5 * 60_000 }).queryKey as unknown[]));
    expect(hashKey(FOUNDER_PROFILE_KEY as unknown[])).toBe(hashKey(server.founder.profile.get.queryKey() as unknown[]));
  });

  it("is handed over with the shell's queries and read in the browser without a request", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    const { queryClient } = createServerPrefetch(createApiClient({ getToken: () => "t", url: "http://api.test/trpc", fetch: fetchSpy }));
    const state = dehydrate(handOverProfile(queryClient, PROFILE), { shouldDehydrateQuery: shouldHandOver });
    expect(state.queries).toHaveLength(1);

    const browserClient = makeQueryClient();
    hydrate(browserClient, state);
    const browser = createTRPCOptionsProxy<AppRouter>({ client: createApiClient({ getToken: () => null, fetch: fetchSpy }), queryClient: browserClient });
    // What BusinessShell, the Inbox and the reading pane mount with.
    const observer = new QueryObserver(browserClient, browser.founder.profile.get.queryOptions(undefined, { staleTime: 5 * 60_000 }));
    const unsubscribe = observer.subscribe(() => undefined);
    expect(observer.getCurrentResult().data).toEqual(PROFILE);
    expect(observer.getCurrentResult().isStale).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    unsubscribe();
  });
});
