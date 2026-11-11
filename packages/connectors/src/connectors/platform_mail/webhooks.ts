/**
 * What comes back to a project's Foundmill address (package 1.5; SECURITY_REVIEW N2): replies through SendGrid Inbound
 * Parse and delivery events through the platform account's Event Webhook, both posted to ONE platform endpoint each in
 * apps/ingest. Neither carries a business in its URL: a reply is bound to the project by the local part it was sent to
 * (`project_mail`), a delivery event by the custom args the gateway signed into the message it belongs to. An event
 * whose args do not verify (missing, forged or altered) is dropped; it never falls back to a value an outsider sent.
 */
import { suppressionHashOfEmail } from "./hash";
import { platformMailLocalPartOf } from "@foundmill/shared";
import type { PlatformEvent } from "../../contract";
import { normaliseSendgridEvents, type InboundMail, type SgEvent } from "../sendgrid/webhooks";
import { verifyPlatformMailArgs } from "./tools";

export { readInboundMail, normaliseInboundMail, verifySendgridSignature, SG_SIGNATURE_HEADER, SG_TIMESTAMP_HEADER, type InboundMail, type SgEvent } from "../sendgrid/webhooks";

/**
 * The local parts at the platform domain an inbound message was delivered to: the SMTP envelope's recipients (what the
 * MX accepted) when SendGrid sends them, else the `To` and `Cc` headers. Addresses at any other domain are ignored.
 */
export function platformInboundLocalParts(mail: Pick<InboundMail, "to" | "envelope"> & { cc?: string }, domain: string): string[] {
  const fromEnvelope = Array.isArray(mail.envelope?.to) ? mail.envelope!.to.filter((v): v is string => typeof v === "string") : [];
  const raw = fromEnvelope.length ? fromEnvelope : [...splitAddresses(mail.to), ...splitAddresses(mail.cc ?? "")];
  const out: string[] = [];
  for (const address of raw) {
    const local = platformMailLocalPartOf(address, domain);
    if (local && !out.includes(local)) out.push(local);
  }
  return out.slice(0, 10);
}

/** `"A" <a@x>, b@y` → each address (quoted display names may hold commas). */
function splitAddresses(header: string): string[] {
  return header.match(/(?:"[^"]*"\s*)?<[^>]+>|[^,\s<>"]+@[^,\s<>"]+/g) ?? [];
}

/** SendGrid events that mean the address must not be written to again, and why. */
export function suppressionReasonOf(e: SgEvent): string | null {
  switch (e.event) {
    case "bounce":
      // A "blocked" bounce is the receiving server refusing for now (reputation, rate): not a dead address.
      return e.type === "blocked" ? null : "bounced";
    case "dropped":
      return "dropped by the mail service (an earlier bounce, unsubscribe or spam report)";
    case "spamreport":
      return "marked the message as spam";
    case "unsubscribe":
    case "group_unsubscribe":
      return "unsubscribed";
    default:
      return null;
  }
}

export interface PlatformMailEventBatch {
  businessId: string;
  /** `lead.replied` for an unsubscribe or a spam report (the CRM's reply event), as for a founder's own SendGrid. */
  events: PlatformEvent[];
  /** Addresses to add to this business's suppression list (hash only). */
  suppress: { emailHash: string; reason: string }[];
}

/**
 * Delivery events grouped by the business their signed custom args name. Unverified events are counted in `ignored`
 * and produce nothing.
 */
export function normalisePlatformMailEvents(events: readonly SgEvent[], secret: string): { batches: PlatformMailEventBatch[]; ignored: number } {
  const byBusiness = new Map<string, { sg: SgEvent[]; suppress: Map<string, string> }>();
  let ignored = 0;
  for (const e of events) {
    if (!e || typeof e !== "object" || typeof e.email !== "string" || !e.email) {
      ignored += 1;
      continue;
    }
    const bound = verifyPlatformMailArgs(secret, e as Record<string, unknown>);
    if (!bound) {
      ignored += 1;
      continue;
    }
    const entry = byBusiness.get(bound.businessId) ?? { sg: [], suppress: new Map<string, string>() };
    byBusiness.set(bound.businessId, entry);
    // The message's own custom args are the gateway's; a campaign id an outsider could not have set is never read here.
    entry.sg.push({ ...e, campaignId: undefined, campaign_id: undefined });
    const reason = suppressionReasonOf(e);
    if (reason) entry.suppress.set(suppressionHashOfEmail(e.email), reason);
  }
  return {
    batches: [...byBusiness.entries()].map(([businessId, { sg, suppress }]) => ({ businessId, events: normaliseSendgridEvents(sg, businessId), suppress: [...suppress.entries()].map(([emailHash, reason]) => ({ emailHash, reason })) })),
    ignored,
  };
}
