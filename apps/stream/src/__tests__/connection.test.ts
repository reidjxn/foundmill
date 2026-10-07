/** OutboundQueue unit tests with a fake socket and a manual clock: coalescing ticks, shedding order, slow-consumer close. */
import { describe, expect, it, vi } from "vitest";
import { OutboundQueue, WS_OPEN, type SocketLike } from "../connection";
import { Metrics } from "../metrics";
import { CLOSE_CODES } from "../protocol";

class FakeSocket implements SocketLike {
  readyState = WS_OPEN;
  bufferedAmount = 0;
  sent: string[] = [];
  closedWith: [number?, string?] | null = null;
  terminated = false;
  send(data: string, cb?: (err?: Error) => void): void {
    this.sent.push(data);
    cb?.();
  }
  close(code?: number, reason?: string): void {
    this.closedWith = [code, reason];
    this.readyState = 3;
  }
  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
  }
}

const ev = (i: number) => JSON.stringify({ i });

describe("OutboundQueue", () => {
  it("sends immediately when idle and coalesces the rest of the tick into one array frame", () => {
    vi.useFakeTimers();
    try {
      const sock = new FakeSocket();
      const q = new OutboundQueue(sock, { framesPerSecond: 20, now: () => Date.now() });
      q.push("as:a", ev(1));
      expect(sock.sent).toHaveLength(1);
      expect(JSON.parse(sock.sent[0]!)).toEqual({ ch: "as:a", e: { i: 1 } });
      for (let i = 2; i <= 10; i++) q.push("as:a", ev(i));
      expect(sock.sent).toHaveLength(1);
      expect(q.size).toBe(9);
      vi.advanceTimersByTime(49);
      expect(sock.sent).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(sock.sent).toHaveLength(2);
      expect(JSON.parse(sock.sent[1]!)).toEqual(Array.from({ length: 9 }, (_, k) => ({ ch: "as:a", e: { i: k + 2 } })));
      expect(q.batches).toBe(1);
      expect(q.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never exceeds the frame rate under a sustained flood", () => {
    vi.useFakeTimers();
    try {
      const sock = new FakeSocket();
      const q = new OutboundQueue(sock, { framesPerSecond: 20, now: () => Date.now() });
      for (let ms = 0; ms < 1000; ms++) {
        q.push("as:a", ev(ms));
        vi.advanceTimersByTime(1);
      }
      expect(sock.sent.length).toBeLessThanOrEqual(21);
      expect(sock.sent.length).toBeGreaterThanOrEqual(19);
      const delivered = sock.sent.flatMap((f) => {
        const parsed = JSON.parse(f) as { e: { i: number } } | { e: { i: number } }[];
        return Array.isArray(parsed) ? parsed : [parsed];
      });
      expect(delivered.map((d) => d.e.i)).toEqual(Array.from({ length: delivered.length }, (_, i) => i));
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds frames while the socket is above the high-water mark and sheds unfocused session events first", () => {
    vi.useFakeTimers();
    try {
      const sock = new FakeSocket();
      const metrics = new Metrics();
      const dropped: string[] = [];
      const q = new OutboundQueue(sock, { maxQueue: 6, highWaterBytes: 100, slowCloseMs: 10_000, metrics, now: () => Date.now(), onDrop: (ch) => dropped.push(ch) });
      q.focused.add("as:focused");
      sock.bufferedAmount = 500; // the client is not reading
      q.push("ev:biz", ev(1));
      q.push("as:focused", ev(2));
      q.push("as:idle", ev(3));
      q.push("as:idle", ev(4));
      q.push("as:focused", ev(5));
      q.push("ev:biz", ev(6));
      expect(sock.sent).toHaveLength(0);
      expect(q.size).toBe(6);
      q.push("as:idle", ev(7)); // over capacity: oldest unfocused session event goes
      expect(dropped).toEqual(["as:idle"]);
      q.push("as:idle", ev(8));
      q.push("as:idle", ev(9));
      expect(dropped).toEqual(["as:idle", "as:idle", "as:idle"]);
      // Keep flooding with business events: the remaining idle entries go first, then the focused session, never ev:.
      q.push("ev:biz", ev(10));
      q.push("ev:biz", ev(11));
      q.push("ev:biz", ev(12));
      expect(dropped.slice(3)).toEqual(["as:idle", "as:idle", "as:focused"]);
      q.push("ev:biz", ev(13));
      expect(dropped[dropped.length - 1]).toBe("as:focused");
      expect(dropped).not.toContain("ev:biz");
      expect(metrics.get("events_dropped_total")).toBe(dropped.length);
      expect(q.dropped).toBe(dropped.length);
      // Client catches up: the tick flushes what is left, business events intact and in order.
      sock.bufferedAmount = 0;
      vi.advanceTimersByTime(50);
      expect(sock.sent).toHaveLength(1);
      const frame = JSON.parse(sock.sent[0]!) as { ch: string; e: { i: number } }[];
      expect(frame.filter((f) => f.ch === "ev:biz").map((f) => f.e.i)).toEqual([1, 6, 10, 11, 12, 13]);
      expect(metrics.get("queued_frames")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a consumer that stays above the high-water mark for too long", () => {
    vi.useFakeTimers();
    try {
      const sock = new FakeSocket();
      const metrics = new Metrics();
      const q = new OutboundQueue(sock, { highWaterBytes: 10, slowCloseMs: 300, metrics, now: () => Date.now() });
      sock.bufferedAmount = 50;
      q.push("as:a", ev(1));
      vi.advanceTimersByTime(250);
      expect(sock.closedWith).toBeNull();
      vi.advanceTimersByTime(100);
      expect(sock.closedWith?.[0]).toBe(CLOSE_CODES.tooSlow);
      expect(metrics.get("slow_consumers_closed_total")).toBe(1);
      expect(q.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("purges a channel after unsubscribe and ignores pushes once closed", () => {
    vi.useFakeTimers();
    try {
      const sock = new FakeSocket();
      const q = new OutboundQueue(sock, { now: () => Date.now() });
      q.push("as:a", ev(1));
      q.push("as:a", ev(2));
      q.push("as:b", ev(3));
      q.purge("as:a");
      expect(q.size).toBe(1);
      vi.advanceTimersByTime(50);
      expect(JSON.parse(sock.sent[1]!)).toEqual({ ch: "as:b", e: { i: 3 } });
      q.close();
      q.push("as:b", ev(4));
      vi.advanceTimersByTime(100);
      expect(sock.sent).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
