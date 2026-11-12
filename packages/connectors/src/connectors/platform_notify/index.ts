/**
 * Live `platform_notify`: one email from Foundmill to one of its users on the platform's own SendGrid key
 * (`SENDGRID_API_KEY`, gateway only), through the same fetch-based transport and SDK validation as `sendgrid` and
 * `platform_mail`. Service-only (`SERVICE_ONLY_CONNECTORS`): the gateway's `/v1/notify/email` is its one caller.
 */
import { MailService } from "@sendgrid/mail";
import { APP_NAME } from "@foundmill/config";
import { uuid } from "@foundmill/shared";
import { ConfigError, VendorError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { createSendgridTransport } from "../sendgrid";
import { platformNotifyMock } from "./mock";
import { buildNotificationData, PLATFORM_NOTIFY_KEY, PLATFORM_NOTIFY_RATE_LIMITS, platformNotifyTools } from "./tools";

export function createPlatformNotifyConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const key = (): string => {
    if (!secrets.sendgridApiKey) throw new ConfigError(PLATFORM_NOTIFY_KEY, "SENDGRID_API_KEY", "the platform's SendGrid key with Mail Send access, on the gateway");
    return secrets.sendgridApiKey;
  };
  return buildLiveConnector(
    {
      key: PLATFORM_NOTIFY_KEY,
      displayName: `Email from ${APP_NAME}`,
      phase: 1,
      auth: { kind: "none" },
      tools: platformNotifyTools,
      rateLimits: PLATFORM_NOTIFY_RATE_LIMITS,
      now,
      handlers: {
        send_notification: async (mail) => {
          const mailer = new MailService();
          mailer.setClient(createSendgridTransport(fetch, key()));
          const [res] = await mailer.send(buildNotificationData(mail) as unknown as Parameters<MailService["send"]>[0]);
          const response = res as unknown as { statusCode: number; headers: Record<string, string> };
          if (response.statusCode >= 300) throw new VendorError(PLATFORM_NOTIFY_KEY, response.statusCode, "mail/send refused");
          return { messageId: response.headers["x-message-id"] ?? `unknown-${now().getTime()}` };
        },
      },
      connect: async (businessId) => {
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: PLATFORM_NOTIFY_KEY, status: "connected", scopes: [], accountLabel: "Built in", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => healthResult(secrets.sendgridApiKey ? "connected" : "disconnected", now().getTime(), { now, ...(secrets.sendgridApiKey ? {} : { message: "SENDGRID_API_KEY is not set on the gateway" }) }),
    },
    platformNotifyMock,
  );
}

export { platformNotifyMock, createPlatformNotifyMock, type MockNotification } from "./mock";
export * from "./tools";
