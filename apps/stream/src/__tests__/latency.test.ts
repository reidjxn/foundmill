/**
 * AC-11.6.1 (on the in-memory Redis fake): 16 concurrent agent session streams into one tab with < 150 ms median
 * latency from publish to handler. Each mock agent publishes stdout chunks and progress at its own cadence.
 */
import { publishSessionEvent, type SessionEvent } from "@foundmill/events";
import { fixtureId } from "@foundmill/events/testing/fixtures";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { StreamClient, type WebSocketLike } from "../client";
import { createMemoryAuthorizer } from "../authorize";
import { sessionChannel } from "../protocol";
import { BUSINESS_A, devToken, median, percentile, startTestServer, USER_A, waitFor } from "./helpers";

const WS = WebSocket as unknown as new (url: string) => WebSocketLike;
const SESSIONS = Array.from({ length: 16 }, (_, i) => fixtureId(`ac-11-6-1-session-${i}`));

describe("AC-11.6.1: 16 concurrent session streams", () => {
  it("streams 16 mock agents to one tab with < 150 ms median event latency", async () => {
    const t = await startTestServer({
      authorizer: createMemoryAuthorizer({ members: { [USER_A]: [BUSINESS_A] }, sessions: Object.fromEntries(SESSIONS.map((s) => [s, BUSINESS_A])) }),
    });
    const client = new StreamClient({ url: t.url, getToken: () => devToken(USER_A), webSocket: WS });
    const latencies: number[] = [];
    const perSession = new Map<string, number>();
    try {
      for (const s of SESSIONS) {
        perSession.set(s, 0);
        client.subscribe(sessionChannel(s), (e) => {
          const ev = e as SessionEvent;
          const sentAt = ev.kind === "stdout" ? Number(ev.text.split("|")[1]) : ev.kind === "progress" ? Number(ev.etaAt ? 0 : 0) : NaN;
          if (!Number.isNaN(sentAt) && sentAt > 0) latencies.push(performance.now() - sentAt);
          perSession.set(s, perSession.get(s)! + 1);
        });
      }
      await waitFor(() => t.server.subscriptions()[0]?.channels.length === 16, 3_000, "16 subscriptions");
      expect(t.server.hub.readerCount).toBe(16);

      const PER_SESSION = 30;
      const publishers = SESSIONS.map(async (s, idx) => {
        for (let i = 0; i < PER_SESSION; i++) {
          const now = performance.now();
          await publishSessionEvent(t.redis, s, {
            kind: "stdout",
            at: new Date().toISOString(),
            channel: "stdout",
            text: `agent ${idx} line ${i}|${now}`,
            command: "pnpm test",
          });
          if (i % 10 === 9) {
            await publishSessionEvent(t.redis, s, {
              kind: "progress",
              at: new Date().toISOString(),
              progress: 0.2 * ((i + 1) / PER_SESSION),
              planStepsDone: i + 1,
              planSteps: PER_SESSION,
              acceptanceTestsPassing: 0,
              acceptanceTests: 4,
              reviewPassed: false,
              merged: false,
              etaAt: null,
            });
          }
          await new Promise((r) => setTimeout(r, 15 + (idx % 5) * 3));
        }
      });
      await Promise.all(publishers);
      const expected = PER_SESSION + PER_SESSION / 10;
      await waitFor(() => [...perSession.values()].every((n) => n === expected), 10_000, "every session fully delivered");

      expect(latencies).toHaveLength(16 * PER_SESSION);
      const med = median(latencies);
      const p95 = percentile(latencies, 95);
      if (process.env.STREAM_LATENCY_LOG) console.warn(`[stream] AC-11.6.1 latency over ${latencies.length} events: median ${med.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
      expect(med, `median ${med.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`).toBeLessThan(150);
      expect(p95).toBeLessThan(500);
      expect(t.metrics.get("events_dropped_total")).toBe(0);
      expect(t.metrics.get("events_in_total")).toBe(16 * expected);
    } finally {
      client.close();
      await t.close();
    }
  }, 60_000);
});
