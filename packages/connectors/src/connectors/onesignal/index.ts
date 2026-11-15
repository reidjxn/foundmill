/**
 * Live OneSignal connector: `POST https://api.onesignal.com/notifications?c=push` over the injected fetch (no SDK).
 * Platform key only (`ONESIGNAL_APP_ID` and `ONESIGNAL_API_KEY`, held by the gateway). The key travels in the
 * Authorization header and nowhere else: never in a URL, a log line, an error message or a tool result.
 */
import { uuid } from "@foundmill/shared";
import { ConfigError, VendorError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { onesignalMock } from "./mock";
import { ONESIGNAL_BASE_URL, ONESIGNAL_KEY, ONESIGNAL_RATE_LIMITS, onesignalTools } from "./tools";

interface NotificationResponse {
  id?: string;
  /** Older answers carry `recipients`; the current API answers `id` and, when ids were refused, `errors`. */
  recipients?: number;
  errors?: unknown;
}

interface AppResponse {
  id?: string;
  name?: string;
}

/** Anything shaped like a OneSignal key is masked before text from the vendor reaches an error. */
export const redactOnesignalKeys = (text: string): string => text.replace(/\bos_v2_[A-Za-z0-9_-]+/g, "os_v2_…").replace(/\b[A-Za-z0-9]{40,}\b/g, "…");

/** The provider's notes, as short strings: an `errors` array of strings, or the keys of an `errors` object ("invalid_player_ids"). */
export function vendorNotes(errors: unknown): string[] {
  if (Array.isArray(errors)) return errors.filter((e): e is string => typeof e === "string").map((e) => redactOnesignalKeys(e).slice(0, 200));
  if (errors && typeof errors === "object") return Object.keys(errors).map((k) => k.slice(0, 200));
  return [];
}

export function createOnesignalConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const credentials = (): { appId: string; apiKey: string } => {
    if (!secrets.onesignalAppId || !secrets.onesignalApiKey) throw new ConfigError(ONESIGNAL_KEY, "ONESIGNAL_APP_ID and ONESIGNAL_API_KEY");
    return { appId: secrets.onesignalAppId, apiKey: secrets.onesignalApiKey };
  };
  const http = () => createHttp({ connectorKey: ONESIGNAL_KEY, baseUrl: ONESIGNAL_BASE_URL, fetch });
  const authorization = (apiKey: string) => `Key ${apiKey}`;

  /** The vendor's own words, minus anything key-shaped; the status decides retryability (429 and 5xx retry). */
  const sanitized = (e: VendorError): VendorError => {
    const notes = vendorNotes((e.body as NotificationResponse | undefined)?.errors);
    return new VendorError(ONESIGNAL_KEY, e.httpStatus, `POST /notifications → ${e.httpStatus}${notes.length ? ` (${notes.join("; ")})` : ""}`, notes.length ? { errors: notes } : undefined);
  };

  return buildLiveConnector(
    {
      key: ONESIGNAL_KEY,
      displayName: "OneSignal",
      phase: 1,
      auth: { kind: "api_key", platformKey: true },
      tools: onesignalTools,
      rateLimits: ONESIGNAL_RATE_LIMITS,
      now,
      handlers: {
        send_push: async ({ subscriptionIds, title, body, data, collapseKey }) => {
          const { appId, apiKey } = credentials();
          const res = await http()
            .json<NotificationResponse>("POST", "/notifications", {
              query: { c: "push" },
              headers: { authorization: authorization(apiKey) },
              body: {
                app_id: appId,
                target_channel: "push",
                include_subscription_ids: subscriptionIds,
                headings: { en: title },
                contents: { en: body },
                data,
                ...(collapseKey ? { collapse_id: collapseKey } : {}),
              },
            })
            .catch((e: unknown) => {
              throw e instanceof VendorError ? sanitized(e) : e;
            });
          const errors = vendorNotes(res?.errors);
          const id = typeof res?.id === "string" ? res.id : "";
          // OneSignal answers 200 with an empty id when every subscription was unknown or unsubscribed: nothing was sent.
          const recipients = id ? (typeof res?.recipients === "number" ? res.recipients : subscriptionIds.length) : 0;
          return { id, recipients, errors };
        },
      },
      connect: async (businessId) => {
        const { appId, apiKey } = credentials();
        const app = await http().json<AppResponse>("GET", `/apps/${encodeURIComponent(appId)}`, { headers: { authorization: authorization(apiKey) } });
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: ONESIGNAL_KEY, status: "connected", scopes: [], accountLabel: app?.name ? `OneSignal (${app.name})` : "OneSignal (platform)", externalAccountId: appId, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          const { appId, apiKey } = credentials();
          // Reading the app record sends nothing; a health check never pushes to a phone.
          await http().json("GET", `/apps/${encodeURIComponent(appId)}`, { headers: { authorization: authorization(apiKey) } });
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? redactOnesignalKeys(e.message) : String(e) });
        }
      },
    },
    onesignalMock,
  );
}

export { onesignalMock } from "./mock";
export { onesignalTools, ONESIGNAL_KEY, SendPushInput, SendPushOutput, MAX_SUBSCRIPTIONS_PER_SEND, PUSH_BODY_MAX, PUSH_TITLE_MAX } from "./tools";
