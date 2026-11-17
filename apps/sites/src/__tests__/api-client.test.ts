import { describe, expect, it } from "vitest";
import { createFollowApi } from "../api-client";

/** The api's tRPC wire format with superjson: `{ json: input }` in, `{ result: { data: { json } } }` or `{ error: { json } }` out. */
const fake = (reply: (url: string, init: RequestInit) => unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply(url, init)), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, api: createFollowApi({ apiUrl: "http://api.test/", fetch }) };
};

describe("createFollowApi", () => {
  it("asks for the consent sentence with a GET and the superjson input", async () => {
    const { calls, api } = fake(() => ({ result: { data: { json: { consentText: "I agree." } } } }));
    expect(await api.consent("lunchbox")).toEqual({ consentText: "I agree." });
    expect(calls[0]!.url).toBe(`http://api.test/trpc/publicPage.siteConsent?input=${encodeURIComponent('{"json":{"slug":"lunchbox"}}')}`);
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("reads null as no sign-ups", async () => {
    expect(await fake(() => ({ result: { data: { json: null } } })).api.consent("x")).toBeNull();
  });

  it("posts the follow with via site, and maps refusals to the shared sentences", async () => {
    const { calls, api } = fake(() => ({ result: { data: { json: { ok: true } } } }));
    expect(await api.submit({ slug: "lunchbox", email: "a@example.com", consent: true, website: null, turnstile: "t" })).toEqual({ ok: true });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ json: { slug: "lunchbox", email: "a@example.com", consent: true, website: null, turnstile: "t", via: "site" } });
    const refused = await fake(() => ({ error: { json: { message: "x", data: { code: "FORBIDDEN", appCode: "follow_unverified" } } } })).api.submit({ slug: "a", email: "a@example.com", consent: true, website: null, turnstile: null });
    expect(refused).toEqual({ refused: expect.stringContaining("could not check this browser") });
    const busy = await fake(() => ({ error: { json: { message: "x", data: { code: "TOO_MANY_REQUESTS" } } } })).api.submit({ slug: "a", email: "a@example.com", consent: true, website: null, turnstile: null });
    expect(busy).toEqual({ refused: expect.stringContaining("A lot of people") });
  });
});
