import { describe, expect, it, vi } from "vitest";
import { CLOSE_CODES, StreamClient, businessChannel, businessIdOfChannel, isErrorFrame, isEventFrame, isSubscribedFrame, sessionChannel, type WebSocketLike } from "../stream";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string | unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  closeCode: number | undefined;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closeCode = code;
    this.onclose?.({ code, reason });
  }
  frames(): unknown[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

function makeClient(over: Partial<ConstructorParameters<typeof StreamClient>[0]> = {}) {
  FakeSocket.instances = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let id = 0;
  let now = 1000;
  const client = new StreamClient({
    url: "ws://stream.test",
    getToken: () => "tok",
    webSocket: FakeSocket,
    now: () => now,
    setTimeout: (fn, ms) => {
      const t = { fn, ms, id: ++id };
      timers.push(t);
      return t.id;
    },
    clearTimeout: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    ...over,
  });
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const runTimers = () => {
    const due = timers.splice(0, timers.length);
    for (const t of due) t.fn();
  };
  return { client, timers, runTimers, flush, advance: (ms: number) => (now += ms), socket: () => FakeSocket.instances.at(-1)! };
}

describe("StreamClient (apps/stream protocol)", () => {
  it("connects with the token, subscribes once per channel and delivers events", async () => {
    const { client, flush, socket } = makeClient();
    const h1 = vi.fn();
    const h2 = vi.fn();
    const off1 = client.subscribe(businessChannel("00000000-0000-4000-8000-000000000001"), h1);
    client.subscribe("ev:00000000-0000-4000-8000-000000000001", h2);
    await flush();
    const ws = socket();
    expect(ws.url).toBe("ws://stream.test/?token=tok");
    ws.open();
    expect(client.state).toBe("open");
    expect(ws.frames()).toEqual([{ t: "sub", ch: "ev:00000000-0000-4000-8000-000000000001" }]);
    ws.receive({ ch: "ev:00000000-0000-4000-8000-000000000001", e: { type: "cycle.completed", payload: {} } });
    expect(h1).toHaveBeenCalledWith({ type: "cycle.completed", payload: {} });
    expect(h2).toHaveBeenCalledTimes(1);
    ws.receive([{ ch: "ev:00000000-0000-4000-8000-000000000001", e: 1 }, { ch: "ev:00000000-0000-4000-8000-000000000001", e: 2 }]);
    expect(h1).toHaveBeenCalledTimes(3);
    off1();
    expect(ws.frames().filter((f) => (f as { t: string }).t === "unsub")).toEqual([]);
    client.subscribe("as:00000000-0000-4000-8000-000000000002", vi.fn())();
    expect(ws.frames().at(-1)).toEqual({ t: "unsub", ch: "as:00000000-0000-4000-8000-000000000002" });
  });

  it("reconnects with backoff and re-subscribes every channel", async () => {
    const { client, flush, runTimers, socket } = makeClient();
    const statuses: string[] = [];
    client.subscribe(sessionChannel("00000000-0000-4000-8000-000000000003"), vi.fn());
    await flush();
    socket().open();
    socket().close(1006, "lost");
    expect(client.state).toBe("reconnecting");
    runTimers();
    await flush();
    const ws2 = socket();
    expect(ws2).not.toBe(FakeSocket.instances[0]);
    ws2.open();
    expect(ws2.frames()).toEqual([{ t: "sub", ch: "as:00000000-0000-4000-8000-000000000003" }]);
    expect(client.stats.reconnects).toBe(1);
    expect(statuses).toEqual([]);
  });

  it("throttles unfocused channels to bursts and forwards server errors", async () => {
    const onError = vi.fn();
    const { client, flush, socket, runTimers, advance } = makeClient({ onError });
    const h = vi.fn();
    client.subscribe("as:00000000-0000-4000-8000-000000000004", h, { focused: false });
    await flush();
    const ws = socket();
    ws.open();
    expect(ws.frames()[0]).toEqual({ t: "sub", ch: "as:00000000-0000-4000-8000-000000000004", focus: false });
    ws.receive({ ch: "as:00000000-0000-4000-8000-000000000004", e: "a" });
    expect(h).toHaveBeenCalledTimes(1); // first burst at once
    ws.receive({ ch: "as:00000000-0000-4000-8000-000000000004", e: "b" });
    ws.receive({ ch: "as:00000000-0000-4000-8000-000000000004", e: "c" });
    expect(h).toHaveBeenCalledTimes(1);
    advance(300);
    runTimers();
    expect(h).toHaveBeenCalledTimes(3);
    client.setFocus("as:00000000-0000-4000-8000-000000000004", true);
    expect(ws.frames().at(-1)).toEqual({ t: "focus", ch: "as:00000000-0000-4000-8000-000000000004", focused: true });
    ws.receive({ t: "err", ch: "as:x", code: "forbidden", message: "no" });
    expect(onError).toHaveBeenCalledWith({ t: "err", ch: "as:x", code: "forbidden", message: "no" });
    ws.receive({ t: "pong" });
    expect(client.stats.framesIn).toBe(5);
  });

  it("close() stops reconnecting", async () => {
    const { client, flush, socket, timers } = makeClient();
    client.subscribe("ev:00000000-0000-4000-8000-000000000001", vi.fn());
    await flush();
    socket().open();
    client.close();
    expect(client.state).toBe("closed");
    expect(timers.length).toBe(0);
  });

  it("frame guards", () => {
    expect(isEventFrame({ ch: "ev:x", e: null })).toBe(true);
    expect(isEventFrame({ t: "pong" })).toBe(false);
    expect(isErrorFrame({ t: "err", code: "bad_frame", message: "m" })).toBe(true);
    expect(isSubscribedFrame({ t: "subscribed", ch: "ev:x" })).toBe(true);
    expect(isEventFrame({ t: "subscribed", ch: "ev:x" })).toBe(false);
    expect(businessIdOfChannel(BIZ)).toBe("00000000-0000-4000-8000-000000000001");
    expect(businessIdOfChannel("as:00000000-0000-4000-8000-000000000001")).toBeNull();
  });
});

const BIZ = businessChannel("00000000-0000-4000-8000-000000000001");
const OTHER_BIZ = businessChannel("00000000-0000-4000-8000-000000000009");

/** A client that records every channel change (`onChannel`) as "<channel> live|down [resync]". */
function liveClient(over: Partial<ConstructorParameters<typeof StreamClient>[0]> = {}) {
  const changes: string[] = [];
  const made = makeClient({ onChannel: (ch, live, d) => changes.push(`${ch === BIZ ? "biz" : ch === OTHER_BIZ ? "other" : ch} ${live ? "live" : "down"}${d.resync ? " resync" : ""}`), ...over });
  return { ...made, changes };
}

describe("StreamClient channel liveness (audit RES-01/02/03: stale screens after a gap)", () => {
  it("is live only once the server acknowledges the subscription, and comes back after a reconnect with a resync", async () => {
    const { client, flush, runTimers, socket, changes } = liveClient();
    client.subscribe(BIZ, vi.fn());
    await flush();
    socket().open();
    // An open socket is not a live channel: the server has not acknowledged it yet.
    expect(client.state).toBe("open");
    expect(client.isLive(BIZ)).toBe(false);
    socket().receive({ t: "subscribed", ch: BIZ });
    expect(client.isLive(BIZ)).toBe(true);
    expect(changes).toEqual(["biz live"]); // the first time: what the page just loaded is current
    socket().receive({ t: "subscribed", ch: BIZ }); // a repeated acknowledgement changes nothing
    expect(changes).toEqual(["biz live"]);

    socket().close(1006, "lost");
    expect(client.isLive(BIZ)).toBe(false);
    runTimers();
    await flush();
    socket().open();
    expect(socket().frames()).toEqual([{ t: "sub", ch: BIZ }]);
    socket().receive({ t: "subscribed", ch: BIZ });
    // Events sent while the socket was down are not replayed: the app refetches.
    expect(changes).toEqual(["biz live", "biz down", "biz live resync"]);
  });

  it("asks again for a refusal that can heal, with backoff on the same socket, and stays down until acknowledged", async () => {
    const onError = vi.fn();
    const { client, flush, timers, socket, changes } = liveClient({ onError });
    client.subscribe(BIZ, vi.fn());
    await flush();
    const ws = socket();
    ws.open();
    ws.receive({ t: "err", ch: BIZ, code: "unavailable", message: "membership check unavailable" });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(client.isLive(BIZ)).toBe(false);
    const retry = timers.find((t) => t.ms < 20_000)!;
    expect(retry.ms).toBeGreaterThanOrEqual(500);
    expect(retry.ms).toBeLessThanOrEqual(1_000);
    timers.splice(timers.indexOf(retry), 1);
    retry.fn();
    expect(ws.frames()).toEqual([{ t: "sub", ch: BIZ }, { t: "sub", ch: BIZ }]);
    // A second refusal backs off further.
    ws.receive({ t: "err", ch: BIZ, code: "unavailable", message: "membership check unavailable" });
    const second = timers.find((t) => t.ms < 20_000)!;
    expect(second.ms).toBeGreaterThanOrEqual(1_000);
    expect(second.ms).toBeLessThanOrEqual(2_000);
    timers.splice(timers.indexOf(second), 1);
    second.fn();
    ws.receive({ t: "subscribed", ch: BIZ });
    expect(changes).toEqual(["biz live resync"]);
    expect(socket()).toBe(ws); // healed without a reconnect
  });

  it("never asks again for a malformed channel", async () => {
    const { client, flush, timers, socket } = liveClient();
    client.subscribe("ev:not-a-uuid", vi.fn());
    await flush();
    socket().open();
    const before = timers.length;
    socket().receive({ t: "err", ch: "ev:not-a-uuid", code: "invalid_channel", message: "unknown channel" });
    expect(timers.length).toBe(before);
    expect(client.isLive("ev:not-a-uuid")).toBe(false);
  });

  it("reports a channel the tab leaves as down, and one it comes back to with a resync", async () => {
    const { client, flush, socket, changes } = liveClient();
    const offBiz = client.subscribe(BIZ, vi.fn());
    await flush();
    const ws = socket();
    ws.open();
    ws.receive({ t: "subscribed", ch: BIZ });
    // Moving to another business in the same tab: X is unsubscribed while Y is on screen.
    client.subscribe(OTHER_BIZ, vi.fn());
    offBiz();
    ws.receive({ t: "subscribed", ch: OTHER_BIZ });
    expect(ws.frames().at(-1)).toEqual({ t: "unsub", ch: BIZ });
    // Back to X: subscribed again on the same socket; what changed meanwhile was never delivered.
    client.subscribe(BIZ, vi.fn());
    expect(ws.frames().at(-1)).toEqual({ t: "sub", ch: BIZ });
    ws.receive({ t: "subscribed", ch: BIZ });
    expect(changes).toEqual(["biz live", "biz down", "other live", "biz live resync"]);
  });

  it("replaces a socket that stops answering pings (a stalled link) and reports its channels down", async () => {
    const { client, flush, runTimers, advance, socket, changes, timers } = liveClient({ pingMs: 20_000 });
    client.subscribe(BIZ, vi.fn());
    await flush();
    const ws = socket();
    ws.open();
    ws.receive({ t: "subscribed", ch: BIZ });
    advance(20_000);
    runTimers();
    expect(ws.frames().at(-1)).toEqual({ t: "ping" });
    ws.receive({ t: "pong" });
    advance(20_000);
    runTimers(); // answered: ping again
    expect(ws.frames().filter((f) => (f as { t: string }).t === "ping")).toHaveLength(2);
    advance(20_000);
    runTimers(); // no frame since the last ping: the link is dead even though the socket says open
    expect(ws.readyState).toBe(3);
    expect(ws.closeCode).toBe(CLOSE_CODES.heartbeatTimeout);
    expect(client.state).toBe("reconnecting");
    expect(changes).toEqual(["biz live", "biz down"]);
    expect(timers.length).toBe(1); // the reconnect
    runTimers();
    await flush();
    socket().open();
    socket().receive({ t: "subscribed", ch: BIZ });
    expect(changes.at(-1)).toBe("biz live resync");
  });

  it("checkConnection probes a socket that may have slept with a short deadline, and retries a pending reconnect at once", async () => {
    const { client, flush, runTimers, advance, socket, timers, changes } = liveClient({ pingMs: 20_000, probeMs: 5_000 });
    client.subscribe(BIZ, vi.fn());
    await flush();
    const ws = socket();
    ws.open();
    ws.receive({ t: "subscribed", ch: BIZ });
    advance(1_000);
    client.checkConnection();
    expect(ws.frames().at(-1)).toEqual({ t: "ping" });
    expect(timers.map((t) => t.ms)).toEqual([5_000]);
    ws.receive({ t: "pong" }); // awake: keeps the socket
    runTimers();
    expect(ws.readyState).toBe(1);
    advance(1_000);
    client.checkConnection();
    advance(5_000);
    runTimers(); // no answer within the probe: replaced now, not at the next heartbeat
    expect(ws.readyState).toBe(3);
    expect(changes).toEqual(["biz live", "biz down"]);
    // The reconnect is waiting for its backoff; the tab coming back to view tries it at once.
    expect(client.state).toBe("reconnecting");
    client.checkConnection();
    await flush();
    expect(socket()).not.toBe(ws);
  });
});
