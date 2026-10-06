import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { BV_DOCUMENTS, BV_ORGANISATIONS } from "./fixtures/organisations";
import { BOLAGSVERKET_KEY, BOLAGSVERKET_RATE_LIMITS, bolagsverketTools, mapDocument, mapOrganisation } from "./tools";

export const bolagsverketMock = buildMockConnector({
  key: BOLAGSVERKET_KEY,
  displayName: "Bolagsverket",
  phase: 1,
  auth: { kind: "api_key" },
  tools: bolagsverketTools,
  rateLimits: BOLAGSVERKET_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    get_organisation: async ({ organisationNumber }) => {
      const o = BV_ORGANISATIONS[organisationNumber];
      if (!o) throw Object.assign(new Error(`organisation ${organisationNumber} not found`), { status: 404 });
      return mapOrganisation(o, organisationNumber);
    },
    list_documents: async ({ organisationNumber }) => {
      if (!BV_ORGANISATIONS[organisationNumber]) throw Object.assign(new Error(`organisation ${organisationNumber} not found`), { status: 404 });
      return { items: (BV_DOCUMENTS[organisationNumber] ?? []).map(mapDocument) };
    },
  },
  connect: async (businessId) => mockIntegrationRecord(BOLAGSVERKET_KEY, businessId, { accountLabel: "Bolagsverket (mock)" }),
  healthcheck: async () => mockHealth(BOLAGSVERKET_KEY),
});
