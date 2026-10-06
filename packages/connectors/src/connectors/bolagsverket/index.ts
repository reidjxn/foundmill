/** Live Bolagsverket connector: OAuth2 client credentials (Basic) → Bearer calls to the Värdefulla datamängder API. */
import { uuid } from "@founder-manager/shared";
import { ConfigError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { createClientCredentialsTokenSource, type TokenSource } from "../_shared/oauth";
import { bolagsverketMock } from "./mock";
import { BOLAGSVERKET_BASE_URL, BOLAGSVERKET_KEY, BOLAGSVERKET_RATE_LIMITS, BOLAGSVERKET_SCOPE, BOLAGSVERKET_TOKEN_URL, bolagsverketTools, mapDocument, mapOrganisation, type BvDocumentListResponse, type BvOrganisationResponse } from "./tools";

export function createBolagsverketConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const api = createHttp({ connectorKey: BOLAGSVERKET_KEY, baseUrl: BOLAGSVERKET_BASE_URL, fetch });
  let tokens: TokenSource | null = null;
  const tokenSource = (): TokenSource => {
    if (tokens) return tokens;
    if (!secrets.bolagsverketClientId || !secrets.bolagsverketClientSecret) throw new ConfigError(BOLAGSVERKET_KEY, "BOLAGSVERKET_CLIENT_ID / BOLAGSVERKET_CLIENT_SECRET", "create an application on portal.api.bolagsverket.se");
    tokens = createClientCredentialsTokenSource({ http: createHttp({ connectorKey: BOLAGSVERKET_KEY, baseUrl: BOLAGSVERKET_TOKEN_URL, fetch }), tokenPath: BOLAGSVERKET_TOKEN_URL, clientId: secrets.bolagsverketClientId, clientSecret: secrets.bolagsverketClientSecret, scope: BOLAGSVERKET_SCOPE, authStyle: "basic", now });
    return tokens;
  };
  const authed = async () => ({ authorization: `Bearer ${await tokenSource().get()}` });

  return buildLiveConnector(
    {
      key: BOLAGSVERKET_KEY,
      displayName: "Bolagsverket",
      phase: 1,
      auth: { kind: "api_key" },
      tools: bolagsverketTools,
      rateLimits: BOLAGSVERKET_RATE_LIMITS,
      now,
      handlers: {
        get_organisation: async ({ organisationNumber }) => {
          const res = await api.json<BvOrganisationResponse>("POST", "/organisationer", { body: { identitetsbeteckning: organisationNumber }, headers: await authed() });
          const org = res.organisationer?.[0];
          if (!org) throw Object.assign(new Error(`organisation ${organisationNumber} not found`), { status: 404 });
          return mapOrganisation(org, organisationNumber);
        },
        list_documents: async ({ organisationNumber }) => {
          const res = await api.json<BvDocumentListResponse>("POST", "/dokumentlista", { body: { identitetsbeteckning: organisationNumber }, headers: await authed() });
          return { items: (res.dokument ?? []).map(mapDocument) };
        },
      },
      connect: async (businessId) => {
        await tokenSource().get();
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: BOLAGSVERKET_KEY, status: "connected", scopes: [BOLAGSVERKET_SCOPE], accountLabel: "Bolagsverket (platform client)", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          await tokenSource().get();
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    bolagsverketMock,
  );
}

export { bolagsverketMock } from "./mock";
export { bolagsverketTools, BOLAGSVERKET_KEY } from "./tools";
