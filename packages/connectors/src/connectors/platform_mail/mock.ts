/**
 * The mock side of `platform_mail`: the same checks and the same v3 body as the live side, kept per business, and
 * nothing leaves the process. The gateway marks every result simulated, so no agent reports a mock send as sent.
 */
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, perBusiness, stableHash } from "../../mock-utils";
import { assertPlatformMailContent, buildPlatformMailData, PLATFORM_MAIL_KEY, PLATFORM_MAIL_RATE_LIMITS, platformMailTools } from "./tools";
import { requireEnvelope } from "./envelope";

export function createPlatformMailMock() {
  const world = perBusiness(() => ({ sent: [] as { messageId: string; messageRef: string; to: string; from: string; subject: string; body: Record<string, unknown> }[] }));
  const connector = buildMockConnector({
    key: PLATFORM_MAIL_KEY,
    displayName: "Email from your project",
    phase: 1,
    auth: { kind: "none" },
    tools: platformMailTools,
    rateLimits: PLATFORM_MAIL_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: {
      send_mail: async (mail, ctx) => {
        const envelope = requireEnvelope(ctx);
        assertPlatformMailContent(mail);
        const body = buildPlatformMailData(mail, envelope);
        const messageId = `${stableHash([envelope.messageRef, mail.to.email, mail.subject], 22)}.mock-platform-mail`;
        world(ctx.businessId).sent.push({ messageId, messageRef: envelope.messageRef, to: mail.to.email.toLowerCase(), from: envelope.from.email, subject: mail.subject, body });
        return { messageId, messageRef: envelope.messageRef, from: envelope.from.email, to: mail.to.email.toLowerCase() };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(PLATFORM_MAIL_KEY, businessId, { accountLabel: "Built in (mock)" }),
    healthcheck: async () => mockHealth(PLATFORM_MAIL_KEY),
  });
  /** `sentFor(businessId)`: what that business "sent" (tests). */
  return Object.assign(connector, { sentFor: (businessId: string) => world(businessId).sent });
}

export const platformMailMock = createPlatformMailMock();
