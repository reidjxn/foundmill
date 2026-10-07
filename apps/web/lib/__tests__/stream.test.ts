import { describe, expect, it, vi } from "vitest";
import { StreamClient, businessChannel, isErrorFrame, isEventFrame, sessionChannel, type WebSocketLike } from "../stream";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string | unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
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
  });
});
