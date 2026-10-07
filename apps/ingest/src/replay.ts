/**
 * Delivery identity and timestamps per vendor (BUILD §14 "replay protection (timestamp + nonce store)").
 *
 * Every connector's `verify()` already checks its own signature scheme and keeps a per-process replay guard;
 * this module is the service-level layer on top: it names the delivery (the nonce) and reads the delivery's
 * own timestamp so the router can refuse stale deliveries and remember verified ones in a shared store.
 * Unknown vendors fall back to a hash of the raw body, which still stops byte-identical replays.
 */
import { createHash } from "node:crypto";

export interface DeliveryIdentity {
  /** Unique per delivery as far as the vendor guarantees it; never empty. */
  deliveryId: string;
  /** Where the id came from (for logs and tests). */
  idSource: "header" | "body" | "signature" | "body-hash";
  /** Unix seconds the vendor stamped on the delivery, when it sends one. */
  timestampSeconds: number | null;
}

const bodyHash = (body: string): string => createHash("sha256").update(body).digest("hex").slice(0, 40);

/** Parse `Stripe-Signature: t=<unix>,v1=<hex>` for the timestamp. */
export function stripeSignatureTimestamp(headerValue: string | null): number | null {
  if (!headerValue) return null;
  for (const part of headerValue.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k?.trim() === "t") {
      const n = Number.parseInt((v ?? "").trim(), 10);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

const jsonField = (body: string, field: string): string | null => {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const v = (parsed as Record<string, unknown>)[field];
      return typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null;
    }
  } catch {
    /* not JSON */
  }
  return null;
};

const toSeconds = (iso: string | null): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

/**
 * Identify a delivery. `connector` is the registry key (`stripe`, `sendgrid`, `sendgrid-inbound` route suffixes are
 * passed as the connector key with the suffix stripped by the caller).
 */
export function identifyDelivery(connector: string, headers: Headers, body: string): DeliveryIdentity {
  const h = (name: string) => headers.get(name);
  switch (connector) {
    case "stripe": {
      const id = jsonField(body, "id");
      const created = jsonField(body, "created");
      const headerTs = stripeSignatureTimestamp(h("stripe-signature"));
      const ts = headerTs ?? (created ? Number.parseInt(created, 10) : null);
      return id
        ? { deliveryId: `${jsonField(body, "account") ?? "platform"}:${id}`, idSource: "body", timestampSeconds: ts }
        : { deliveryId: bodyHash(body), idSource: "body-hash", timestampSeconds: ts };
    }
    case "github": {
      const id = h("x-github-delivery");
      return id ? { deliveryId: id, idSource: "header", timestampSeconds: null } : { deliveryId: bodyHash(body), idSource: "body-hash", timestampSeconds: null };
    }
    case "shopify": {
      const id = h("x-shopify-webhook-id");
      const ts = toSeconds(h("x-shopify-triggered-at"));
      return id ? { deliveryId: id, idSource: "header", timestampSeconds: ts } : { deliveryId: bodyHash(body), idSource: "body-hash", timestampSeconds: ts };
    }
    case "sendgrid": {
      const sig = h("x-twilio-email-event-webhook-signature");
      const tsRaw = h("x-twilio-email-event-webhook-timestamp");
      const ts = tsRaw ? Number.parseInt(tsRaw, 10) : Number.NaN;
      const timestampSeconds = Number.isFinite(ts) ? ts : null;
      if (sig) return { deliveryId: `sig:${bodyHash(sig)}`, idSource: "signature", timestampSeconds };
      return { deliveryId: bodyHash(body), idSource: "body-hash", timestampSeconds };
    }
    case "dropbox_sign": {
      // Callbacks are form posts carrying a `json` field with event.event_hash (unique) and event.event_time.
      try {
        const m = /"event_hash"\s*:\s*"([^"]+)"/.exec(body);
        const t = /"event_time"\s*:\s*"?(\d+)"?/.exec(body);
        const ts = t?.[1] ? Number.parseInt(t[1], 10) : null;
        if (m?.[1]) return { deliveryId: m[1], idSource: "body", timestampSeconds: ts };
        return { deliveryId: bodyHash(body), idSource: "body-hash", timestampSeconds: ts };
      } catch {
        return { deliveryId: bodyHash(body), idSource: "body-hash", timestampSeconds: null };
      }
    }
    default:
      return { deliveryId: bodyHash(body), idSource: "body-hash", timestampSeconds: null };
  }
}

/** True when the delivery carries no timestamp or its timestamp is within the window of `nowMs`. */
export function withinReplayWindow(timestampSeconds: number | null, nowMs: number, windowSeconds: number): boolean {
  if (timestampSeconds === null) return true;
  if (!Number.isFinite(timestampSeconds)) return false;
  return Math.abs(nowMs / 1000 - timestampSeconds) <= windowSeconds;
}

/** `/webhooks/sendgrid-inbound/:businessId` → connector `sendgrid`, suffix `inbound`. */
export function splitConnectorSegment(segment: string): { connector: string; suffix: string | null } {
  const i = segment.indexOf("-");
  if (i === -1) return { connector: segment, suffix: null };
  return { connector: segment.slice(0, i), suffix: segment.slice(i + 1) || null };
}
