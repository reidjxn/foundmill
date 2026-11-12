/**
 * Test doubles for SEC-14 (the api reaches no vendor itself):
 * - `guardLiveCalls(registry)` makes every live connector the api's registry hands out refuse to run: `connect`,
 *   `healthcheck` and `callTool` on a live connector record the call and throw. Static metadata (auth kind, tools,
 *   connect fields) still reads, and mocks still run.
 * - `inProcessGateway()` is the api's real gateway client (`createApiGatewayClient`, the service token included) over an
 *   in-process apps/gateway app, bound once the harness's database and vault exist; `paths` records every route asked.
 */
import { createApiGatewayClient, type ApiGatewayClient } from "../services/gateway";
import type { Connector, ConnectorRegistry } from "@foundmill/connectors";
import type { Db } from "@foundmill/db";
import type { Vault } from "@foundmill/shared/crypto";
import { createGatewayApp } from "../../../gateway/src/app";
import type { GatewayDeps } from "../../../gateway/src/pipeline";
import { MemoryRateLimitStore } from "../../../gateway/src/rate-limit";
import { UntrustedRecipientRegistry } from "../../../gateway/src/recipients";
import { TEST_SESSION_TOKEN_SECRET } from "./harness";

const RUNS = new Set(["connect", "healthcheck", "callTool"]);

export function guardLiveCalls(registry: ConnectorRegistry): { registry: ConnectorRegistry; liveCalls: string[] } {
  const liveCalls: string[] = [];
  const get = registry.get.bind(registry);
  registry.get = (key: string, mode?: "mock" | "live"): Connector => {
    const connector = get(key, mode);
    // A live connector carries its mock; the mock itself does not.
    if (!connector.mock || connector.mock === connector) return connector;
    return new Proxy(connector, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && RUNS.has(prop)) {
          return () => {
            liveCalls.push(`${key}.${prop}`);
            throw new Error(`${key}.${prop} ran live in the api (SEC-14: it belongs to the gateway)`);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
  };
  return { registry, liveCalls };
}

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silent };

export interface InProcessGateway {
  client: ApiGatewayClient;
  /** Every route the api asked, in order. */
  paths: string[];
  /** Builds the gateway over the api's own database and vault (the way a deployment shares them). */
  bind(options: { db: Db; vault: Vault | null; registry: ConnectorRegistry; mode?: "mock" | "live"; liveConnectors?: string[]; validateModelKey?: GatewayDeps["validateModelKey"] }): GatewayDeps;
}

export function inProcessGateway(): InProcessGateway {
  let app: ReturnType<typeof createGatewayApp> | null = null;
  const paths: string[] = [];
  const client = createApiGatewayClient({
    url: "http://gateway.test",
    secret: TEST_SESSION_TOKEN_SECRET,
    fetch: async (input, init) => {
      if (!app) throw new Error("the in-process gateway is not bound yet");
      const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
      paths.push(path);
      return app.request(path, init);
    },
  });
  return {
    client,
    paths,
    bind(options) {
      const deps: GatewayDeps = {
        db: options.db,
        registry: options.registry,
        vault: options.vault,
        mode: options.mode ?? "mock",
        ...(options.liveConnectors ? { liveConnectors: options.liveConnectors } : {}),
        rateLimits: new MemoryRateLimitStore(),
        recipients: new UntrustedRecipientRegistry(),
        log: silent,
        ...(options.validateModelKey ? { validateModelKey: options.validateModelKey } : {}),
      };
      app = createGatewayApp(deps, { sessionTokenSecret: TEST_SESSION_TOKEN_SECRET });
      return deps;
    },
  };
}
