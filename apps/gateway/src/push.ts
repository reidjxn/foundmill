/**
 * `POST /v1/push/send` (the mobile companion app, docs/mobile/BACKEND_CHANGES.md §4): one push notification to the
 * registered phones of a business's people. Only the api asks (service token `svc: api`): its push notifier decides who
 * gets what (memberships, section walls, each person's notification preferences) and sends the subscription ids, the
 * title, the body and the routing data; the gateway holds the OneSignal app id and REST API key and runs the `onesignal`
 * connector, live when INTEGRATIONS_MODE=live or LIVE_CONNECTORS names it, else its mock, which accepts everything.
 *
 * The window is the business's own on the connector (`rl:<businessId>:onesignal`). The audit row records the kind, the
 * counts and the provider's id, never the title or the body (they can carry a customer's name or an amount).
 */
import { z } from "zod";
import { isConfigError, mockIntegrationRecord, ONESIGNAL_KEY, SendPushInput, type ToolContext } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { NOTIFICATION_KINDS } from "@foundmill/shared";
import { GatewayError, modeFor, type GatewayDeps } from "./pipeline";
import { checkRateLimit } from "./rate-limit";

export const SendPushRequest = SendPushInput.extend({
  /** The business the notification is about: the rate-limit scope and the audit row's business. */
  businessId: z.guid(),
  /** Which kind of notification (the person's per-kind switch the api already applied); audited, never sent to the vendor. */
  kind: z.enum(NOTIFICATION_KINDS),
});
export type SendPushRequest = z.infer<typeof SendPushRequest>;

export interface SendPushResponse {
  mode: "mock" | "live";
  /** The provider's notification id; empty when it accepted nothing. */
  id: string;
  /** Subscriptions the provider accepted the notification for (Estimate). */
  recipients: number;
  /** The provider's short notes when some ids were refused. */
  errors: string[];
}

const PushData = z.object({ id: z.string(), recipients: z.number().int().nonnegative(), errors: z.array(z.string()).default([]) });
const NIL_ID = "00000000-0000-0000-0000-000000000000";

export async function sendPush(deps: GatewayDeps, input: SendPushRequest, service: string): Promise<SendPushResponse> {
  const now = deps.now?.() ?? new Date();
  const mode = modeFor(deps, ONESIGNAL_KEY);
  const connector = deps.registry.get(ONESIGNAL_KEY, mode);
  const limit = await checkRateLimit(deps.rateLimits, { businessId: input.businessId, connector: ONESIGNAL_KEY, limits: connector.rateLimits ?? {} }, now.getTime());
  if (!limit.allowed) {
    throw new GatewayError("rate_limited", `Too many notifications for this business. Try again in ${limit.retryAfterSeconds} seconds.`, 429, { retryAfterSeconds: limit.retryAfterSeconds, scope: limit.scope, limit: limit.limit });
  }
  const { businessId, kind, ...args } = input;
  const ctx: ToolContext = { businessId, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(ONESIGNAL_KEY, businessId), log: deps.log, mode };
  let result;
  try {
    result = await connector.callTool("send_push", args, ctx);
  } catch (e) {
    if (isConfigError(e)) throw new GatewayError("push_unconfigured", "Push notifications are not set up on this server yet (ONESIGNAL_APP_ID and ONESIGNAL_API_KEY are missing on the gateway)", 503);
    throw e;
  }
  if (!result.ok) {
    const status = result.error?.status;
    deps.log.warn({ businessId, kind, code: result.error?.code, status }, "push refused by the provider");
    if (status === 429 || result.error?.code === "rate_limited") throw new GatewayError("push_rate_limited", "The push service is busy. Try again later.", 429);
    throw new GatewayError("push_unavailable", "The push notification could not be sent right now.", 502, { vendorStatus: typeof status === "number" ? status : null });
  }
  const data = PushData.safeParse(result.data);
  if (!data.success) throw new GatewayError("push_unavailable", "The push service sent back something that is not an answer", 502);
  deps.log.info({ businessId, kind, mode, devices: args.subscriptionIds.length, recipients: data.data.recipients }, "push sent");
  // Best effort and attributed: an audit write that fails must not undo a notification already on its way.
  await repos.audit
    .append(deps.db, businessId, { actorKind: "system", action: "gateway.push.sent", target: { kind: "push", id: data.data.id || null }, details: { service, mode, kind, devices: args.subscriptionIds.length, recipients: data.data.recipients, errors: data.data.errors } })
    .catch((e: unknown) => deps.log.warn({ businessId, kind, reason: e instanceof Error ? e.name : "unknown" }, "push audit not written"));
  return { mode, ...data.data };
}
