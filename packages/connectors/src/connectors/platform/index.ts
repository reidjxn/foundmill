/**
 * Live platform connector: the platform tools over the host's database (`LiveConnectorOptions.platform`, which the
 * gateway provides). Not a vendor: it needs no credential and runs live in every INTEGRATIONS_MODE, so agents in a
 * mock-mode deployment still work on the real task board. Not part of CONNECTOR_FACTORIES (Settings › Integrations
 * has nothing to connect); the gateway registers it next to them (BUILTIN_CONNECTOR_FACTORIES).
 */
import { ConfigError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { mockIntegrationRecord } from "../../mock-utils";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { platformHandlers, platformMock } from "./mock";
import { PLATFORM_KEY, PLATFORM_RATE_LIMITS, platformTools, type PlatformHost } from "./tools";

/** Every host call refuses with a ConfigError (503) when the process wired no host. */
const unwired: PlatformHost = new Proxy({} as PlatformHost, {
  get: () => async () => {
    throw new ConfigError(PLATFORM_KEY, "the platform host", "the gateway passes `platform` in LiveConnectorOptions");
  },
});

export function createPlatformConnector(options: LiveConnectorOptions = {}): Connector {
  const { now } = resolveLiveOptions(options);
  return buildLiveConnector(
    {
      key: PLATFORM_KEY,
      displayName: "Task board and team",
      phase: 1,
      auth: { kind: "none" },
      tools: platformTools,
      rateLimits: PLATFORM_RATE_LIMITS,
      now,
      handlers: platformHandlers(options.platform ?? unwired),
      connect: async (businessId) => mockIntegrationRecord(PLATFORM_KEY, businessId, { status: "connected", accountLabel: "Built in" }),
      healthcheck: async () => healthResult(options.platform ? "connected" : "disconnected", now().getTime(), { now }),
    },
    platformMock,
  );
}

export { platformMock, createPlatformMock, createMemoryPlatformHost, platformHandlers } from "./mock";
export { platformTools, PLATFORM_KEY, PlatformToolError, REPORT_EXCERPT_CHARS, MESSAGE_TYPES, type PlatformHost, type PlatformCaller, type PlatformArgs, type PlatformResult, type TaskSummaryT, type TaskDetailT, type AgentMessageT } from "./tools";
