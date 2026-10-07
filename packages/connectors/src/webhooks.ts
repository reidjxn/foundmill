/**
 * Shared webhook plumbing (BUILD §13.1 `webhooks`, docs/ARCHITECTURE.md §8): raw-body reading that leaves
 * the Request reusable, constant-time comparisons, HMAC helpers, timestamp tolerance and a replay guard.
 * Vendor-specific schemes live in each connector's `webhooks.ts`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { isUuid } from "@foundmill/shared";

export const WEBHOOK_BASE = "/webhooks";

/** `apps/ingest` mounts every connector webhook at `/webhooks/<key>/:businessId`. */
export const webhookPath = (connectorKey: string, suffix?: string): string => `${WEBHOOK_BASE}/${connectorKey}${suffix ? `-${suffix}` : ""}/:businessId`;

/** Read the raw body from a clone, so `verify` and `normalise` can both consume the same Request. */
export async function rawBody(req: Request): Promise<string> {
  return req.clone().text();
}

export async function rawBodyBuffer(req: Request): Promise<Buffer> {
  return Buffer.from(await req.clone().arrayBuffer());
}

export const header = (req: Request, name: string): string | null => req.headers.get(name);

export function hmacSha256(secret: string | Buffer, data: string | Buffer, encoding: "hex" | "base64" = "hex"): string {
  return createHmac("sha256", secret).update(data).digest(encoding);
}

/** Constant-time string comparison; false (not an exception) on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function safeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Default replay tolerance for timestamped signatures (Stripe's library default is 5 minutes). */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function withinTolerance(timestampSeconds: number, nowMs: number, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS): boolean {
  if (!Number.isFinite(timestampSeconds)) return false;
  return Math.abs(nowMs / 1000 - timestampSeconds) <= toleranceSeconds;
}

/**
 * Remembers delivery ids for `ttlMs` so a captured, correctly signed request cannot be replayed
 * (Stripe `id`, GitHub `X-GitHub-Delivery`, Shopify `X-Shopify-Webhook-Id`, SendGrid `sg_event_id`...).
 * In-memory and per process; `apps/ingest` runs one instance per connector, which is enough for staging —
 * a Redis-backed guard can implement the same two methods later.
 */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();
  constructor(private readonly opts: { ttlMs?: number; max?: number; now?: () => number } = {}) {}

  /** Returns true the first time an id is seen (and records it); false on a replay. */
  check(id: string): boolean {
    const now = (this.opts.now ?? Date.now)();
    this.sweep(now);
    if (this.seen.has(id)) return false;
    this.seen.set(id, now);
    this.sweep(now);
    return true;
  }

  has(id: string): boolean {
    this.sweep((this.opts.now ?? Date.now)());
    return this.seen.has(id);
  }

  get size(): number {
    return this.seen.size;
  }

  private sweep(now: number): void {
    const ttl = this.opts.ttlMs ?? 24 * 60 * 60 * 1000;
    const max = this.opts.max ?? 50_000;
    for (const [id, at] of this.seen) {
      if (now - at > ttl) this.seen.delete(id);
    }
    while (this.seen.size > max) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }
}

/** Last path segment of the webhook URL when it is a UUID (`/webhooks/stripe/<businessId>`). */
export function businessIdFromWebhookUrl(req: Request): string | null {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const last = segments.at(-1);
  return last && isUuid(last) ? last : null;
}

/**
 * Hook for `apps/ingest` to map a vendor account (Stripe `event.account`, Shopify shop domain, GitHub
 * installation id) to a business when the URL does not carry one (Connect-style shared endpoints).
 */
export type BusinessResolver = (hint: { connectorKey: string; externalAccountId: string | null; url: URL }) => Promise<string | null>;

export async function resolveBusinessId(req: Request, connectorKey: string, externalAccountId: string | null, resolver?: BusinessResolver): Promise<string | null> {
  const fromUrl = businessIdFromWebhookUrl(req);
  if (fromUrl) return fromUrl;
  if (resolver) return resolver({ connectorKey, externalAccountId, url: new URL(req.url) });
  return null;
}

/** Parse `multipart/form-data` or urlencoded bodies (SendGrid Inbound Parse, Dropbox Sign callbacks). */
export async function formFields(req: Request): Promise<Record<string, string>> {
  const form = await req.clone().formData();
  const out: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

/** Build a Request for tests and mock simulations. */
export function makeWebhookRequest(url: string, body: string | Buffer, headers: Record<string, string>, method = "POST"): Request {
  return new Request(url, { method, headers, body: typeof body === "string" ? body : new Uint8Array(body) });
}

export function parseJsonBody<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
