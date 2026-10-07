/**
 * Deterministic SendGrid fixtures. The P-256 key pair below exists only to sign mock Event Webhook deliveries
 * (generated once for this repository; it has no relationship to any SendGrid account).
 */
import type { SgSingleSend, SgStatsDay, SgVerifiedSender } from "../tools";

export const MOCK_SENDGRID_PRIVATE_KEY_PEM =
  "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg6NgNhpl1hceT8or9\nq3DG8Y4r24KNuurhVgRHojh1bzmhRANCAAQk4N/pxt/ZIK9kzKaDIUu5Rw4txVZI\nRavykkwrl0syyl3ys/bT3L119BRjMAgiiWsJ6wPxo0ajYoD68NMzpVcl\n-----END PRIVATE KEY-----\n";
/** Base64 SPKI, the format SendGrid shows in Settings → Mail Settings → Event Webhook → Signature verification. */
export const MOCK_SENDGRID_PUBLIC_KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEJODf6cbf2SCvZMymgyFLuUcOLcVWSEWr8pJMK5dLMspd8rP209y9dfQUYzAIIolrCesD8aNGo2KA+vDTM6VXJQ==";
export const MOCK_SENDGRID_INBOUND_TOKEN = "mock-inbound-parse-token";

export const MOCK_SENDER_EMAIL = "hello@northwindskincare.com";

export const SG_VERIFIED_SENDERS: SgVerifiedSender[] = [
  { id: 4_411_902, from_email: MOCK_SENDER_EMAIL, from_name: "Northwind Skincare", reply_to: "care@northwindskincare.com", verified: true, locked: false },
  { id: 4_411_903, from_email: "reid@northwindskincare.com", from_name: "Reid at Northwind", reply_to: "reid@northwindskincare.com", verified: true, locked: false },
  { id: 4_411_904, from_email: "news@northwindskincare.com", from_name: "Northwind News", reply_to: null, verified: false, locked: false },
];

export const SG_SUPPRESSIONS: Record<string, ("global_unsubscribe" | "group_unsubscribe" | "bounce" | "spam_report" | "block" | "invalid_email")[]> = {
  "unsub@example.com": ["global_unsubscribe"],
  "bounced@example.com": ["bounce"],
  "angry@example.com": ["spam_report", "global_unsubscribe"],
};

export const SG_SINGLE_SENDS: SgSingleSend[] = [
  { id: "ss_mock_welcome_sept", name: "September welcome series", status: "triggered", send_at: "2026-09-02T08:00:00Z", send_to: { list_ids: ["list_subscribers"] }, email_config: { subject: "Welcome to Northwind", sender_id: 4_411_902, suppression_group_id: 21_904 }, created_at: "2026-08-30T10:00:00Z", updated_at: "2026-09-02T08:00:05Z" },
  { id: "ss_mock_autumn_draft", name: "Autumn routine launch", status: "draft", send_at: null, send_to: { list_ids: ["list_subscribers", "list_customers"] }, email_config: { subject: "Your autumn routine, simplified", sender_id: 4_411_902, suppression_group_id: 21_904 }, created_at: "2026-10-01T09:30:00Z", updated_at: "2026-10-03T16:12:00Z" },
];

/** Seven days of stats ending 2026-10-04; day 5 carries the simulated spam spike. */
export const SG_STATS: SgStatsDay[] = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((date, i) => ({
  date,
  stats: [{ metrics: { requests: 1_240 + i * 35, delivered: 1_210 + i * 34, opens: 610 + i * 12, unique_opens: 480 + i * 9, clicks: 96 + i * 3, bounces: 14 + (i % 3), spam_reports: i === 4 ? 9 : 1, unsubscribes: 4 + (i % 2) } }],
}));
