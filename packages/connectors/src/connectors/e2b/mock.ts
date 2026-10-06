import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { E2B_KEY, E2B_RATE_LIMITS, e2bTools, type SandboxT } from "./tools";

const notFound = (id: string) => Object.assign(new Error(`sandbox ${id} not found`), { status: 404 });

/** Sandbox ids derive from the create arguments, so identical creates are idempotent (and deterministic). */
export function createE2bMock(now: () => Date = () => MOCK_NOW) {
  const sandboxes = new Map<string, SandboxT>();
  const must = (id: string) => {
    const s = sandboxes.get(id);
    if (!s || s.state === "killed") throw notFound(id);
    return s;
  };
  const connector = buildMockConnector({
    key: E2B_KEY,
    displayName: "E2B sandboxes",
    phase: 1,
    auth: { kind: "api_key" },
    tools: e2bTools,
    rateLimits: E2B_RATE_LIMITS,
    now,
    handlers: {
      create_sandbox: async ({ templateId, timeoutSeconds, metadata }) => {
        const id = `i${stableHash([templateId, metadata], 19)}`;
        const startedAt = now();
        const sb: SandboxT = { sandboxId: id, templateId, clientId: "mock", state: "running", startedAt: startedAt.toISOString(), endAt: new Date(startedAt.getTime() + timeoutSeconds * 1000).toISOString(), cpuCount: 2, memoryMB: 512, metadata, domain: "e2b.app" };
        sandboxes.set(id, sb);
        return sb;
      },
      list_sandboxes: async ({ state, metadata, limit }) => {
        const [k, v] = metadata?.split("=") ?? [];
        return { items: [...sandboxes.values()].filter((s) => (state as string[]).includes(s.state) && (!k || s.metadata[k] === v)).slice(0, limit) };
      },
      get_sandbox: async ({ sandboxId }) => must(sandboxId),
      pause_sandbox: async ({ sandboxId }) => {
        const s = must(sandboxId);
        sandboxes.set(sandboxId, { ...s, state: "paused" });
        return { sandboxId, state: "paused" as const };
      },
      resume_sandbox: async ({ sandboxId, timeoutSeconds }) => {
        const s = must(sandboxId);
        const resumed: SandboxT = { ...s, state: "running", endAt: new Date(now().getTime() + timeoutSeconds * 1000).toISOString() };
        sandboxes.set(sandboxId, resumed);
        return resumed;
      },
      set_timeout: async ({ sandboxId, timeoutSeconds }) => {
        const s = must(sandboxId);
        const endAt = new Date(now().getTime() + timeoutSeconds * 1000).toISOString();
        sandboxes.set(sandboxId, { ...s, endAt });
        return { sandboxId, endAt };
      },
      kill_sandbox: async ({ sandboxId }) => {
        const s = must(sandboxId);
        sandboxes.set(sandboxId, { ...s, state: "killed" });
        return { sandboxId, state: "killed" as const };
      },
    },
    connect: async (businessId) => mockIntegrationRecord(E2B_KEY, businessId, { accountLabel: "E2B (platform, mock)" }),
    healthcheck: async () => mockHealth(E2B_KEY, { running: [...sandboxes.values()].filter((s) => s.state === "running").length }),
  });
  return Object.assign(connector, { reset: () => sandboxes.clear() });
}

export const e2bMock = createE2bMock();
