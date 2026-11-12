/**
 * The mock side of `platform_notify`: the same body as the live side, recorded per business, and nothing leaves the
 * process. The gateway marks every result simulated and the api's `notify.email_sent` says so.
 */
import { APP_NAME } from "@foundmill/config";
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, perBusiness, stableHash } from "../../mock-utils";
import { buildNotificationData, PLATFORM_NOTIFY_KEY, PLATFORM_NOTIFY_RATE_LIMITS, platformNotifyTools } from "./tools";

export interface MockNotification {
  messageId: string;
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  body: Record<string, unknown>;
}

export function createPlatformNotifyMock() {
  const world = perBusiness(() => ({ sent: [] as MockNotification[] }));
  const connector = buildMockConnector({
    key: PLATFORM_NOTIFY_KEY,
    displayName: `Email from ${APP_NAME}`,
    phase: 1,
    auth: { kind: "none" },
    tools: platformNotifyTools,
    rateLimits: PLATFORM_NOTIFY_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: {
      send_notification: async (mail, ctx) => {
        const messageId = `${stableHash([mail.to.email, mail.subject, mail.text], 22)}.mock-notify`;
        world(ctx.businessId).sent.push({ messageId, to: mail.to.email.toLowerCase(), from: mail.from.email, subject: mail.subject, text: mail.text, html: mail.html, body: buildNotificationData(mail) });
        return { messageId };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(PLATFORM_NOTIFY_KEY, businessId, { accountLabel: "Built in (mock)" }),
    healthcheck: async () => mockHealth(PLATFORM_NOTIFY_KEY),
  });
  /** `sentFor(businessId)`: what was "sent" about that business (tests). */
  return Object.assign(connector, { sentFor: (businessId: string) => world(businessId).sent });
}

export const platformNotifyMock = createPlatformNotifyMock();
