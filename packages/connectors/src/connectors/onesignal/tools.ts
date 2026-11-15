/**
 * OneSignal push for the mobile companion app (docs/mobile, docs/mobile/BACKEND_CHANGES.md §4). Platform key only
 * (`ONESIGNAL_APP_ID` and `ONESIGNAL_API_KEY` on the gateway): the app registers each phone's subscription id with the
 * api (`founder.devices.register`), and the api's push notifier asks the gateway to send to those ids. A service-only
 * connector: agents never call it (packages/connectors `SERVICE_ONLY_CONNECTORS`). API shape checked against OneSignal's
 * "Create notification" reference (`POST /notifications?c=push`, `include_subscription_ids`) on 2026-11-08.
 */
import { z } from "zod";
import { defineTool } from "../../define";

export const ONESIGNAL_KEY = "onesignal";
export const ONESIGNAL_BASE_URL = "https://api.onesignal.com";

/** OneSignal takes up to 2,000 subscription ids per request. */
export const MAX_SUBSCRIPTIONS_PER_SEND = 2000;
export const PUSH_TITLE_MAX = 80;
export const PUSH_BODY_MAX = 240;

const SubscriptionId = z.string().trim().min(8).max(512);

export const SendPushInput = z.object({
  subscriptionIds: z.array(SubscriptionId).min(1).max(MAX_SUBSCRIPTIONS_PER_SEND),
  title: z.string().trim().min(1).max(PUSH_TITLE_MAX),
  body: z.string().trim().min(1).max(PUSH_BODY_MAX),
  /** What the app routes on when the notification is tapped (`{ businessId, kind, itemId?, journeyId?, agentId? }`). */
  data: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
  /** Later notifications with the same key replace earlier ones on the device (OneSignal `collapse_id`). */
  collapseKey: z.string().trim().min(1).max(64).optional(),
});
export type SendPushInput = z.output<typeof SendPushInput>;

export const SendPushOutput = z.object({
  /** The provider's notification id; empty when it accepted nothing. */
  id: z.string(),
  /** How many subscriptions the provider accepted the notification for (an estimate: OneSignal counts delivery later). */
  recipients: z.number().int().nonnegative(),
  /** The provider's own notes when some ids were refused ("All included players are not subscribed"); never a secret. */
  errors: z.array(z.string().max(200)).default([]),
});
export type SendPushOutput = z.output<typeof SendPushOutput>;

export const onesignalTools = [
  defineTool({
    name: "send_push",
    description: "Send one push notification to up to 2,000 phone subscriptions of the platform's own mobile app. Returns the provider's id and how many subscriptions accepted it. The platform calls this for founders' own phones; it never reaches a third party.",
    input: SendPushInput,
    output: SendPushOutput,
    // A notification to the founder's own registered phone is not a third-party contact and costs nothing per send.
    hints: { spendsMoney: false, contactsThirdParty: false, requiresKitMode: false, irreversible: false },
    annotations: { readOnlyHint: false, idempotentHint: false },
  }),
] as const;

export const ONESIGNAL_RATE_LIMITS = { perMinute: 600, perDay: 50_000 };
