/**
 * Contract: every agent template's tool grants (packages/agents) resolve to tools the gateway really serves
 * (packages/connectors), the way a live session mints its token and configures its MCP servers (audit GPC-03: 0 of 164
 * grants named a real tool and /mcp/platform answered 404, so live agents had no usable tools). A new grant that no
 * tool serves fails here unless it is a deliberate, explained gap (NOT_YET_SERVED) or a connector of a later phase.
 * The gateway's own token grammar (apps/gateway/src/tokens.ts, imported by path like gateway-token-contract.test.ts)
 * must accept every ref.
 */
import { describe, expect, it } from "vitest";
import { ALL_TEMPLATES, PLATFORM_CONNECTOR_KEYS, THIRD_PARTY_CONNECTOR_KEYS } from "@foundmill/agents";
import { GATEWAY_TOOL_NAMES, NOT_YET_SERVED, resolveGrants, SDK_BUILTIN_CAPABILITIES, SESSION_MANAGED_CAPABILITIES } from "@foundmill/connectors";
import { ToolRef } from "../../../gateway/src/tokens";
import { mcpToolNames, toolRefs } from "../activities/session";

const served = (connectorKey: string) => GATEWAY_TOOL_NAMES[connectorKey] !== undefined;
const workspace = (connectorKey: string) => SDK_BUILTIN_CAPABILITIES[connectorKey] !== undefined;
const later = new Set<string>(THIRD_PARTY_CONNECTOR_KEYS.filter((k) => !served(k)));

describe("agent template grants resolve to real gateway tools", () => {
  it("every platform surface a template may name is served: by the gateway (platform, web, quarantine) or the session workspace (sandbox)", () => {
    for (const key of PLATFORM_CONNECTOR_KEYS) expect(served(key) || workspace(key), key).toBe(true);
  });

  it.each(ALL_TEMPLATES.map((t) => [t.key, t] as const))("%s", (_key, template) => {
    const resolved = resolveGrants(template.tools);
    // The token mints: every ref is in the gateway's grammar and names a tool of a served connector.
    for (const ref of resolved.toolRefs) {
      expect(ToolRef.safeParse(ref).success, ref).toBe(true);
      const [connector, tool] = ref.split(":") as [string, string];
      expect(tool === "*" || GATEWAY_TOOL_NAMES[connector]?.includes(tool), ref).toBe(true);
    }
    // One MCP server per served connector, never one the gateway would 404 (sandbox, a later-phase connector).
    for (const server of resolved.servers) expect(served(server), server).toBe(true);
    expect(toolRefs(template.tools)).toEqual(resolved.toolRefs);
    expect(mcpToolNames(template.tools)).toEqual(resolved.mcpTools);

    for (const grant of template.tools) {
      if (!served(grant.connectorKey) && !workspace(grant.connectorKey)) {
        // A connector this repo does not build yet: a known key of a later phase, with no server and no ref.
        expect(later.has(grant.connectorKey), `${template.key}: unknown connector ${grant.connectorKey}`).toBe(true);
        continue;
      }
      const one = resolveGrants([grant]);
      const managed = grant.tools.every((c) => SESSION_MANAGED_CAPABILITIES[grant.connectorKey]?.[c]);
      // Every grant on a served connector gives the agent at least one real tool (or is handled by the session itself).
      expect(one.toolRefs.length + one.builtinTools.length > 0 || managed, `${template.key}: ${grant.connectorKey} [${grant.tools.join(", ")}] resolves to nothing`).toBe(true);
      // A capability nothing serves yet is a deliberate, explained gap, never a silent one.
      for (const gap of one.unresolved) expect(NOT_YET_SERVED[gap.connectorKey]?.[gap.capability], `${template.key}: ${gap.connectorKey}.${gap.capability} (${gap.reason})`).toBeDefined();
    }
  });

  it("every agent with the base platform grant can work the board, message the team and ask the founder", () => {
    const withBoard = ALL_TEMPLATES.filter((t) => t.tools.some((g) => g.connectorKey === "platform" && g.tools.includes("tasks.list")));
    expect(withBoard.length).toBeGreaterThan(30);
    for (const t of withBoard) {
      const refs = toolRefs(t.tools);
      for (const ref of ["platform:list_tasks", "platform:claim_task", "platform:complete_task", "platform:send_message", "platform:list_messages", "platform:request_human_action"]) expect(refs, `${t.key} lacks ${ref}`).toContain(ref);
    }
  });
});
