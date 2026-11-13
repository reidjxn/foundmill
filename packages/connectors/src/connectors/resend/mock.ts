import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, perBusiness, uuidFromSeed } from "../../mock-utils";
import { assertNoneSuppressed } from "../sendgrid/tools";
import { DOMAINS_OK, MOCK_SUPPRESSED } from "./fixtures/responses";
import { assertContent, assertVerifiedFromDomain, assertVerifiedReplyTo, buildSendBody, idempotencyKeyFor, mapDomain, publicDomain, requireUnsubscribeUrl, RESEND_KEY, RESEND_RATE_LIMITS, resendTools, type ResendDomainT } from "./tools";

export const MOCK_NOTICE = "Simulated: no email was sent. Nothing left the system.";

const mockDomains = (): (ResendDomainT & { sending?: boolean })[] => DOMAINS_OK.data.map((d) => mapDomain(d)!);

/**
 * One Resend account per business: the sends, the idempotency keys and the suppression list are the business's own, so
 * one business's opt-out never blocks another's mail. Sends are recorded and nothing leaves.
 */
export function createResendMock() {
  const world = perBusiness(() => ({
    suppressions: new Set<string>(MOCK_SUPPRESSED),
    sent: [] as { id: string; to: string; from: string; subject: string; idempotencyKey: string; body: Record<string, unknown> }[],
    byKey: new Map<string, string>(),
  }));

  const connector = buildMockConnector({
    key: RESEND_KEY,
    displayName: "Resend",
    phase: 2,
    auth: { kind: "api_key" },
    tools: resendTools,
    rateLimits: RESEND_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: {
      list_domains: async () => ({ items: mockDomains().map(publicDomain), simulated: true as const, notice: MOCK_NOTICE }),
      send_mail: async (mail, ctx) => {
        const { suppressions, sent, byKey } = world(ctx.businessId);
        const unsubscribeUrl = requireUnsubscribeUrl(ctx.unsubscribeUrl);
        assertContent(mail);
        assertVerifiedFromDomain(mail.from.email, mockDomains());
        assertVerifiedReplyTo(mail.replyTo, mockDomains());
        await assertNoneSuppressed([mail.to.email.toLowerCase()], (e) => suppressions.has(e));
        const body = buildSendBody(mail, unsubscribeUrl);
        const idempotencyKey = idempotencyKeyFor(ctx.businessId, mail);
        let id = byKey.get(idempotencyKey);
        if (!id) {
          id = uuidFromSeed("resend-email", ctx.businessId, idempotencyKey);
          byKey.set(idempotencyKey, id);
          sent.push({ id, to: mail.to.email, from: mail.from.email, subject: mail.subject, idempotencyKey, body });
        }
        return { id, to: mail.to.email, from: mail.from.email, subject: mail.subject, simulated: true as const, notice: MOCK_NOTICE };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(RESEND_KEY, businessId, { accountLabel: "northwindskincare.com (Resend, mock)", config: { verifiedDomains: ["northwindskincare.com"] } }),
    healthcheck: async (integration) => mockHealth(RESEND_KEY, { verifiedDomains: 1, sent: world(integration.businessId).sent.length }),
  });
  /** `sentFor(businessId)` / `suppressionsFor(businessId)`: that business's recorded sends and suppression set (tests). */
  return Object.assign(connector, { sentFor: (businessId: string) => world(businessId).sent, suppressionsFor: (businessId: string) => world(businessId).suppressions });
}

export const resendMock = createResendMock();
