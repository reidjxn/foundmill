/**
 * Mock OneSignal: accepts every subscription id and answers a deterministic notification id, so INTEGRATIONS_MODE=mock
 * runs the whole push flow (device registration → notifier → gateway → "sent") with no key and no network.
 */
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, uuidFromSeed } from "../../mock-utils";
import { ONESIGNAL_KEY, ONESIGNAL_RATE_LIMITS, onesignalTools } from "./tools";

export const onesignalMock = buildMockConnector({
  key: ONESIGNAL_KEY,
  displayName: "OneSignal",
  phase: 1,
  auth: { kind: "api_key", platformKey: true },
  tools: onesignalTools,
  rateLimits: ONESIGNAL_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    send_push: async ({ subscriptionIds, title, body, collapseKey }) => ({
      id: uuidFromSeed("onesignal", title, body, collapseKey ?? "", ...subscriptionIds),
      recipients: subscriptionIds.length,
      errors: [],
    }),
  },
  connect: async (businessId) => mockIntegrationRecord(ONESIGNAL_KEY, businessId, { accountLabel: "OneSignal (platform, mock)" }),
  healthcheck: async () => mockHealth(ONESIGNAL_KEY),
});
