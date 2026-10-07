/**
 * A minimal Hocuspocus wire-protocol client for tests, speaking to the real server over Node 22's global
 * WebSocket (the `@hocuspocus/provider` package is not a dependency of this app). It implements exactly what the
 * provider does for one document: Auth(Token) → Authenticated/PermissionDenied → SyncStep1/SyncStep2/Update
 * exchange (y-protocols/sync framing) → outgoing updates on every local change. Awareness, stateless and ping
 * messages are ignored. The lib0 varint/varstring/varuint8array codec is reimplemented in a few lines.
 */
import * as Y from "yjs";

// --- lib0-compatible codec ------------------------------------------------------------------------------------------

export class Encoder {
  private bytes: number[] = [];
  writeVarUint(num: number): this {
    while (num > 127) {
      this.bytes.push(0x80 | (num & 127));
      num = Math.floor(num / 128);
    }
    this.bytes.push(num & 127);
    return this;
  }
  writeUint8Array(arr: Uint8Array): this {
    for (const b of arr) this.bytes.push(b);
    return this;
  }
  writeVarUint8Array(arr: Uint8Array): this {
    this.writeVarUint(arr.byteLength);
    return this.writeUint8Array(arr);
  }
  writeVarString(s: string): this {
    return this.writeVarUint8Array(new TextEncoder().encode(s));
  }
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export class Decoder {
  pos = 0;
  constructor(readonly arr: Uint8Array) {}
  hasContent(): boolean {
    return this.pos < this.arr.length;
  }
  readVarUint(): number {
    let num = 0;
    let mult = 1;
    for (;;) {
      const r = this.arr[this.pos++];
      if (r === undefined) throw new Error("decoder: unexpected end of message");
      num += (r & 127) * mult;
      mult *= 128;
      if (r < 128) return num;
    }
  }
  readVarUint8Array(): Uint8Array {
    const len = this.readVarUint();
    const out = this.arr.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  readVarString(): string {
    return new TextDecoder().decode(this.readVarUint8Array());
  }
}

// --- message constants (mirror @hocuspocus/common + y-protocols/sync) -------------------------------------------------

export const MSG = { Sync: 0, Awareness: 1, Auth: 2, QueryAwareness: 3, SyncReply: 4, Stateless: 5, BroadcastStateless: 6, Close: 7, SyncStatus: 8, Ping: 9, Pong: 10 } as const;
export const AUTH = { Token: 0, PermissionDenied: 1, Authenticated: 2 } as const;
export const SYNC = { Step1: 0, Step2: 1, Update: 2 } as const;

export type ClientStatus = "connecting" | "authenticated" | "denied" | "closed";

export interface RawClientOptions {
  /** Yjs doc to drive (default: a fresh one, so offline edits made before connecting are synced on connect). */
  doc?: Y.Doc;
  providerVersion?: string;
}

/** One document connection. */
export class RawHocuspocusClient {
  readonly doc: Y.Doc;
  status: ClientStatus = "connecting";
  scope: "readonly" | "read-write" | null = null;
  deniedReason: string | null = null;
  /** SyncStatus acknowledgements received (true = applied, false = rejected because read-only). */
  readonly syncStatuses: boolean[] = [];
  private ws: WebSocket | null = null;
  private synced = false;
  private readonly waiters: Array<() => void> = [];
  private readonly origin = Symbol("remote");

  constructor(
    readonly url: string,
    readonly documentName: string,
    readonly token: string,
    options: RawClientOptions = {},
  ) {
    this.doc = options.doc ?? new Y.Doc();
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this.origin || this.status !== "authenticated" || this.scope === null) return;
      this.send(new Encoder().writeVarString(this.documentName).writeVarUint(MSG.Sync).writeVarUint(SYNC.Update).writeVarUint8Array(update).toUint8Array());
    });
  }

  /** Opens the socket and authenticates; resolves with the outcome. */
  connect(): Promise<"authenticated" | "denied"> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      const settle = (outcome: "authenticated" | "denied") => resolve(outcome);
      ws.addEventListener("open", () => {
        this.send(new Encoder().writeVarString(this.documentName).writeVarUint(MSG.Auth).writeVarUint(AUTH.Token).writeVarString(this.token).writeVarString("test-client").toUint8Array());
      });
      ws.addEventListener("message", (event) => {
        const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : null;
        if (!data) return;
        this.handle(data, settle);
      });
      ws.addEventListener("close", () => {
        if (this.status === "connecting") reject(new Error("socket closed before authentication"));
        this.status = "closed";
        this.notify();
      });
      ws.addEventListener("error", () => {
        if (this.status === "connecting") reject(new Error("socket error before authentication"));
      });
    });
  }

  private handle(data: Uint8Array, settle: (o: "authenticated" | "denied") => void) {
    const dec = new Decoder(data);
    const name = dec.readVarString();
    if (name !== this.documentName && !name.startsWith(`${this.documentName}\0`)) return;
    const type = dec.readVarUint();
    switch (type) {
      case MSG.Auth: {
        const sub = dec.readVarUint();
        if (sub === AUTH.Authenticated) {
          this.scope = dec.readVarString() === "readonly" ? "readonly" : "read-write";
          this.status = "authenticated";
          // Begin the sync handshake: send our state vector; the server answers with its SyncStep2 and asks for ours.
          this.send(new Encoder().writeVarString(this.documentName).writeVarUint(MSG.Sync).writeVarUint(SYNC.Step1).writeVarUint8Array(Y.encodeStateVector(this.doc)).toUint8Array());
          settle("authenticated");
        } else if (sub === AUTH.PermissionDenied) {
          this.deniedReason = dec.readVarString();
          this.status = "denied";
          settle("denied");
        }
        break;
      }
      case MSG.Sync:
      case MSG.SyncReply: {
        const sub = dec.readVarUint();
        if (sub === SYNC.Step1) {
          const sv = dec.readVarUint8Array();
          this.send(new Encoder().writeVarString(this.documentName).writeVarUint(MSG.Sync).writeVarUint(SYNC.Step2).writeVarUint8Array(Y.encodeStateAsUpdate(this.doc, sv)).toUint8Array());
        } else if (sub === SYNC.Step2 || sub === SYNC.Update) {
          Y.applyUpdate(this.doc, dec.readVarUint8Array(), this.origin);
          if (sub === SYNC.Step2) this.synced = true;
        }
        this.notify();
        break;
      }
      case MSG.SyncStatus:
        this.syncStatuses.push(dec.readVarUint() === 1);
        this.notify();
        break;
      case MSG.Ping:
        this.send(new Encoder().writeVarString(this.documentName).writeVarUint(MSG.Pong).toUint8Array());
        break;
      default:
        break;
    }
  }

  private send(bytes: Uint8Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(bytes);
  }

  private notify() {
    const ws = this.waiters.splice(0);
    for (const w of ws) w();
  }

  /** Resolves once the server's SyncStep2 has been applied (initial content received). */
  waitForSync(timeoutMs = 5000): Promise<void> {
    return this.waitUntil(() => this.synced, timeoutMs, "initial sync");
  }

  /** Polls a predicate on every inbound message (and every 20 ms) until it holds. */
  waitUntil(pred: () => boolean, timeoutMs = 5000, what = "condition"): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (pred()) {
          clearInterval(timer);
          resolve();
          return true;
        }
        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`timed out waiting for ${what}`));
          return true;
        }
        return false;
      };
      const timer = setInterval(check, 20);
      if (!check()) this.waiters.push(() => void check());
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const ws = this.ws;
      if (!ws || ws.readyState === WebSocket.CLOSED) return resolve();
      ws.addEventListener("close", () => resolve(), { once: true });
      this.send(new Encoder().writeVarString(this.documentName).writeVarUint(MSG.Close).toUint8Array());
      ws.close(1000, "test done");
    });
  }
}

/** Convenience: the fragment's text (all text nodes concatenated per block, blocks joined by "\n"). */
export function blockTexts(doc: Y.Doc, field = "default"): string[] {
  return doc.getXmlFragment(field).toArray().map((item) => (item instanceof Y.XmlElement || item instanceof Y.XmlText ? item.toString().replace(/<[^>]+>/g, "") : ""));
}

export async function until(pred: () => boolean | Promise<boolean>, timeoutMs = 5000, what = "condition"): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await pred()) return;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
