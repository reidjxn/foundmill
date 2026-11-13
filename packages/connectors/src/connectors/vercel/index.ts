/**
 * Live Vercel connector over the injected fetch (no SDK). The founder's own account only: the access token comes from
 * the connect form and then from `ctx.credential`; there is no platform token and `secrets` is never read. The token
 * travels in the Authorization header and nowhere else. The team id is a stored setting (`integration.config.teamId`),
 * never a tool argument. Vendor answers are mapped to a fixed set of fields: env vars, build env and `meta` blobs
 * are never passed on.
 */
import { uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential, type IntegrationRecord } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { bearer, createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { vercelMock } from "./mock";
import {
  assertRedeployKeepsTarget,
  mapCreated,
  mapDeployment,
  mapDeploymentDetail,
  TEAM_ID_RE,
  VERCEL_BASE_URL,
  VERCEL_CONNECT_FIELDS,
  VERCEL_KEY,
  VERCEL_RATE_LIMITS,
  vercelTools,
  type VcDeployment,
  type VcListResponse,
  type VcTeam,
  type VcUserResponse,
} from "./tools";

/** Vercel tokens are opaque, so only the token in hand can be masked. */
export const redactKeys = (text: string, secret?: string): string => (secret ? text.split(secret).join("…") : text);

export function createVercelConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);

  const missingToken = () => new ConfigError(VERCEL_KEY, "the business's own Vercel access token", "connect Vercel in Settings › Integrations");

  /** The stored team id, or undefined for a personal account. A stored value that is not a team id is a setup fault, never ignored. */
  const teamOf = (integration: IntegrationRecord): string | undefined => {
    const t = integration.config?.teamId;
    if (t === undefined || t === null || t === "") return undefined;
    if (typeof t !== "string" || !TEAM_ID_RE.test(t)) throw new ConfigError(VERCEL_KEY, "a valid Vercel team id", "reconnect Vercel in Settings › Integrations");
    return t;
  };

  /** One call with the given token. A vendor failure is rebuilt from its status only; the raw body and text are dropped. */
  const call = async <T>(secret: string, method: "GET" | "POST", path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> => {
    const http = createHttp({ connectorKey: VERCEL_KEY, baseUrl: VERCEL_BASE_URL, fetch, headers: { authorization: bearer(secret) } });
    try {
      return await http.json<T>(method, path, { ...(opts.query ? { query: opts.query } : {}), ...(opts.body !== undefined ? { body: opts.body } : {}) });
    } catch (e) {
      if (!(e instanceof VendorError)) throw e;
      throw new VendorError(VERCEL_KEY, e.httpStatus, `${method} ${path} → ${e.httpStatus}`);
    }
  };

  /** Who the token is, and when a team id is given, that the token can see that team. Both are free reads. */
  const whoAmI = async (secret: string, teamId?: string): Promise<{ label: string; externalId: string | null }> => {
    const user = (await call<VcUserResponse>(secret, "GET", "/v2/user")).user;
    const username = typeof user?.username === "string" && user.username ? user.username : null;
    if (!teamId) return { label: username ?? "Vercel", externalId: typeof user?.id === "string" ? user.id : null };
    const team = await call<VcTeam>(secret, "GET", `/v2/teams/${teamId}`);
    const label = (typeof team?.name === "string" && team.name) || (typeof team?.slug === "string" && team.slug) || username || "Vercel";
    return { label: label.slice(0, 80), externalId: teamId };
  };

  const getRaw = (secret: string, teamId: string | undefined, idOrUrl: string) => call<VcDeployment>(secret, "GET", `/v13/deployments/${encodeURIComponent(idOrUrl)}`, { query: { teamId } });

  return buildLiveConnector(
    {
      key: VERCEL_KEY,
      displayName: "Vercel",
      phase: 2,
      auth: { kind: "api_key" },
      tools: vercelTools,
      rateLimits: VERCEL_RATE_LIMITS,
      now,
      handlers: {
        list_deployments: async ({ projectId, target, state, limit }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingToken();
          // Vercel documents `target` as an environment filter and lists a preview as target null, so production is
          // filtered by Vercel and preview is filtered here from a larger page.
          const res = await call<VcListResponse>(secret, "GET", "/v7/deployments", {
            query: { teamId: teamOf(ctx.integration), projectId, state, target: target === "production" ? "production" : undefined, limit: target === "preview" ? Math.min(limit * 5, 100) : limit },
          });
          const items = (res?.deployments ?? []).map(mapDeployment).filter((d) => target !== "preview" || d.target !== "production");
          return { items: items.slice(0, limit) };
        },
        get_deployment: async ({ idOrUrl }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingToken();
          return mapDeploymentDetail(await getRaw(secret, teamOf(ctx.integration), idOrUrl));
        },
        create_deployment: async ({ deploymentId, target }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingToken();
          const teamId = teamOf(ctx.integration);
          // `name` is required by the schema: take it from the deployment being redeployed (same team, same token).
          const source = await getRaw(secret, teamId, deploymentId);
          const name = source.name;
          if (typeof name !== "string" || !name) throw new VendorError(VERCEL_KEY, 502, `GET /v13/deployments/${deploymentId} answered without a project name`);
          // A true redeploy only: the target must be the source's own. Refused before any POST.
          assertRedeployKeepsTarget(source.target, target);
          // The docs list no "preview" value: leaving `target` out makes a preview. Nothing else is sent (no files, git source or env).
          const body = { name, deploymentId, ...(target === "production" ? { target: "production" } : {}) };
          return mapCreated(await call<VcDeployment>(secret, "POST", "/v13/deployments", { query: { teamId }, body }), source);
        },
      },
      connectFields: VERCEL_CONNECT_FIELDS,
      connect: async (businessId, input) => {
        const token = connectInputValue(input, "apiToken");
        if (!token) throw new ConnectInputError(VERCEL_KEY, "apiToken", "Enter your Vercel access token to connect Vercel");
        const teamId = connectInputValue(input, "teamId");
        if (teamId && !TEAM_ID_RE.test(teamId)) throw new ConnectInputError(VERCEL_KEY, "teamId", "A Vercel team id starts with team_ (Team Settings › General). Leave it empty for a personal account");
        const { label, externalId } = await whoAmI(token, teamId);
        const createdAt = now().toISOString();
        return {
          id: uuid(),
          businessId,
          connectorKey: VERCEL_KEY,
          status: "connected",
          scopes: [],
          accountLabel: label,
          externalAccountId: externalId,
          config: teamId ? { teamId } : {},
          credentialRef: null,
          expiresAt: null,
          lastHealthAt: createdAt,
          createdAt,
          credentialToStore: { kind: "api_key" as const, secret: token },
        };
      },
      healthcheck: async (integration, credential?: DecryptedCredential) => {
        const startedAt = now().getTime();
        const secret = credential?.secret;
        if (!secret) return healthResult("disconnected", startedAt, { now, message: "No Vercel access token is connected" });
        try {
          const { label } = await whoAmI(secret, teamOf(integration));
          return healthResult("connected", startedAt, { now, details: { account: label } });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: redactKeys(e instanceof Error ? e.message : String(e), secret) });
        }
      },
    },
    vercelMock,
  );
}

export { vercelMock, createVercelMock } from "./mock";
export { vercelTools, VERCEL_KEY } from "./tools";
