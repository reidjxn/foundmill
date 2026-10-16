/**
 * The browser's transport to the API (audit F7, WEB-2, C5): reads go to the web app's own origin, changes and streams
 * go to the API itself, the typed and path-addressed clients share one batch, a batch never grows a
 * URL the CDN refuses, and no request waits more than `TOKEN_TIMEOUT_MS` for its bearer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { makeQueryClient } from "../query-client";
import { SAME_ORIGIN_TRPC_PATH } from "../same-origin-api";
import { browserQueryUrl, createApiClient, createUntypedApiClient, MAX_URL_LENGTH, resolveBearer, SIGN_IN_TIMEOUT_MESSAGE, TOKEN_TIMEOUT_MS, untypedClientOf } from "../trpc";

const API = "http://api.test/trpc";
const SAME_ORIGIN = "http://web.test/api/trpc";

interface Sent {
  url: URL;
  method: string;
  authorization: string | null;
}

/** A fetch that records each request and answers every call in it with an empty result. */
function recorder() {
  const sent: Sent[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    sent.push({ url, method: (init?.method ?? "GET").toUpperCase(), authorization: new Headers(init?.headers).get("authorization") });
    const calls = decodeURIComponent(url.pathname.replace(/^.*\/trpc\//, "")).split(",").length;
    return new Response(JSON.stringify(Array.from({ length: calls }, () => ({ result: { data: { json: null } } }))), { headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { sent, fetch };
}

const paths = (s: Sent) => decodeURIComponent(s.url.pathname.replace(/^.*\/trpc\//, "")).split(",");

afterEach(() => {
  vi.useRealTimers();
});

describe("browser reads on the web app's own origin", () => {
  it("sends reads to the same-origin path, and changes and streams to the API", async () => {
    const { sent, fetch } = recorder();
    const client = createUntypedApiClient({ getToken: () => "jwt", url: API, queryUrl: SAME_ORIGIN, fetch });
    await client.query("inbox.list", { businessId: "b" });
    await client.mutation("inbox.markRead", { businessId: "b", itemId: "i" });
    await client.mutation("idea.draft", { prompt: "a" }).catch(() => undefined);
    const read = sent.find((s) => paths(s).includes("inbox.list"))!;
    expect(read.url.origin + read.url.pathname).toBe(`${SAME_ORIGIN}/inbox.list`);
    expect(read.method).toBe("GET");
    expect(read.authorization).toBe("Bearer jwt");
    const change = sent.find((s) => paths(s).includes("inbox.markRead"))!;
    expect(change.url.origin + change.url.pathname).toBe(`${API}/inbox.markRead`);
    expect(change.method).toBe("POST");
    const stream = sent.find((s) => paths(s).includes("idea.draft"))!;
    expect(stream.url.origin).toBe("http://api.test");
  });

  it("uses the same-origin path in the browser only (a server render has no page origin)", () => {
    expect(browserQueryUrl()).toBe(SAME_ORIGIN_TRPC_PATH);
  });

  it("lets a widget's read and the shell's read made in the same tick share one request", async () => {
    const { sent, fetch } = recorder();
    const typed = createApiClient({ getToken: () => "jwt", url: API, queryUrl: SAME_ORIGIN, fetch });
    const untyped = untypedClientOf(typed);
    await Promise.all([typed.business.get.query({ businessId: "b" }), untyped.query("inbox.list", { businessId: "b", limit: 4 })]);
    expect(sent).toHaveLength(1);
    expect(paths(sent[0]!)).toEqual(["business.get", "inbox.list"]);
  });

  it("splits a batch before its URL grows past what the CDN accepts", async () => {
    const { sent, fetch } = recorder();
    const client = createUntypedApiClient({ getToken: () => "jwt", url: API, queryUrl: SAME_ORIGIN, fetch });
    const long = "x".repeat(1_500);
    await Promise.all(Array.from({ length: 12 }, (_, i) => client.query("crm.entity.list", { businessId: "b", q: `${long}${i}` })));
    expect(sent.length).toBeGreaterThan(1);
    for (const s of sent) expect(s.url.href.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    expect(sent.reduce((n, s) => n + paths(s).length, 0)).toBe(12);
  });
});

describe("the wait for the bearer (audit C5)", () => {
  it("uses a token that comes in time, and the dev token only when there is no session", async () => {
    expect(await resolveBearer(() => "jwt")).toBe("jwt");
    expect(await resolveBearer(async () => "late-but-in-time", 50)).toBe("late-but-in-time");
    expect(await resolveBearer(async () => null, 50)).toBe("dev"); // vitest runs with NEXT_PUBLIC_APP_ENV=test
  });

  it("gives up on a token that does not come, and sends nothing rather than a stale or dev token", async () => {
    const never = () => new Promise<string | null>(() => undefined);
    await expect(resolveBearer(never, 20)).rejects.toThrow(SIGN_IN_TIMEOUT_MESSAGE);
  });

  it("fails a read whose token hangs after TOKEN_TIMEOUT_MS, without sending it, as an error a query retries", async () => {
    vi.useFakeTimers();
    const { sent, fetch } = recorder();
    const client = createUntypedApiClient({ getToken: () => new Promise<string | null>(() => undefined), url: API, queryUrl: SAME_ORIGIN, fetch });
    const read = client.query("inbox.list", { businessId: "b" }).then(
      () => null,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(TOKEN_TIMEOUT_MS - 1);
    let settled = false;
    void read.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const err = await read;
    expect(err).toBeInstanceOf(TRPCClientError);
    expect((err as Error).message).toBe(SIGN_IN_TIMEOUT_MESSAGE);
    expect(sent).toHaveLength(0);
    const retry = makeQueryClient().getDefaultOptions().queries?.retry as (count: number, err: unknown) => boolean;
    expect(retry(0, err)).toBe(true);
  });
});
