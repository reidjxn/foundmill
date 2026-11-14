/**
 * A large untrusted tool result (a 4 MB base64 media field beside a little text) goes through the gateway in well under
 * a second, on the agent path (the reader's digest) and on the platform path (the file as it came). The address
 * register still sees the text beside the bytes, and the agent still gets only the digest. Regression: the email scan
 * of untrusted content was quadratic in a run of base64 characters, so a short WAV of silence took 5 to 13 seconds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildLiveConnector, buildMockConnector, defineTool, mockHealth, mockIntegrationRecord, type Connector } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { createModelClient } from "@foundmill/models";
import { createUntrustedReader, type UntrustedReader } from "../untrusted-reader";
import type { AllowResponse, CallResponse } from "../types";
import { setupGateway, TEST_CONNECTOR, type GatewayFixture } from "./harness";

const KEY = "bigmedia";
const FOUR_MB = 4 * 1024 * 1024;
/** One run of "A": the shape of silence in base64, the worst case for the old scan. */
const SILENCE = "A".repeat(FOUR_MB);
const NEARBY = "media-questions@northwind.example";

function bigMediaConnector(): Connector {
  const tools = [
    defineTool({
      name: "fetch_media",
      description: "Answers with a large media file as base64, and a note beside it.",
      input: z.object({}),
      output: z.object({ mime: z.string(), base64: z.string(), note: z.string() }),
      hints: {},
      untrusted: "api",
      untrustedRef: () => "media",
    }),
  ] as const;
  const spec = {
    key: KEY,
    displayName: "Big media",
    phase: 1 as const,
    auth: { kind: "api_key" as const },
    tools,
    rateLimits: { perMinute: 1000 },
    connect: async (businessId: string) => mockIntegrationRecord(KEY, businessId),
    healthcheck: async () => mockHealth(KEY),
    handlers: { fetch_media: async () => ({ mime: "audio/wav", base64: SILENCE, note: `Questions: ${NEARBY}` }) },
  };
  const mock = buildMockConnector(spec);
  return buildLiveConnector(spec, mock);
}

let g: GatewayFixture;
const shown: unknown[] = [];
beforeAll(async () => {
  g = await setupGateway({ connectors: [bigMediaConnector()] });
  await repos.integrations.upsert(g.db, g.businessId, { connectorKey: KEY, status: "mock", authKind: "api_key", accountLabel: "Big media" });
}, 120_000);
afterAll(async () => {
  await g.close();
});
beforeEach(async () => {
  shown.length = 0;
  await g.recipients.clear(g.businessId);
  const reader = createUntrustedReader(createModelClient({ mode: "mock" }));
  g.deps.reader = { digest: async (input) => (shown.push(input.content), reader.digest(input)) } satisfies UntrustedReader;
});

const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome, JSON.stringify(r).slice(0, 300)).toBe("allow");
  return r as AllowResponse;
};
const timed = async <T>(fn: () => Promise<T>): Promise<{ ms: number; out: T }> => {
  const started = performance.now();
  const out = await fn();
  return { ms: performance.now() - started, out };
};

describe("a 4 MB untrusted media result", () => {
  it("reaches an agent session as the reader's digest in well under a second; the reader is shown the text, not the bytes", async () => {
    // The session also holds an outbound tool, so it never reads third-party content raw.
    const token = await g.token({ sessionId: await g.newSession(), allowedTools: [`${KEY}:fetch_media`, `${TEST_CONNECTOR}:send_message`] });
    const { ms, out } = await timed(() => g.client.call(token, { connector: KEY, tool: "fetch_media", args: {} }));
    expect(ms).toBeLessThan(1000);
    const envelope = asAllow(out).result.data as { quarantined?: boolean; content: unknown };
    expect(envelope.quarantined).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain("AAAAAAAAAAAAAAAA");
    // The reader saw the note, and a note of the bytes in place of them.
    expect(shown).toHaveLength(1);
    expect(JSON.stringify(shown[0])).toContain(NEARBY);
    expect(JSON.stringify(shown[0]).length).toBeLessThan(1000);
    // The register still saw the address beside the bytes.
    expect(await g.recipients.firstSeenInUntrusted(g.businessId, "any-session", [{ kind: "email", value: NEARBY }])).toHaveLength(1);
  });

  it("reaches the platform token as it came in well under a second", async () => {
    const token = await g.token({ sessionId: null, allowedTools: [`${KEY}:fetch_media`] });
    const { ms, out } = await timed(() => g.client.call(token, { connector: KEY, tool: "fetch_media", args: {} }));
    expect(ms).toBeLessThan(1000);
    const envelope = asAllow(out).result.data as { quarantined?: boolean; content: { base64: string } };
    expect(envelope.quarantined).toBeUndefined();
    expect(envelope.content.base64.length).toBe(FOUR_MB);
    expect(shown).toHaveLength(0);
    expect(await g.recipients.firstSeenInUntrusted(g.businessId, "any-session", [{ kind: "email", value: NEARBY }])).toHaveLength(1);
  });
});
