/**
 * Live PostHog connector over the injected fetch (no SDK). The founder's own personal API key only: it comes from the
 * connect form and then from `ctx.credential`; `secrets` is never read and there is no platform key. The key travels in
 * the Authorization header and nowhere else. The host comes only from the two-value region map; the project id and
 * region are stored in the integration's `config` and are never tool arguments.
 */
import { uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential, type IntegrationRecord } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { bearer, createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { posthogMock } from "./mock";
import { isProjectId, isRegion, mapQuery, POSTHOG_CONNECT_FIELDS, POSTHOG_HOSTS, POSTHOG_KEY, POSTHOG_RATE_LIMITS, posthogTools, prepareQuery, type PhQueryResponse, type PosthogRegion } from "./tools";

interface Target {
  region: PosthogRegion;
  projectId: string;
}

/** A fixed sentence per status. PostHog's own error text can quote the query and the data, so none of it is passed on. */
const SENTENCE = (status: number): string => {
  if (status === 429) return "PostHog's query limit was reached; try again later";
  if (status === 401 || status === 403) return "PostHog did not accept the key; it needs the Query Read scope for this project";
  if (status === 404) return "PostHog did not find the project";
  if (status === 400) return "PostHog could not run the query";
  if (status === 504) return "PostHog did not answer in time";
  return "PostHog could not be reached or failed";
};

const MACHINE_CODE = /^[a-z0-9_]{1,40}$/;

export function createPosthogConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);

  const missingKey = () => new ConfigError(POSTHOG_KEY, "the business's own PostHog personal API key", "connect PostHog in Settings › Integrations");
  const targetOf = (integration: IntegrationRecord): Target => {
    const { region, projectId } = integration.config ?? {};
    if (!isRegion(region) || !isProjectId(projectId)) throw new ConfigError(POSTHOG_KEY, "the PostHog project id and region", "connect PostHog again in Settings › Integrations");
    return { region, projectId };
  };

  /** One HogQL query. A failure is rebuilt from its status, a fixed sentence and PostHog's machine code if it is a plain identifier. */
  const runQuery = async (secret: string, target: Target, sql: string, name?: string): Promise<PhQueryResponse> => {
    const http = createHttp({ connectorKey: POSTHOG_KEY, baseUrl: POSTHOG_HOSTS[target.region], fetch, headers: { authorization: bearer(secret) } });
    try {
      const res = await http.json<PhQueryResponse>("POST", `/api/projects/${target.projectId}/query/`, { body: { query: { kind: "HogQLQuery", query: sql }, ...(name ? { name } : {}) } });
      return res ?? {};
    } catch (e) {
      if (!(e instanceof VendorError)) throw e;
      const raw = e.body && typeof e.body === "object" ? (e.body as { code?: unknown }).code : undefined;
      const code = typeof raw === "string" && MACHINE_CODE.test(raw) ? ` (${raw})` : "";
      // No body: `toToolError` forwards a VendorError's body to the agent, outside the untrusted envelope.
      throw new VendorError(POSTHOG_KEY, e.httpStatus, `POST query → ${e.httpStatus}: ${SENTENCE(e.httpStatus)}${code}`);
    }
  };

  /**
   * The cheapest authenticated check with the passed key. A key with only Query Read cannot read /api/users/@me or the
   * project record, so `SELECT 1` through the query endpoint is the check.
   */
  const check = async (secret: string, target: Target) => {
    const res = await runQuery(secret, target, "SELECT 1");
    if (!Array.isArray(res.results)) throw new VendorError(POSTHOG_KEY, 502, "POST query answered without results");
  };

  return buildLiveConnector(
    {
      key: POSTHOG_KEY,
      displayName: "PostHog",
      phase: 2,
      auth: { kind: "api_key" },
      tools: posthogTools,
      rateLimits: POSTHOG_RATE_LIMITS,
      now,
      handlers: {
        query_insights: async ({ query, name }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          const target = targetOf(ctx.integration);
          const { sql, limit } = prepareQuery(query);
          const out = mapQuery(await runQuery(secret, target, sql, name), limit);
          if (!out) throw new VendorError(POSTHOG_KEY, 502, "POST query answered without results");
          return out;
        },
      },
      connectFields: POSTHOG_CONNECT_FIELDS,
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(POSTHOG_KEY, "apiKey", "Enter your PostHog personal API key to connect PostHog");
        const projectId = connectInputValue(input, "projectId");
        if (!isProjectId(projectId)) throw new ConnectInputError(POSTHOG_KEY, "projectId", "Enter your PostHog project ID (digits only)");
        const region = connectInputValue(input, "region");
        if (!isRegion(region)) throw new ConnectInputError(POSTHOG_KEY, "region", "Enter the region of your PostHog project: us or eu");
        await check(apiKey, { region, projectId });
        const createdAt = now().toISOString();
        return {
          id: uuid(),
          businessId,
          connectorKey: POSTHOG_KEY,
          status: "connected",
          scopes: ["query:read"],
          accountLabel: `PostHog (${region.toUpperCase()}, project ${projectId})`,
          externalAccountId: projectId,
          config: { projectId, region },
          credentialRef: null,
          expiresAt: null,
          lastHealthAt: createdAt,
          createdAt,
          credentialToStore: { kind: "api_key" as const, secret: apiKey },
        };
      },
      healthcheck: async (integration, credential?: DecryptedCredential) => {
        const startedAt = now().getTime();
        if (!credential?.secret) return healthResult("disconnected", startedAt, { now, message: "No PostHog API key is connected" });
        try {
          const target = targetOf(integration);
          await check(credential.secret, target);
          return healthResult("connected", startedAt, { now, details: { region: target.region, projectId: target.projectId } });
        } catch (e) {
          // Messages here are fixed sentences built above, or the ConfigError text; none carries vendor text or the key.
          return healthResult("degraded", startedAt, { now, message: e instanceof Error ? e.message : "PostHog check failed" });
        }
      },
    },
    posthogMock,
  );
}

export { posthogMock, mockQuery } from "./mock";
export { posthogTools, POSTHOG_KEY, prepareQuery } from "./tools";
