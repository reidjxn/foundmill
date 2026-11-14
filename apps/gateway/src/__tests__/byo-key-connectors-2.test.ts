/**
 * The four connectors added next on the founder's own key (apollo, vercel, posthog, resend) at the gateway:
 * - live, outward or costly tools ask first (Needs you) in augmented and assisted mode and reach no vendor; read-only ones run;
 * - live with no stored credential is 409 integration_not_connected and reaches no vendor, even with platform secrets set;
 * - the project's Foundmill address steps aside when the founder's own Resend is connected (and not when it is archived);
 * - mock results are simulated and say so; Apollo, Vercel and PostHog results are the untrusted envelope;
 * - a suppressed recipient is refused before any vendor request.
 */
import { afterEach, describe, expect, it } from "vitest";
import { factsProblem, createApolloConnector, createDefaultRegistry, createPlatformMailMock, createPosthogConnector, createResendConnector, createVercelConnector, jsonResponse, type Connector } from "@foundmill/connectors";
import { repos, suppressionHash } from "@foundmill/db";
import { storeCredential } from "../credentials";
import { PLATFORM_MAIL_POLICY, type PlatformMailConfig } from "../platform-mail";
import { SIMULATED_NOTICE, type AllowResponse, type AskResponse, type CallResponse, type DenyResponse } from "../types";
import { setupGateway, type GatewayFixture } from "./harness";

const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome, JSON.stringify(r)).toBe("allow");
  return r as AllowResponse;
};
const asDeny = (r: CallResponse): DenyResponse => {
  expect(r.outcome, JSON.stringify(r)).toBe("deny");
  return r as DenyResponse;
};

/** A fetch that records every vendor request and answers with `answer`. */
function recordingFetch(answer: () => Response = () => jsonResponse({})) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(new Request(input, init).url);
    return answer();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, urls };
}

const PLATFORM_SECRETS = { sendgridApiKey: "SG.platform-key-0123456789", openaiApiKey: "sk-platform-openai-key-0123456789" };
const KEYS = { apollo: "apollo-founder-key-0123456789", vercel: "vercel-founder-token-0123456789", posthog: "phx_founder_key_0123456789", resend: "re_founder_key_0123456789" } as const;
const POSTHOG_CONFIG = { projectId: "12345", region: "us" };

const MAIL = { from: { email: "hello@northwindskincare.com", name: "Northwind" }, to: { email: "new.person@outside.example", name: "New Person" }, subject: "Hello", text: "Hi, thanks for your interest." };
/** Where the gateway signs unsubscribe links from: platform mail switched on, with a secret and an https ingest address. */
const MAIL_CONFIG: PlatformMailConfig = { domain: "mail.foundmill.test", dailyCap: 50, ceiling: 2_000, signingSecret: "s".repeat(40), unsubscribeBase: "https://ingest.foundmill.test" };
const CALLS = {
  "apollo.search_people": { connector: "apollo", tool: "search_people", args: { titles: ["Founder"] } },
  "apollo.search_organizations": { connector: "apollo", tool: "search_organizations", args: { keywords: ["cosmetics"] } },
  "apollo.enrich_person": { connector: "apollo", tool: "enrich_person", args: { id: "ppl_fx_maya001" } },
  "vercel.list_deployments": { connector: "vercel", tool: "list_deployments", args: {} },
  "vercel.create_deployment": { connector: "vercel", tool: "create_deployment", args: { deploymentId: "dpl_8RkQmZ2xVf3nTbYhLw5cAeJp9sUd", target: "production" } },
  "posthog.query_insights": { connector: "posthog", tool: "query_insights", args: { query: "SELECT 1" } },
  "resend.list_domains": { connector: "resend", tool: "list_domains", args: {} },
  "resend.send_mail": { connector: "resend", tool: "send_mail", args: MAIL },
} as const;
type CallKey = keyof typeof CALLS;

const liveConnectors = (fetch: typeof globalThis.fetch, extra: { isSuppressed?: (businessId: string, email: string) => Promise<boolean> } = {}): Connector[] => [
  createApolloConnector({ secrets: PLATFORM_SECRETS, fetch }),
  createVercelConnector({ secrets: PLATFORM_SECRETS, fetch }),
  createPosthogConnector({ secrets: PLATFORM_SECRETS, fetch }),
  createResendConnector({ secrets: PLATFORM_SECRETS, fetch, ...extra }),
];

/** The row the api writes when the founder connects, plus the sealed key. */
async function connect(g: GatewayFixture, connector: keyof typeof KEYS) {
  const row = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: connector, status: "connected", authKind: "api_key", ...(connector === "posthog" ? { settings: { config: POSTHOG_CONFIG } } : {}) });
  await storeCredential(g.db, g.vault, g.businessId, row.id, { kind: "api_key", secret: KEYS[connector] });
  return row;
}

let open: GatewayFixture | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

describe("live: outward or costly tools ask first in augmented and assisted mode, read-only ones run", () => {
  const asks: CallKey[] = ["vercel.create_deployment", "apollo.enrich_person", "apollo.search_organizations", "resend.send_mail"];
  /** The founder's rule (2026-11-12): these ask in both modes, and nothing reaches the vendor until the founder approves. */
  async function expectAsks(businessMode: "augmented" | "assisted", keys: CallKey[]) {
    const vendor = recordingFetch();
    const g = await setupGateway({ mode: "live", businessMode, connectors: liveConnectors(vendor.fetch) });
    open = g;
    for (const c of ["apollo", "vercel", "posthog", "resend"] as const) await connect(g, c);
    const token = await g.token({ allowedTools: ["apollo:*", "vercel:*", "posthog:*", "resend:*"] });
    for (const key of keys) {
      const r = await g.client.call(token, CALLS[key]);
      expect(r.outcome, `${key} in ${businessMode}: ${JSON.stringify(r)}`).toBe("ask");
      expect((r as AskResponse).approvalId, key).toBeTruthy();
    }
    expect(vendor.urls).toEqual([]);
  }

  it(`augmented: ${asks.join(", ")} answer ask and make no vendor request`, () => expectAsks("augmented", asks));
  it("assisted: vercel.create_deployment and resend.send_mail answer ask (irreversible) and make no vendor request", () => expectAsks("assisted", ["vercel.create_deployment", "resend.send_mail"]));

  // A spent credit cannot be taken back: both paid Apollo calls are `irreversible`, so assisted mode asks too.
  it("assisted: apollo.enrich_person and apollo.search_organizations answer ask and make no vendor request", () => expectAsks("assisted", ["apollo.enrich_person", "apollo.search_organizations"]));

  it("assisted: vercel.list_deployments, apollo.search_people, posthog.query_insights and resend.list_domains run", async () => {
    const vendor = recordingFetch(() => jsonResponse({ deployments: [], people: [], total_entries: 0, columns: ["1"], results: [[1]], hasMore: false, data: [] }));
    const g = await setupGateway({ mode: "live", businessMode: "assisted", connectors: liveConnectors(vendor.fetch) });
    open = g;
    for (const c of ["apollo", "vercel", "posthog", "resend"] as const) await connect(g, c);
    const token = await g.token({ allowedTools: ["apollo:*", "vercel:*", "posthog:*", "resend:*"] });
    for (const key of ["vercel.list_deployments", "apollo.search_people", "posthog.query_insights", "resend.list_domains"] as const) {
      const r = asAllow(await g.client.call(token, CALLS[key]));
      expect(r.result.ok, `${key}: ${JSON.stringify(r.result)}`).toBe(true);
      expect(r.result, key).not.toHaveProperty("simulated");
      expect(JSON.stringify(r), key).not.toContain(KEYS[CALLS[key].connector]);
    }
    expect(vendor.urls).toHaveLength(4);
    expect(vendor.urls.some((u) => u.includes("api.apollo.io"))).toBe(true);
    expect(vendor.urls.some((u) => u.includes("api.vercel.com"))).toBe(true);
    expect(vendor.urls.some((u) => u.includes("posthog.com"))).toBe(true);
    expect(vendor.urls.some((u) => u.includes("api.resend.com"))).toBe(true);
  });
});

describe("live: no stored credential", () => {
  it("every tool of the four is 409 integration_not_connected with no vendor request, with platform secrets set", async () => {
    const vendor = recordingFetch();
    const g = await setupGateway({ mode: "live", businessMode: "automated", connectors: liveConnectors(vendor.fetch) });
    open = g;
    const token = await g.token({ allowedTools: ["apollo:*", "vercel:*", "posthog:*", "resend:*"] });
    // The row exists and its credential does not.
    for (const c of ["apollo", "vercel", "posthog", "resend"] as const) await repos.integrations.upsert(g.db, g.businessId, { connectorKey: c, status: "connected", authKind: "api_key", ...(c === "posthog" ? { settings: { config: POSTHOG_CONFIG } } : {}) });
    for (const [key, call] of Object.entries(CALLS)) await expect(g.client.call(token, call), `${key} with no credential`).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
    // And with no integration row at all.
    for (const c of ["apollo", "vercel", "posthog", "resend"] as const) {
      const row = await repos.integrations.getByKey(g.db, g.businessId, c);
      await repos.integrations.archive(g.db, g.businessId, row!.id);
    }
    for (const [key, call] of Object.entries(CALLS)) await expect(g.client.call(token, call), `${key} archived`).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
    expect(vendor.urls).toEqual([]);
  });
});

describe("platform_mail steps aside for the founder's own Resend", () => {
  const config: PlatformMailConfig = { domain: "mail.foundmill.test", dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005" };
  const message = { connector: "platform_mail", tool: "send_mail", args: { to: { email: "anna@example.com", name: "Anna" }, subject: "Thanks for joining", text: "Hi Anna, thanks for joining the list." } };

  it("is refused with the own-sender policy id while resend is connected, and goes through when it is degraded, archived or disconnected", async () => {
    const g = await setupGateway({ businessMode: "automated", connectors: [createPlatformMailMock()] });
    open = g;
    g.deps.appEnv = "test";
    g.deps.platformMail = config;
    const token = await g.token({ allowedTools: ["platform_mail:*"] });
    await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "resend", status: "connected", authKind: "api_key", accountLabel: "own" });
    expect(asDeny(await g.client.call(token, message)).policyIds).toEqual([PLATFORM_MAIL_POLICY.own_sender]);
    // A degraded Resend (no verified domain) cannot send, so it must not leave the project with no sender at all.
    await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "resend", status: "degraded", authKind: "api_key", accountLabel: "own" });
    expect(asAllow(await g.client.call(token, message)).result.ok).toBe(true);
    const row = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "resend", status: "disconnected", authKind: "api_key", accountLabel: "own" });
    expect(asAllow(await g.client.call(token, message)).result.ok).toBe(true);
    await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "resend", status: "connected", authKind: "api_key", accountLabel: "own" });
    expect(asDeny(await g.client.call(token, message)).policyIds).toEqual([PLATFORM_MAIL_POLICY.own_sender]);
    await repos.integrations.archive(g.db, g.businessId, row.id);
    expect(asAllow(await g.client.call(token, message)).result.ok).toBe(true);
  });
});

describe("mock mode", () => {
  it("each new connector answers as simulated with the notice, and apollo, vercel and posthog results are untrusted", async () => {
    const mock = createDefaultRegistry({ secrets: {}, fetch: recordingFetch().fetch })
      .list("mock")
      .filter((c) => ["apollo", "vercel", "posthog", "resend"].includes(c.key));
    expect(mock).toHaveLength(4);
    const g = await setupGateway({ mode: "mock", businessMode: "automated", connectors: mock });
    open = g;
    g.deps.appEnv = "test";
    g.deps.platformMail = MAIL_CONFIG;
    const token = await g.token({ allowedTools: ["apollo:*", "vercel:*", "posthog:*", "resend:*"] });
    const untrusted = new Set(["apollo", "vercel", "posthog"]);
    for (const [key, call] of Object.entries(CALLS)) {
      const r = await g.client.call(token, call);
      const a = asAllow(r);
      expect(a.result, key).toMatchObject({ ok: true, simulated: true, notice: SIMULATED_NOTICE });
      if (untrusted.has(call.connector)) expect(a.result.untrusted, key).toBe(true);
    }
  });
});

describe("typed reads: an agent that only gets the reader's digest still gets the checked values", () => {
  const DIGEST = { title: null, sender: null, summary: "A list of people.", amounts: [], dates: [] };
  const setup = async () => {
    const mock = createDefaultRegistry({ secrets: {}, fetch: recordingFetch().fetch }).list("mock").filter((c) => c.key === "apollo");
    const g = await setupGateway({ mode: "mock", businessMode: "automated", connectors: mock });
    open = g;
    const read: unknown[] = [];
    g.deps.reader = { digest: async ({ content }) => (read.push(content), DIGEST) };
    return { g, read };
  };

  it("holding Apollo's paid calls: the search comes back as the digest plus facts, with lead ids and no raw text", async () => {
    const { g, read } = await setup();
    const token = await g.token({ allowedTools: ["apollo:*"] });
    const r = asAllow(await g.client.call(token, CALLS["apollo.search_people"]));
    const data = r.result.data as { untrusted: boolean; quarantined?: boolean; content: unknown; facts?: { people: { id: string | null; title: string | null }[] } };
    expect(data).toMatchObject({ untrusted: true, quarantined: true, content: DIGEST });
    // The reader read the whole answer; the agent got the summary and the checked values.
    expect(read).toHaveLength(1);
    expect(data.facts?.people.length).toBeGreaterThan(0);
    for (const person of data.facts!.people) expect(person.id).toMatch(/^[A-Za-z0-9_.:-]+$/);
    expect(factsProblem(data.facts)).toBeNull();
  });

  it("holding only the free search: the content is read raw, and the same facts ride along", async () => {
    const { g, read } = await setup();
    const token = await g.token({ allowedTools: ["apollo:search_people"] });
    const r = asAllow(await g.client.call(token, CALLS["apollo.search_people"]));
    const data = r.result.data as { quarantined?: boolean; content: { people: unknown[] }; facts?: { people: unknown[] } };
    expect(data.quarantined).toBeUndefined();
    expect(read).toEqual([]);
    expect(data.content.people.length).toBeGreaterThan(0);
    expect(data.facts?.people).toHaveLength(data.content.people.length);
  });

  it("when the reader fails, the content is withheld and the checked values still arrive", async () => {
    const { g } = await setup();
    g.deps.reader = { digest: async () => Promise.reject(new Error("reader down")) };
    const token = await g.token({ allowedTools: ["apollo:*"] });
    const r = asAllow(await g.client.call(token, CALLS["apollo.search_people"]));
    const data = r.result.data as { quarantined?: boolean; content: unknown; unavailable?: string; facts?: { people: unknown[] } };
    expect(data).toMatchObject({ quarantined: true, content: null });
    expect(data.unavailable).toBeTruthy();
    expect(data.facts?.people.length).toBeGreaterThan(0);
  });
});

describe("a value in a typed read is still first seen in untrusted content", () => {
  it("the work email from an Apollo lookup cannot be mailed until the founder approves it", async () => {
    const mock = createDefaultRegistry({ secrets: {}, fetch: recordingFetch().fetch }).list("mock").filter((c) => ["apollo", "resend"].includes(c.key));
    const g = await setupGateway({ mode: "mock", businessMode: "automated", connectors: mock });
    open = g;
    g.deps.appEnv = "test";
    g.deps.platformMail = MAIL_CONFIG;
    g.deps.reader = { digest: async () => ({ title: null, sender: null, summary: "One person.", amounts: [], dates: [] }) };
    const token = await g.token({ allowedTools: ["apollo:*", "resend:*"] });
    const looked = asAllow(await g.client.call(token, CALLS["apollo.enrich_person"]));
    const facts = (looked.result.data as { quarantined?: boolean; facts?: { email: string | null } }).facts;
    expect((looked.result.data as { quarantined?: boolean }).quarantined).toBe(true);
    expect(facts?.email).toMatch(/@/);
    // The agent holds the address now, and the recipient rule still stands between it and a send.
    const send = await g.client.call(token, { connector: "resend", tool: "send_mail", args: { ...MAIL, to: { email: facts!.email! } } });
    expect(send.outcome).toBe("deny");
    expect((send as { policyIds: string[] }).policyIds).toContain("untrusted-recipient");
  });
});

describe("resend.send_mail carries the gateway's own unsubscribe link", () => {
  const sendBody = async (platformMail: PlatformMailConfig | undefined, args: Record<string, unknown> = MAIL) => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.method === "POST") bodies.push((await req.json()) as Record<string, unknown>);
      return req.url.endsWith("/domains") ? jsonResponse({ data: [{ id: "d1", name: "northwindskincare.com", status: "verified" }] }) : jsonResponse({ id: "email_1" });
    }) as unknown as typeof globalThis.fetch;
    const g = await setupGateway({ mode: "live", businessMode: "automated", connectors: liveConnectors(fetch) });
    open = g;
    g.deps.appEnv = "production";
    if (platformMail) g.deps.platformMail = platformMail;
    await connect(g, "resend");
    const token = await g.token({ allowedTools: ["resend:*"] });
    const r = await g.client.call(token, { connector: "resend", tool: "send_mail", args });
    return { r, bodies };
  };

  // One gateway per case (each setup takes over 10 s on a loaded CI runner; two in one case outran its 30 s timeout).
  it("signs the link for this project and recipient", async () => {
    const { r, bodies } = await sendBody(MAIL_CONFIG);
    expect(asAllow(r).result.ok).toBe(true);
    expect(bodies).toHaveLength(1);
    const header = (bodies[0]!.headers as Record<string, string>)["List-Unsubscribe"]!;
    expect(header).toMatch(/^<https:\/\/ingest\.foundmill\.test\/mail\/unsubscribe\?t=[^>]+>$/);
    expect(String(bodies[0]!.text)).toContain(header.slice(1, -1));
  });

  it("refuses an unsubscribe link the agent supplies", async () => {
    const own = await sendBody(MAIL_CONFIG, { ...MAIL, unsubscribeUrl: "https://elsewhere.example/stop" });
    expect(asAllow(own.r).result).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    expect(own.bodies).toEqual([]);
  });

  // One gateway per case: each setup takes over 10 s on a loaded CI runner, so three in one case outran its timeout.
  it.each([
    ["platform mail off", undefined],
    ["no signing secret", { ...MAIL_CONFIG, signingSecret: null }],
    ["no https ingest address", { ...MAIL_CONFIG, unsubscribeBase: "http://localhost:4005" }],
  ] as const)("sends nothing where no signed link can be made: %s", async (_label, config) => {
    const { r, bodies } = await sendBody(config);
    expect(asAllow(r).result).toMatchObject({ ok: false, error: { code: "unsubscribe_unavailable" } });
    expect(bodies).toEqual([]);
  });
});

describe("resend.send_mail to a suppressed recipient", () => {
  it("is refused before any vendor request, in every business mode", async () => {
    const vendor = recordingFetch();
    const g = await setupGateway({
      mode: "live",
      connectors: liveConnectors(vendor.fetch, { isSuppressed: (businessId, email) => repos.channels.isSuppressed(g.db, businessId, { emailHash: suppressionHash("email", email) }) }),
    });
    open = g;
    await connect(g, "resend");
    await repos.channels.addSuppression(g.db, g.businessId, { emailHash: suppressionHash("email", "Gone@Outside.example"), reason: "unsubscribed" });
    const token = await g.token({ allowedTools: ["resend:*"] });
    for (const mode of ["augmented", "assisted", "automated"] as const) {
      await repos.businesses.setBusinessMode(g.db, g.businessId, mode);
      const r = asDeny(await g.client.call(token, { connector: "resend", tool: "send_mail", args: { ...MAIL, to: { email: "gone@outside.example" } } }));
      expect(r.policyIds, mode).toEqual(["suppressed-recipient"]);
    }
    expect(vendor.urls).toEqual([]);
  });
});
