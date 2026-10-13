// @vitest-environment happy-dom
import { QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REDIRECT_LOOP_MS,
  announceSignedOut,
  classifyApiError,
  emitAuthLoss,
  handleAuthLoss,
  onAuthLoss,
  reportApiError,
  resetAuthLossHandling,
  signInUrl,
  watchSignedOutElsewhere,
  type AuthLoss,
  type AuthLossDeps,
} from "../auth/session-end";
import { makeQueryClient } from "../query-client";

const BID = "b1e50000-0000-4000-8000-000000000001";
const apiError = (code: string, appCode?: string) =>
  new TRPCClientError("x", { result: { error: { code: -32003, message: "x", data: { code, httpStatus: code === "UNAUTHORIZED" ? 401 : 403, ...(appCode ? { appCode } : {}) } } } } as never);

afterEach(() => resetAuthLossHandling());

describe("classifyApiError", () => {
  it("UNAUTHORIZED ends the session, wherever it came from", () => {
    expect(classifyApiError(apiError("UNAUTHORIZED"), null)).toEqual({ kind: "signed-out" });
    expect(classifyApiError(apiError("UNAUTHORIZED"), BID)).toEqual({ kind: "signed-out" });
  });

  it("a not_a_member FORBIDDEN on a business ends the membership; other refusals do not", () => {
    expect(classifyApiError(apiError("FORBIDDEN", "not_a_member"), BID)).toEqual({ kind: "removed", businessId: BID });
    // Without a business there is nothing to drop.
    expect(classifyApiError(apiError("FORBIDDEN", "not_a_member"), null)).toBeNull();
    // A role or section refusal, the invite list and a tier limit are not a removal.
    expect(classifyApiError(apiError("FORBIDDEN", "forbidden"), BID)).toBeNull();
    expect(classifyApiError(apiError("FORBIDDEN", "not_invited"), BID)).toBeNull();
    expect(classifyApiError(apiError("FORBIDDEN"), BID)).toBeNull();
    expect(classifyApiError(apiError("NOT_FOUND"), BID)).toBeNull();
    expect(classifyApiError(new Error("boom"), BID)).toBeNull();
    expect(classifyApiError(undefined, BID)).toBeNull();
  });
});

describe("the query client reports what the API refused (audit RES-08, RUI-13)", () => {
  const seen: AuthLoss[] = [];
  const stop = onAuthLoss((loss) => seen.push(loss));
  afterEach(() => {
    seen.length = 0;
  });

  it("an UNAUTHORIZED read reports a lost session", async () => {
    const qc = makeQueryClient();
    await qc.fetchQuery({ queryKey: [["inbox", "list"], { input: { businessId: BID } }], queryFn: () => Promise.reject(apiError("UNAUTHORIZED")), retry: false }).catch(() => undefined);
    expect(seen).toEqual([{ kind: "signed-out" }]);
  });

  it("a read of a business the person was removed from reports the removal, with the business from the query key", async () => {
    const qc = makeQueryClient();
    await qc.fetchQuery({ queryKey: [["finance", "overview"], { input: { businessId: BID } }], queryFn: () => Promise.reject(apiError("FORBIDDEN", "not_a_member")), retry: false }).catch(() => undefined);
    expect(seen).toEqual([{ kind: "removed", businessId: BID }]);
  });

  it("a refused write reports the same, with the business from its variables", async () => {
    const qc = makeQueryClient();
    const mutation = qc.getMutationCache().build(qc, { mutationFn: () => Promise.reject(apiError("FORBIDDEN", "not_a_member")) });
    await mutation.execute({ businessId: BID }).catch(() => undefined);
    expect(seen).toEqual([{ kind: "removed", businessId: BID }]);
    await qc
      .getMutationCache()
      .build(qc, { mutationFn: () => Promise.reject(apiError("UNAUTHORIZED")) })
      .execute({})
      .catch(() => undefined);
    expect(seen).toEqual([{ kind: "removed", businessId: BID }, { kind: "signed-out" }]);
  });

  it("an ordinary failure reports nothing", async () => {
    const qc = makeQueryClient();
    await qc.fetchQuery({ queryKey: [["inbox", "list"], { input: { businessId: BID } }], queryFn: () => Promise.reject(apiError("FORBIDDEN", "forbidden")), retry: false }).catch(() => undefined);
    await qc.fetchQuery({ queryKey: ["plain"], queryFn: () => Promise.reject(new Error("offline")), retry: false }).catch(() => undefined);
    expect(seen).toEqual([]);
    stop();
  });

  it("reportApiError reaches every listener once and stops after the unsubscribe", () => {
    const a = vi.fn();
    const off = onAuthLoss(a);
    reportApiError(apiError("UNAUTHORIZED"), null);
    off();
    reportApiError(apiError("UNAUTHORIZED"), null);
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith({ kind: "signed-out" }, "api");
  });
});

describe("signing out in one tab reaches the others", () => {
  function fakeBus() {
    const posted: unknown[] = [];
    let channel: { onmessage: ((ev: { data: unknown }) => void) | null; closed: boolean } | null = null;
    const open = () => {
      const c = { onmessage: null as ((ev: { data: unknown }) => void) | null, closed: false, postMessage: (m: unknown) => void posted.push(m), close: () => void (c.closed = true) };
      channel = c;
      return c;
    };
    return { open, posted, get channel() { return channel!; } };
  }

  it("announces on the session channel and closes it", () => {
    const bus = fakeBus();
    announceSignedOut(bus.open);
    expect(bus.posted).toEqual([{ type: "signed-out", from: expect.any(String) }]);
    expect(bus.channel.closed).toBe(true);
  });

  it("another tab's message runs the handler; this tab's own message and other messages do not", () => {
    const sender = fakeBus();
    announceSignedOut(sender.open);
    const own = sender.posted[0];

    const bus = fakeBus();
    const handler = vi.fn();
    const stop = watchSignedOutElsewhere(handler, bus.open);
    bus.channel.onmessage?.({ data: own });
    bus.channel.onmessage?.({ data: { type: "something-else", from: "other" } });
    bus.channel.onmessage?.({ data: null });
    expect(handler).not.toHaveBeenCalled();
    bus.channel.onmessage?.({ data: { type: "signed-out", from: "another-tab" } });
    expect(handler).toHaveBeenCalledTimes(1);
    stop();
    expect(bus.channel.closed).toBe(true);
  });

  it("does nothing where BroadcastChannel is missing", () => {
    expect(() => announceSignedOut(() => null)).not.toThrow();
    expect(() => watchSignedOutElsewhere(() => undefined, () => null)()).not.toThrow();
    expect(() => announceSignedOut(() => { throw new Error("blocked"); })).not.toThrow();
  });
});

describe("handleAuthLoss", () => {
  function setup(over: Partial<AuthLossDeps> & { path?: string; search?: string } = {}) {
    const queryClient = new QueryClient();
    queryClient.setQueryData([["inbox", "list"], { input: { businessId: BID } }], { items: [1] });
    queryClient.setQueryData([["business", "get"], { input: { businessId: BID } }], { name: "Northwind Skincare" });
    queryClient.setQueryData([["inbox", "list"], { input: { businessId: "other" } }], { items: [2] });
    const store = new Map<string, string>();
    const deps = {
      queryClient,
      closeStream: vi.fn(),
      navigate: vi.fn(),
      replace: vi.fn(),
      toast: vi.fn(),
      location: () => ({ pathname: over.path ?? `/b/${BID}/inbox`, search: over.search ?? "?tab=notes" }),
      businessName: () => "Northwind Skincare",
      now: () => 1_000_000,
      storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
      ...over,
    } satisfies AuthLossDeps;
    return { deps, queryClient, store };
  }

  it("a lost session closes the socket, empties the cache and goes to sign-in with the page as next", () => {
    const { deps, queryClient } = setup();
    handleAuthLoss({ kind: "signed-out" }, "tab", deps);
    expect(deps.closeStream).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(deps.navigate).toHaveBeenCalledWith(signInUrl(`/b/${BID}/inbox?tab=notes`));
    expect(vi.mocked(deps.navigate).mock.calls[0]![0]).toBe(`/login?next=${encodeURIComponent(`/b/${BID}/inbox?tab=notes`)}`);
  });

  it("a page whose queries all fail together leaves once", () => {
    const { deps } = setup();
    for (let i = 0; i < 5; i++) handleAuthLoss({ kind: "signed-out" }, "api", deps);
    expect(deps.navigate).toHaveBeenCalledTimes(1);
    expect(deps.closeStream).toHaveBeenCalledTimes(1);
  });

  it("does not redirect from the sign-in or sign-out pages", () => {
    for (const path of ["/login", "/login/", "/auth/callback"]) {
      resetAuthLossHandling();
      const { deps } = setup({ path, search: "" });
      handleAuthLoss({ kind: "signed-out" }, "api", deps);
      expect(deps.navigate).not.toHaveBeenCalled();
    }
  });

  it("an API refusal right after a redirect to sign-in does not loop; a refusal later does, and another tab's sign-out always does", () => {
    const first = setup();
    handleAuthLoss({ kind: "signed-out" }, "api", first.deps);
    expect(first.deps.navigate).toHaveBeenCalledTimes(1);

    // The proxy sent the person straight back (it still accepts the cookie) and the API refused again.
    resetAuthLossHandling();
    const again = setup({ now: () => 1_000_000 + 1_000 });
    again.store.set("fm_signin_redirect_at", "1000000");
    handleAuthLoss({ kind: "signed-out" }, "api", again.deps);
    expect(again.deps.navigate).not.toHaveBeenCalled();

    resetAuthLossHandling();
    const later = setup({ now: () => 1_000_000 + REDIRECT_LOOP_MS + 1 });
    later.store.set("fm_signin_redirect_at", "1000000");
    handleAuthLoss({ kind: "signed-out" }, "api", later.deps);
    expect(later.deps.navigate).toHaveBeenCalledTimes(1);

    resetAuthLossHandling();
    const tab = setup({ now: () => 1_000_000 + 1_000 });
    tab.store.set("fm_signin_redirect_at", "1000000");
    handleAuthLoss({ kind: "signed-out" }, "tab", tab.deps);
    expect(tab.deps.navigate).toHaveBeenCalledTimes(1);
  });

  it("works when storage is blocked", () => {
    const { deps } = setup({ storage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
    handleAuthLoss({ kind: "signed-out" }, "api", deps);
    expect(deps.navigate).toHaveBeenCalledTimes(1);
  });

  it("a removal drops that business's reads, says so with its name and sends the person to their businesses", () => {
    const { deps, queryClient } = setup();
    handleAuthLoss({ kind: "removed", businessId: BID }, "api", deps);
    expect(queryClient.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey))).toEqual([JSON.stringify([["inbox", "list"], { input: { businessId: "other" } }])]);
    expect(deps.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "You no longer have access to Northwind Skincare", tone: "warn" }));
    expect(deps.replace).toHaveBeenCalledWith("/");
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.closeStream).not.toHaveBeenCalled();
  });

  it("a removal is reported once however many queries fail, and names no business it does not know", () => {
    const { deps } = setup({ businessName: () => null });
    for (let i = 0; i < 4; i++) handleAuthLoss({ kind: "removed", businessId: BID }, "api", deps);
    expect(deps.toast).toHaveBeenCalledTimes(1);
    expect(deps.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "You no longer have access to that business" }));
    expect(deps.replace).toHaveBeenCalledTimes(1);
  });

  it("someone looking at another page is told, not moved", () => {
    const { deps } = setup({ path: "/network", search: "" });
    handleAuthLoss({ kind: "removed", businessId: BID }, "api", deps);
    expect(deps.toast).toHaveBeenCalledTimes(1);
    expect(deps.replace).not.toHaveBeenCalled();
  });

  it("emitAuthLoss reaches the listener the app registered", () => {
    const { deps } = setup();
    const off = onAuthLoss((loss, from) => handleAuthLoss(loss, from, deps));
    emitAuthLoss({ kind: "signed-out" }, "tab");
    off();
    expect(deps.navigate).toHaveBeenCalledTimes(1);
  });
});
