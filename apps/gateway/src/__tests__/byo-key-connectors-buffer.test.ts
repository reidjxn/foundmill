/**
 * The `buffer` connector (the founder's own Buffer account) at the gateway:
 * - queue_post ask first (Needs you) in augmented AND assisted mode and reaches no vendor; the reads run;
 * - live with no stored credential is 409 integration_not_connected and reaches no vendor, even with platform secrets set;
 * - mock results are simulated and say so, and never report a post as sent;
 * - the typed read of list_channels rides beside the reader's digest for an agent that holds queue_post;
 * - a picture at a signed link is refused before any vendor call; over-limit text is fitted before it is sent;
 * - a link first seen in untrusted content is refused (a plain deny, no approval);
 * - automated mode allows queue_post within the caps, augmented and assisted ask.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createBufferConnector, createDefaultRegistry, factsProblem, jsonResponse, type Connector } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { postTextLength } from "@foundmill/shared/post-draft";
import { storeCredential } from "../credentials";
import { SIMULATED_NOTICE, type AllowResponse, type AskResponse, type CallResponse, type DenyResponse } from "../types";
import { setupGateway, type GatewayFixture } from "./harness";

const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome, JSON.stringify(r)).toBe("allow");
  return r as AllowResponse;
};

const KEY = "buffer-founder-key-0123456789";
const PLATFORM_SECRETS = { sendgridApiKey: "SG.platform-key-0123456789", openaiApiKey: "sk-platform-openai-key-0123456789" };
const ORG = "5f3a1c9e8b7d6a0012345678";
const CHANNEL = "64a0c0ffee0000000000x001";
const POST = "64a0c0ffee00000000post001";
const LINK = "https://northwindskincare.com/start";
const draft = (over: Record<string, unknown> = {}) => ({ text: "Our starter kit is live. Gentle skincare, made in small batches.", link: LINK, variants: {}, ...over });

const CALLS = {
  list_channels: { connector: "buffer", tool: "list_channels", args: {} },
  get_post: { connector: "buffer", tool: "get_post", args: { postId: POST } },
  queue_post: { connector: "buffer", tool: "queue_post", args: { channelId: CHANNEL, draft: draft(), when: { mode: "queue" } } },
} as const;

/** Canned Buffer answers shaped as documented, by operation name. Every request is recorded. */
function bufferFetch() {
  const requests: { op: string; variables: Record<string, unknown> }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = (await req.json()) as { query: string; variables?: Record<string, unknown> };
    const op = /^(?:query|mutation) (\w+)/.exec(body.query)?.[1] ?? "?";
    requests.push({ op, variables: body.variables ?? {} });
    switch (op) {
      case "Channels":
        return jsonResponse({ data: { channels: [{ id: CHANNEL, name: "northwindskin", displayName: "Northwind Skincare", service: "twitter", isQueuePaused: false, isLocked: false, isDisconnected: false }] } });
      case "Channel":
        return jsonResponse({ data: { channel: { id: CHANNEL, name: "northwindskin", displayName: "Northwind Skincare", service: "twitter", organizationId: ORG, isQueuePaused: false, isLocked: false, isDisconnected: false } } });
      case "CreatePost":
        return jsonResponse({ data: { createPost: { __typename: "PostActionSuccess", post: { id: POST, dueAt: "2026-11-14T15:00:00.000Z", status: "scheduled" } } } });
      case "Post":
        return jsonResponse({ data: { post: { id: POST, channelId: CHANNEL, channelService: "twitter", status: "scheduled", dueAt: "2026-11-14T15:00:00.000Z", sentAt: null, externalLink: null } } });
      default:
        return jsonResponse({ data: {} });
    }
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

const live = (fetch: typeof globalThis.fetch): Connector[] => [createBufferConnector({ secrets: PLATFORM_SECRETS, fetch })];

/** The row the api writes when the founder connects (the organization is stored, never an argument), plus the sealed key. */
async function connect(g: GatewayFixture) {
  const row = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "buffer", status: "connected", authKind: "api_key", settings: { config: { organizationId: ORG } } });
  await storeCredential(g.db, g.vault, g.businessId, row.id, { kind: "api_key", secret: KEY });
  return row;
}

let open: GatewayFixture | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

describe("live: queue_post asks first in augmented and assisted mode; the reads run", () => {
  async function expectAsks(businessMode: "augmented" | "assisted") {
    const vendor = bufferFetch();
    const g = await setupGateway({ mode: "live", businessMode, connectors: live(vendor.fetch) });
    open = g;
    await connect(g);
    const token = await g.token({ allowedTools: ["buffer:*"] });
    const r = await g.client.call(token, CALLS.queue_post);
    expect(r.outcome, `${businessMode}: ${JSON.stringify(r)}`).toBe("ask");
    expect((r as AskResponse).approvalId).toBeTruthy();
    expect(vendor.requests).toEqual([]);
  }

  it("augmented: queue_post answers ask and makes no vendor request", () => expectAsks("augmented"));
  it("assisted: queue_post answers ask (publishing in public cannot be recalled) and makes no vendor request", () => expectAsks("assisted"));

  it("assisted: list_channels and get_post run, with the founder's key and the stored organization", async () => {
    const vendor = bufferFetch();
    const g = await setupGateway({ mode: "live", businessMode: "assisted", connectors: live(vendor.fetch) });
    open = g;
    await connect(g);
    const token = await g.token({ allowedTools: ["buffer:list_channels", "buffer:get_post"] });
    for (const key of ["list_channels", "get_post"] as const) {
      const r = asAllow(await g.client.call(token, CALLS[key]));
      expect(r.result.ok, `${key}: ${JSON.stringify(r.result)}`).toBe(true);
      expect(r.result, key).not.toHaveProperty("simulated");
      expect(r.result.untrusted, key).toBe(true);
      expect(JSON.stringify(r), key).not.toContain(KEY);
    }
    expect(vendor.requests.map((q) => q.op)).toEqual(["Channels", "Post"]);
    expect(vendor.requests[0]!.variables).toEqual({ organizationId: ORG });
  });
});

describe("queue_post by business mode: augmented and assisted ask, automated runs within the caps", () => {
  it("pins the contract: augmented ask, assisted ask, automated allow", async () => {
    const vendor = bufferFetch();
    const g = await setupGateway({ mode: "live", businessMode: "augmented", connectors: live(vendor.fetch) });
    open = g;
    await connect(g);
    const token = await g.token({ allowedTools: ["buffer:*"] });
    for (const mode of ["augmented", "assisted"] as const) {
      await repos.businesses.setBusinessMode(g.db, g.businessId, mode);
      expect((await g.client.call(token, CALLS.queue_post)).outcome, mode).toBe("ask");
    }
    expect(vendor.requests).toEqual([]);
    await repos.businesses.setBusinessMode(g.db, g.businessId, "automated");
    const r = asAllow(await g.client.call(token, CALLS.queue_post));
    expect(r.result.ok, JSON.stringify(r.result)).toBe(true);
    expect(vendor.requests.map((q) => q.op)).toEqual(["Channel", "CreatePost"]);
  });
});

describe("live: no stored credential", () => {
  it("every tool is 409 integration_not_connected with no vendor request, with platform secrets set", async () => {
    const vendor = bufferFetch();
    const g = await setupGateway({ mode: "live", businessMode: "automated", connectors: live(vendor.fetch) });
    open = g;
    const token = await g.token({ allowedTools: ["buffer:*"] });
    // The row exists and its credential does not.
    await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "buffer", status: "connected", authKind: "api_key", settings: { config: { organizationId: ORG } } });
    for (const [key, call] of Object.entries(CALLS)) await expect(g.client.call(token, call), `${key} with no credential`).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
    // And with no integration row at all.
    const row = await repos.integrations.getByKey(g.db, g.businessId, "buffer");
    await repos.integrations.archive(g.db, g.businessId, row!.id);
    // Two of the three: the connector's own limit is five calls a minute, and a refused call still counts.
    for (const [key, call] of Object.entries(CALLS).filter(([k]) => k !== "get_post")) await expect(g.client.call(token, call), `${key} archived`).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
    expect(vendor.requests).toEqual([]);
  });
});

describe("mock mode", () => {
  it("each tool answers as simulated with the notice, and a queued post is never reported as sent", async () => {
    const mock = createDefaultRegistry({ secrets: {}, fetch: bufferFetch().fetch }).list("mock").filter((c) => c.key === "buffer");
    expect(mock).toHaveLength(1);
    const g = await setupGateway({ mode: "mock", businessMode: "automated", connectors: mock });
    open = g;
    const token = await g.token({ allowedTools: ["buffer:*"] });
    const list = asAllow(await g.client.call(token, CALLS.list_channels));
    expect(list.result).toMatchObject({ ok: true, simulated: true, notice: SIMULATED_NOTICE, untrusted: true });
    const channels = (list.result.data as { content?: { channels: { id: string; network: string | null }[] } }).content?.channels ?? [];
    const x = channels.find((c) => c.network === "x");
    expect(x).toBeTruthy();
    const queued = asAllow(await g.client.call(token, { ...CALLS.queue_post, args: { ...CALLS.queue_post.args, channelId: x!.id } }));
    expect(queued.result, JSON.stringify(queued.result)).toMatchObject({ ok: true, simulated: true, notice: SIMULATED_NOTICE });
    const data = queued.result.data as { postId: string; status: string };
    expect(data.status).toBe("scheduled");
    const status = asAllow(await g.client.call(token, { ...CALLS.get_post, args: { postId: data.postId } }));
    expect(status.result).toMatchObject({ ok: true, simulated: true, notice: SIMULATED_NOTICE });
    expect(JSON.stringify(status.result.data)).not.toMatch(/"status":"sent"/);
  });
});

describe("typed reads: an agent that holds queue_post gets the reader's digest and the checked channel values", () => {
  const DIGEST = { title: null, sender: null, summary: "Four social channels.", amounts: [], dates: [] };

  it("list_channels comes back as the digest plus facts: ids, services, networks, no raw names", async () => {
    const mock = createDefaultRegistry({ secrets: {}, fetch: bufferFetch().fetch }).list("mock").filter((c) => c.key === "buffer");
    const g = await setupGateway({ mode: "mock", businessMode: "automated", connectors: mock });
    open = g;
    const read: unknown[] = [];
    g.deps.reader = { digest: async ({ content }) => (read.push(content), DIGEST) };
    const token = await g.token({ allowedTools: ["buffer:*"] });
    const r = asAllow(await g.client.call(token, CALLS.list_channels));
    const data = r.result.data as { untrusted: boolean; quarantined?: boolean; content: unknown; facts?: { channels: { id: string | null; service: string | null; network: string | null; name: string | null }[] } };
    expect(data).toMatchObject({ untrusted: true, quarantined: true, content: DIGEST });
    expect(read).toHaveLength(1);
    expect(data.facts?.channels.length).toBeGreaterThan(0);
    for (const c of data.facts!.channels) {
      expect(c.id).toMatch(/^[A-Za-z0-9_.:-]+$/);
      expect(c.service).toBeTruthy();
    }
    expect(data.facts!.channels.map((c) => c.network)).toContain("x");
    expect(factsProblem(data.facts)).toBeNull();
  });
});

describe("queue_post pre-checks run in the connector, before the vendor", () => {
  /** automated mode: the ask-first rule is out of the way, so what is tested is the connector's own refusals. */
  async function automated(vendor: ReturnType<typeof bufferFetch>) {
    const g = await setupGateway({ mode: "live", businessMode: "automated", connectors: live(vendor.fetch) });
    open = g;
    await connect(g);
    return { g, token: await g.token({ allowedTools: ["buffer:*"] }) };
  }

  it("a picture at a signed, expiring link is refused before any vendor call, with the reason", async () => {
    const vendor = bufferFetch();
    const { g, token } = await automated(vendor);
    const signed = "https://dnznrvs05pmza.cloudfront.net/video/thumb.jpg?_jwt=eyJhbGciOiJIUzI1NiJ9&Expires=1767225600&Signature=abc";
    const r = asAllow(await g.client.call(token, { ...CALLS.queue_post, args: { ...CALLS.queue_post.args, draft: draft({ image: { url: signed, alt: "A shelf" } }) } }));
    expect(r.result).toMatchObject({ ok: false, error: { code: "image_not_lasting" } });
    expect(JSON.stringify(r.result)).toContain("lasting https address");
    expect(vendor.requests).toEqual([]);
  });

  it("over-limit text is fitted to the network before it is sent", async () => {
    const vendor = bufferFetch();
    const { g, token } = await automated(vendor);
    const long = "Gentle skincare for people who read the label. ".repeat(30);
    const r = asAllow(await g.client.call(token, { ...CALLS.queue_post, args: { ...CALLS.queue_post.args, draft: draft({ text: long }) } }));
    expect(r.result.ok, JSON.stringify(r.result)).toBe(true);
    expect(vendor.requests.map((q) => q.op)).toEqual(["Channel", "CreatePost"]);
    const sent = (vendor.requests[1]!.variables.input as { text: string; schedulingType: string; mode: string }).text;
    expect(postTextLength(sent, "x")).toBeLessThanOrEqual(280);
    expect(sent.endsWith(LINK)).toBe(true);
    expect(vendor.requests[1]!.variables.input).toMatchObject({ schedulingType: "automatic", mode: "addToQueue", channelId: CHANNEL });
  });
});

describe("a link first seen in untrusted content is refused", () => {
  it("queue_post with such a link in the draft is denied by the recipient rule and reaches no vendor", async () => {
    const vendor = bufferFetch();
    const g = await setupGateway({ mode: "live", businessMode: "automated", connectors: live(vendor.fetch) });
    open = g;
    await connect(g);
    const hostile = "https://untrusted.example/offer";
    await g.deps.recipients.record(g.businessId, [{ kind: "url", value: hostile }]);
    const token = await g.token({ allowedTools: ["buffer:*"] });
    const r = await g.client.call(token, { ...CALLS.queue_post, args: { ...CALLS.queue_post.args, draft: draft({ link: hostile }) } });
    expect(r.outcome).toBe("deny");
    expect((r as DenyResponse).policyIds).toContain("untrusted-recipient");
    expect(vendor.requests).toEqual([]);
  });
});
