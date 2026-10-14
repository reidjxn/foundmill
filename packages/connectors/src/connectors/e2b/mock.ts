import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, perBusiness, stableHash } from "../../mock-utils";
import { E2B_KEY, E2B_RATE_LIMITS, e2bTools, type SandboxT } from "./tools";

const notFound = (id: string) => Object.assign(new Error(`sandbox ${id} not found`), { status: 404 });

/**
 * Sandbox ids derive from the create arguments, so identical creates are idempotent (and deterministic). Each business
 * has its own sandboxes: one business can neither list nor pause, extend or kill another's.
 */
export function createE2bMock(now: () => Date = () => MOCK_NOW) {
  const world = perBusiness(() => new Map<string, SandboxT>());
  const must = (sandboxes: Map<string, SandboxT>, id: string) => {
    const s = sandboxes.get(id);
    if (!s || s.state === "killed") throw notFound(id);
    return s;
  };
  const connector = buildMockConnector({
    key: E2B_KEY,
    displayName: "E2B sandboxes",
    phase: 1,
    auth: { kind: "api_key", platformKey: true },
    tools: e2bTools,
    rateLimits: E2B_RATE_LIMITS,
    now,
    handlers: {
      create_sandbox: async ({ templateId, timeoutSeconds, metadata }, ctx) => {
        const id = `i${stableHash([templateId, metadata], 19)}`;
        const startedAt = now();
        const sb: SandboxT = { sandboxId: id, templateId, clientId: "mock", state: "running", startedAt: startedAt.toISOString(), endAt: new Date(startedAt.getTime() + timeoutSeconds * 1000).toISOString(), cpuCount: 2, memoryMB: 512, metadata, domain: "e2b.app" };
        world(ctx.businessId).set(id, sb);
        return sb;
      },
      list_sandboxes: async ({ state, metadata, limit }, ctx) => {
        const [k, v] = metadata?.split("=") ?? [];
        return { items: [...world(ctx.businessId).values()].filter((s) => (state as string[]).includes(s.state) && (!k || s.metadata[k] === v)).slice(0, limit) };
      },
      get_sandbox: async ({ sandboxId }, ctx) => must(world(ctx.businessId), sandboxId),
      pause_sandbox: async ({ sandboxId }, ctx) => {
        const sandboxes = world(ctx.businessId);
        const s = must(sandboxes, sandboxId);
        sandboxes.set(sandboxId, { ...s, state: "paused" });
        return { sandboxId, state: "paused" as const };
      },
      resume_sandbox: async ({ sandboxId, timeoutSeconds }, ctx) => {
        const sandboxes = world(ctx.businessId);
        const s = must(sandboxes, sandboxId);
        const resumed: SandboxT = { ...s, state: "running", endAt: new Date(now().getTime() + timeoutSeconds * 1000).toISOString() };
        sandboxes.set(sandboxId, resumed);
        return resumed;
      },
      set_timeout: async ({ sandboxId, timeoutSeconds }, ctx) => {
        const sandboxes = world(ctx.businessId);
        const s = must(sandboxes, sandboxId);
        const endAt = new Date(now().getTime() + timeoutSeconds * 1000).toISOString();
        sandboxes.set(sandboxId, { ...s, endAt });
        return { sandboxId, endAt };
      },
      kill_sandbox: async ({ sandboxId }, ctx) => {
        const sandboxes = world(ctx.businessId);
        const s = must(sandboxes, sandboxId);
        sandboxes.set(sandboxId, { ...s, state: "killed" });
        return { sandboxId, state: "killed" as const };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(E2B_KEY, businessId, { accountLabel: "E2B (platform, mock)" }),
    healthcheck: async (integration) => mockHealth(E2B_KEY, { running: [...world(integration.businessId).values()].filter((s) => s.state === "running").length }),
  });
  /** Forget every business's sandboxes (tests). */
  return Object.assign(connector, { reset: () => world.clear() });
}

export const e2bMock = createE2bMock();
