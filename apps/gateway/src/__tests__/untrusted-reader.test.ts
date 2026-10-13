/**
 * The quarantined reader (BUILD §9.8 step 2; audit SECX-8): a session that holds tools which contact people, spend money or
 * cannot be undone never receives third-party text raw. A model with no tools reads it and the agent gets typed fields
 * only; if the reader fails the agent gets nothing; a session with no such tools still reads the content itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createModelClient } from "@foundmill/models";
import { createUntrustedReader, grantsOutboundTools, UntrustedDigest, type UntrustedReader } from "../untrusted-reader";
import { setupGateway, TEST_CONNECTOR, UNTRUSTED_EMAIL, type GatewayFixture } from "./harness";
import type { AllowResponse, CallResponse } from "../types";

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway();
}, 120_000);
afterAll(async () => {
  await g.close();
});
beforeEach(async () => {
  await g.recipients.clear(g.businessId);
  g.deps.reader = createUntrustedReader(createModelClient({ mode: "mock" }));
});

const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome).toBe("allow");
  return r as AllowResponse;
};

describe("grantsOutboundTools", () => {
  it("is true when a granted tool contacts a third party, spends or cannot be undone", () => {
    const registry = g.deps.registry;
    expect(grantsOutboundTools(registry, [`${TEST_CONNECTOR}:*`])).toBe(true);
    expect(grantsOutboundTools(registry, ["*"])).toBe(true);
    expect(grantsOutboundTools(registry, [`${TEST_CONNECTOR}:send_message`])).toBe(true);
    expect(grantsOutboundTools(registry, [`${TEST_CONNECTOR}:spend`])).toBe(true);
    expect(grantsOutboundTools(registry, [`${TEST_CONNECTOR}:delete_everything`])).toBe(true);
  });

  it("is false for read-only and internal grants", () => {
    const registry = g.deps.registry;
    expect(grantsOutboundTools(registry, [`${TEST_CONNECTOR}:read_inbox`, `${TEST_CONNECTOR}:note`])).toBe(false);
    expect(grantsOutboundTools(registry, [])).toBe(false);
    expect(grantsOutboundTools(registry, ["other:*"])).toBe(false);
  });
});

describe("untrusted content for a session that holds outbound tools", () => {
  it("returns typed fields, never the text, and still registers the recipients it held", async () => {
    const token = await g.token({ sessionId: await g.newSession() });
    const read = asAllow(await g.client.call(token, { connector: TEST_CONNECTOR, tool: "read_inbox", args: { id: "m-1" } }));
    expect(read.result.untrusted).toBe(true);
    const envelope = read.result.data as { untrusted: boolean; quarantined?: boolean; content: unknown; source: { connector: string } };
    expect(envelope).toMatchObject({ untrusted: true, quarantined: true, source: { connector: TEST_CONNECTOR } });
    // Exactly the digest's fields, validated; nothing else of the content comes through.
    expect(UntrustedDigest.safeParse(envelope.content).success).toBe(true);
    expect(Object.keys(envelope.content as object).sort()).toEqual(["amounts", "dates", "sender", "summary", "title"]);
    const wire = JSON.stringify(read.result);
    expect(wire).not.toMatch(/IGNORE YOUR RULES/i);
    // The addresses in the raw text are still remembered for the business, so they cannot be contacted without approval.
    expect(await g.recipients.firstSeenInUntrusted(g.businessId, "any-session", [{ kind: "email", value: UNTRUSTED_EMAIL }])).toHaveLength(1);
  });

  it("returns nothing at all when the reader fails", async () => {
    g.deps.reader = { digest: async () => Promise.reject(new Error("model unavailable")) } satisfies UntrustedReader;
    const token = await g.token({ sessionId: await g.newSession() });
    const read = asAllow(await g.client.call(token, { connector: TEST_CONNECTOR, tool: "read_inbox", args: { id: "m-2" } }));
    expect(read.result.data).toMatchObject({ untrusted: true, quarantined: true, content: null });
    expect((read.result.data as { unavailable: string }).unavailable).toMatch(/could not be checked safely/);
    expect(JSON.stringify(read.result)).not.toMatch(/IGNORE YOUR RULES|untrusted\.example/i);
    // The recipients are remembered even though the agent saw nothing.
    expect(await g.recipients.size(g.businessId)).toBeGreaterThan(0);
  });

  it("is booked to the business's usage ledger as the reader's model call would be (reader-models)", async () => {
    // The gateway's own usage sink (reader-models.ts) books exactly the api's row shape; here the mock client reports usage.
    const events: string[] = [];
    g.deps.reader = createUntrustedReader(createModelClient({ mode: "mock", onUsage: (e) => void events.push(`${e.route}:${e.attribution?.businessId}:${e.attribution?.kind}`) }));
    const token = await g.token({ sessionId: await g.newSession() });
    asAllow(await g.client.call(token, { connector: TEST_CONNECTOR, tool: "read_inbox", args: { id: "m-3" } }));
    expect(events).toEqual([`quarantinedReader:${g.businessId}:quarantined_reader`]);
  });
});

describe("untrusted content for a session with no outbound tools", () => {
  it("still reads the content itself", async () => {
    const token = await g.token({ sessionId: await g.newSession(), allowedTools: [`${TEST_CONNECTOR}:read_inbox`] });
    const read = asAllow(await g.client.call(token, { connector: TEST_CONNECTOR, tool: "read_inbox", args: { id: "m-4" } }));
    const envelope = read.result.data as { quarantined?: boolean; content: { from: string; body: string } };
    expect(envelope.quarantined).toBeUndefined();
    expect(envelope.content.from).toBe(UNTRUSTED_EMAIL);
    expect(envelope.content.body).toMatch(/IGNORE YOUR RULES/);
  });
});
