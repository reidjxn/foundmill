/**
 * A post draft's media at the gateway (orchestrator `post-media.ts`; packages/connectors `SERVICE_MEDIA_TOOLS`):
 * - starting a clip or a voiceover spends the founder's money and cannot be undone, so it asks first (Needs you) in
 *   assisted mode, for the platform's own token too;
 * - once approved, the platform token outside any session gets the voiceover file as it came, never a reader's digest
 *   (code stores it, no agent reads it), still inside the envelope and marked simulated in mock mode;
 * - an agent session calling the same tool still gets the reader's digest, never the bytes;
 * - the clip copy (`runway:download_video`) is refused for an agent session and runs for the platform token.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { elevenlabsVoiceMock, runwayMock } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { createModelClient } from "@foundmill/models";
import { createUntrustedReader } from "../untrusted-reader";
import type { AllowResponse, AskResponse, CallResponse } from "../types";
import { setupGateway, type GatewayFixture } from "./harness";

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway({ connectors: [elevenlabsVoiceMock, runwayMock] });
  await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "elevenlabs_voice", status: "mock", authKind: "api_key", accountLabel: "ElevenLabs (mock)" });
  await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "runway", status: "mock", authKind: "api_key", accountLabel: "Runway (mock)" });
}, 120_000);
afterAll(async () => {
  await g.close();
});
beforeEach(() => {
  g.deps.reader = createUntrustedReader(createModelClient({ mode: "mock" }));
});

const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome, JSON.stringify(r).slice(0, 400)).toBe("allow");
  return r as AllowResponse;
};
const asAsk = (r: CallResponse): AskResponse => {
  expect(r.outcome, JSON.stringify(r).slice(0, 400)).toBe("ask");
  return r as AskResponse;
};
const VOICE = "elevenlabs_voice:generate_voiceover";

async function approvedVoiceover(sessionId: string | null, text: string): Promise<AllowResponse> {
  const token = await g.token({ sessionId, allowedTools: [VOICE] });
  const call = { connector: "elevenlabs_voice", tool: "generate_voiceover", args: { text } };
  const asked = asAsk(await g.client.call(token, call));
  expect(asked.approvalId).toBeTruthy();
  await repos.approvals.resolve(g.db, g.businessId, asked.approvalId, { outcome: "approved", byKind: "user" });
  return asAllow(await g.client.call(token, call));
}

describe("a post draft's media at the gateway", () => {
  it("asks first before a clip is started, for the platform's own token", async () => {
    const token = await g.token({ sessionId: null, allowedTools: ["runway:generate_video_from_text"] });
    asAsk(await g.client.call(token, { connector: "runway", tool: "generate_video_from_text", args: { prompt: "A bike being fixed at a front door" } }));
  });

  it("hands the platform token the voiceover file as it came once the founder approved, marked simulated", async () => {
    const res = await approvedVoiceover(null, "Our page is live. Bike repairs at your door.");
    expect(res.result.simulated).toBe(true);
    const envelope = res.result.data as { untrusted: boolean; quarantined?: boolean; content: { base64: string; mime: string; simulated?: boolean } };
    expect(envelope.untrusted).toBe(true);
    expect(envelope.quarantined).toBeUndefined();
    expect(envelope.content.mime).toBe("audio/wav");
    expect(envelope.content.simulated).toBe(true);
    expect(Buffer.from(envelope.content.base64, "base64").subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("still gives an agent session the reader's digest, never the bytes", async () => {
    const res = await approvedVoiceover(await g.newSession(), "Our page is live. Bike repairs at your door, booked in a minute.");
    const envelope = res.result.data as { quarantined?: boolean; content: unknown };
    expect(envelope.quarantined).toBe(true);
    expect(JSON.stringify(envelope.content)).not.toContain("UklGR");
  });

  it("refuses the clip copy to an agent session and runs it for the platform token, with nothing made in mock mode", async () => {
    const call = { connector: "runway", tool: "download_video", args: { taskId: "17f20503-6c24-4c16-946b-35dbbce2af2f" } };
    const refused = await g.client.call(await g.token({ sessionId: await g.newSession(), allowedTools: ["runway:download_video"] }), call);
    expect(refused.outcome).toBe("deny");
    const res = asAllow(await g.client.call(await g.token({ sessionId: null, allowedTools: ["runway:download_video"] }), call));
    expect(res.result.simulated).toBe(true);
    expect(res.result.data).toMatchObject({ ready: false, base64: null, bytes: 0, simulated: true });
  });
});
