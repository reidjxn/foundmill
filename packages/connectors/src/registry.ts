/**
 * Connector registry (docs/ARCHITECTURE.md §8). `get(key, mode)` hands back the live connector or its
 * mock; the default mode is `INTEGRATIONS_MODE` from the environment, so `registry.get("stripe")` in
 * development is always the mock unless the operator opted into live integrations.
 */
import { loadEnv, NotFoundError } from "@foundmill/shared";
import type { Connector, ConnectorMode, ConnectorPhase, MockConnector, PolicyHints, McpToolDefinition, ConnectorAuth } from "./contract";
import { isMockConnector } from "./define";
import { mockWebhooksAllowed } from "./webhooks";

export interface ConnectorCatalogueEntry {
  key: string;
  displayName: string;
  phase: ConnectorPhase;
  auth: ConnectorAuth;
  mode: ConnectorMode;
  tools: McpToolDefinition[];
  policyHints: PolicyHints;
  webhookPaths: string[];
  rateLimits: Connector["rateLimits"];
  simulations: readonly string[];
}

export const currentMode = (): ConnectorMode => loadEnv().INTEGRATIONS_MODE;

/** One webhook a host may mount, with the side of the connector (live or mock) that verifies its deliveries. */
export interface MountableWebhook {
  connector: string;
  mode: ConnectorMode;
  path: string;
  webhook: NonNullable<Connector["webhooks"]>[number];
}

export class ConnectorRegistry {
  private readonly live = new Map<string, Connector>();

  register(connector: Connector): this {
    if (this.live.has(connector.key)) throw new Error(`Connector "${connector.key}" is already registered`);
    if (!connector.mock) throw new Error(`Connector "${connector.key}" has no mock (BUILD §13.1 requires one)`);
    if (connector.mock.key !== connector.key) throw new Error(`Connector "${connector.key}" mock has key "${connector.mock.key}"`);
    if (!isMockConnector(connector.mock)) throw new Error(`Connector "${connector.key}" mock must be built with buildMockConnector`);
    this.live.set(connector.key, connector);
    return this;
  }

  has(key: string): boolean {
    return this.live.has(key);
  }

  keys(): string[] {
    return [...this.live.keys()].sort();
  }

  /** The connector for `key` in `mode` (default: INTEGRATIONS_MODE). Throws NotFoundError for unknown keys. */
  get(key: string, mode: ConnectorMode = currentMode()): Connector {
    const live = this.live.get(key);
    if (!live) throw new NotFoundError("connector", key);
    return mode === "mock" ? live.mock : live;
  }

  getMock(key: string): MockConnector {
    return this.get(key, "mock") as MockConnector;
  }

  list(mode: ConnectorMode = currentMode()): Connector[] {
    return this.keys().map((k) => this.get(k, mode));
  }

  getByPhase(phase: ConnectorPhase, mode: ConnectorMode = currentMode()): Connector[] {
    return this.list(mode).filter((c) => c.phase === phase);
  }

  /** What `GET /v1/connectors` returns (docs/ARCHITECTURE.md §9). */
  catalogue(mode: ConnectorMode = currentMode()): ConnectorCatalogueEntry[] {
    return this.list(mode).map((c) => ({
      key: c.key,
      displayName: c.displayName,
      phase: c.phase,
      auth: c.auth,
      mode,
      tools: c.tools,
      policyHints: c.policyHints,
      webhookPaths: (c.webhooks ?? []).map((w) => w.path),
      rateLimits: c.rateLimits,
      simulations: isMockConnector(c) ? c.simulations : [],
    }));
  }

  /**
   * The webhooks `apps/ingest` may mount: a connector's live webhook when it runs live (`mode` live, or named in
   * `liveConnectors`, the LIVE_CONNECTORS list), its mock webhook only where `mockWebhooksAllowed(appEnv)`
   * (development, test). `refused` names the connectors whose mock webhooks were left unmounted.
   */
  mountableWebhooks(opts: { mode: ConnectorMode; appEnv: string; liveConnectors?: readonly string[] }): { mounted: MountableWebhook[]; refused: string[] } {
    const mounted: MountableWebhook[] = [];
    const refused: string[] = [];
    for (const key of this.keys()) {
      const mode: ConnectorMode = opts.mode === "live" || (opts.liveConnectors ?? []).includes(key) ? "live" : "mock";
      const connector = this.get(key, mode);
      const hooks = connector.webhooks ?? [];
      if (hooks.length === 0) continue;
      if (mode === "mock" && !mockWebhooksAllowed(opts.appEnv)) {
        refused.push(key);
        continue;
      }
      for (const webhook of hooks) mounted.push({ connector: key, mode, path: webhook.path, webhook });
    }
    return { mounted, refused };
  }

  /** Every webhook of every connector in `mode`, for `apps/ingest` to mount. */
  webhooks(mode: ConnectorMode = currentMode()): { connector: string; path: string; webhook: NonNullable<Connector["webhooks"]>[number] }[] {
    return this.list(mode).flatMap((c) => (c.webhooks ?? []).map((webhook) => ({ connector: c.key, path: webhook.path, webhook })));
  }
}

export function createRegistry(connectors: Iterable<Connector> = []): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  for (const c of connectors) registry.register(c);
  return registry;
}
