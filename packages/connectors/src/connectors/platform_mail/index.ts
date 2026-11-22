/**
 * Live `platform_mail`: sends one message from the project's Foundmill address on the platform's own SendGrid key
 * (`SENDGRID_API_KEY`, gateway only), through the same fetch-based transport and SDK validation as the `sendgrid`
 * connector. The sender, the unsubscribe link and the custom args come from `ctx.platformMail`, which only the gateway
 * sets, after the policy for outside contact, the suppression list, the project's daily cap and the platform's ceiling
 * (apps/gateway `platform-mail.ts`). Not part of CONNECTOR_FACTORIES: nothing to connect in Settings › Integrations.
 */
import { MailService } from "@sendgrid/mail";
import { AppError, uuid } from "@foundmill/shared";
import { ConfigError, VendorError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { createSendgridTransport } from "../sendgrid";
import { requireEnvelope } from "./envelope";
import { platformMailMock } from "./mock";
import { assertPlatformMailContent, buildPlatformMailData, PLATFORM_MAIL_KEY, PLATFORM_MAIL_RATE_LIMITS, platformMailTools, PLATFORM_MAIL_SUPPRESSED } from "./tools";

export function createPlatformMailConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now, isSuppressed } = resolveLiveOptions(options);
  const key = (): string => {
    if (!secrets.sendgridApiKey) throw new ConfigError(PLATFORM_MAIL_KEY, "SENDGRID_API_KEY", "the platform's SendGrid key with Mail Send access, on the gateway");
    return secrets.sendgridApiKey;
  };
  return buildLiveConnector(
    {
      key: PLATFORM_MAIL_KEY,
      displayName: "Email from your project",
      phase: 1,
      auth: { kind: "none" },
      tools: platformMailTools,
      rateLimits: PLATFORM_MAIL_RATE_LIMITS,
      now,
      handlers: {
        send_mail: async (mail, ctx) => {
          const envelope = requireEnvelope(ctx);
          assertPlatformMailContent(mail);
          // The gateway checked already (Cedar's `suppressed`); checked again here, right before the vendor call.
          if (isSuppressed && (await isSuppressed(ctx.businessId, mail.to.email))) throw new AppError(PLATFORM_MAIL_SUPPRESSED, "This person asked not to be emailed, or their address bounced. Nothing was sent.", 403);
          const mailer = new MailService();
          mailer.setClient(createSendgridTransport(fetch, key()));
          const [res] = await mailer.send(buildPlatformMailData(mail, envelope) as unknown as Parameters<MailService["send"]>[0]);
          const response = res as unknown as { statusCode: number; headers: Record<string, string> };
          if (response.statusCode >= 300) throw new VendorError(PLATFORM_MAIL_KEY, response.statusCode, "mail/send refused");
          return { messageId: response.headers["x-message-id"] ?? `unknown-${now().getTime()}`, messageRef: envelope.messageRef, from: envelope.from.email, to: mail.to.email.toLowerCase() };
        },
      },
      connect: async (businessId) => {
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: PLATFORM_MAIL_KEY, status: "connected", scopes: [], accountLabel: "Built in", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => healthResult(secrets.sendgridApiKey ? "connected" : "disconnected", now().getTime(), { now, ...(secrets.sendgridApiKey ? {} : { message: "SENDGRID_API_KEY is not set on the gateway" }) }),
    },
    platformMailMock,
  );
}

export { platformMailMock, createPlatformMailMock } from "./mock";
export * from "./tools";
export { normalisePlatformMailEvents, platformInboundLocalParts, suppressionReasonOf, readInboundMail, replyOwnText, inboundSenderVerified, dkimPassedDomains, domainsAligned, type InboundSenderCheck, type PlatformMailEventBatch, type InboundMail, type SgEvent } from "./webhooks";
export { suppressionHashOfEmail } from "./hash";
export { bookingLinkSecret, bookingManageToken, bookingManageUrl, DEV_BOOKING_LINK_SECRET, readBookingManageToken } from "./booking";
export { followConfirmNonceHash, followConfirmToken, followConfirmUrl, PLATFORM_MAIL_CONFIRM_PATH, readFollowConfirmToken, type FollowConfirmClaims } from "./confirm";
