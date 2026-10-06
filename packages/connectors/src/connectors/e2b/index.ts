/** Live E2B connector over the REST API (base https://api.e2b.app, header X-API-Key). */
import { uuid } from "@founder-manager/shared";
import { ConfigError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { e2bMock } from "./mock";
import { E2B_BASE_URL, E2B_KEY, E2B_RATE_LIMITS, e2bTools, mapSandbox, type E2bCreateResponse, type E2bListedSandbox } from "./tools";

export function createE2bConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const http = (): HttpClient => {
    if (!secrets.e2bApiKey) throw new ConfigError(E2B_KEY, "E2B_API_KEY");
    return createHttp({ connectorKey: E2B_KEY, baseUrl: E2B_BASE_URL, fetch, headers: { "x-api-key": secrets.e2bApiKey } });
  };
  const getSandbox = async (h: HttpClient, id: string) => mapSandbox(await h.json<E2bListedSandbox>("GET", `/sandboxes/${id}`));

  return buildLiveConnector(
    {
      key: E2B_KEY,
      displayName: "E2B sandboxes",
      phase: 1,
      auth: { kind: "api_key" },
      tools: e2bTools,
      rateLimits: E2B_RATE_LIMITS,
      now,
      handlers: {
        create_sandbox: async ({ templateId, timeoutSeconds, metadata, envVars }) => {
          const h = http();
          const created = await h.json<E2bCreateResponse>("POST", "/v2/sandboxes", { body: { templateID: templateId, timeout: timeoutSeconds, metadata, envVars } });
          const startedAt = now();
          try {
            return await getSandbox(h, created.sandboxID);
          } catch {
            return { sandboxId: created.sandboxID, templateId: created.templateID, clientId: created.clientID ?? null, state: "running" as const, startedAt: startedAt.toISOString(), endAt: new Date(startedAt.getTime() + timeoutSeconds * 1000).toISOString(), cpuCount: null, memoryMB: null, metadata, domain: created.domain ?? null };
          }
        },
        list_sandboxes: async ({ state, metadata, limit }) => ({ items: (await http().json<E2bListedSandbox[]>("GET", "/v2/sandboxes", { query: { state, metadata, limit } })).map(mapSandbox) }),
        get_sandbox: async ({ sandboxId }) => getSandbox(http(), sandboxId),
        pause_sandbox: async ({ sandboxId }) => {
          await http().raw("POST", `/sandboxes/${sandboxId}/pause`, { body: { memory: true } });
          return { sandboxId, state: "paused" as const };
        },
        resume_sandbox: async ({ sandboxId, timeoutSeconds }) => {
          const h = http();
          await h.raw("POST", `/sandboxes/${sandboxId}/resume`, { body: { timeout: timeoutSeconds, memory: true } });
          return getSandbox(h, sandboxId);
        },
        set_timeout: async ({ sandboxId, timeoutSeconds }) => {
          await http().raw("POST", `/sandboxes/${sandboxId}/timeout`, { body: { timeout: timeoutSeconds } });
          return { sandboxId, endAt: new Date(now().getTime() + timeoutSeconds * 1000).toISOString() };
        },
        kill_sandbox: async ({ sandboxId }) => {
          await http().raw("DELETE", `/sandboxes/${sandboxId}`, { okStatuses: [404] });
          return { sandboxId, state: "killed" as const };
        },
      },
      connect: async (businessId) => {
        await http().json("GET", "/v2/sandboxes", { query: { limit: 1 } });
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: E2B_KEY, status: "connected", scopes: [], accountLabel: "E2B (platform)", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          const running = await http().json<E2bListedSandbox[]>("GET", "/v2/sandboxes", { query: { limit: 100 } });
          return healthResult("connected", startedAt, { now, details: { running: running.length } });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    e2bMock,
  );
}

export { e2bMock, createE2bMock } from "./mock";
export { e2bTools, E2B_KEY } from "./tools";
