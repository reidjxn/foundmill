/**
 * Contract: every agent template's tool grants (packages/agents) resolve to tools that exist (packages/connectors), the
 * way a live session mints its token and configures its MCP servers (audit GPC-03: 0 of 164 grants named a real tool and
 * /mcp/platform answered 404, so live agents had no usable tools). Since Nov 11, 2026 a template grants only what
 * resolves: no connector that is not built, no capability no tool serves (428 such capabilities were removed then and
 * are listed in packages/agents/src/templates/PLANNED_GRANTS.md). A new one fails here: build the tool, or leave the
 * grant out of the template. The gateway's own token grammar (apps/gateway/src/tokens.ts, imported by path like
 * gateway-token-contract.test.ts) must accept every ref.
 */
import { describe, expect, it } from "vitest";
import { ALL_TEMPLATES, PLATFORM_CONNECTOR_KEYS, THIRD_PARTY_CONNECTOR_KEYS, getLibrarySkill } from "@foundmill/agents";
import { GATEWAY_TOOL_NAMES, isServiceOnlyConnector, NOT_YET_SERVED, resolveGrants, SDK_BUILTIN_CAPABILITIES, servedGrants, SESSION_MANAGED_CAPABILITIES } from "@foundmill/connectors";
import { ToolRef } from "../../../gateway/src/tokens";
import { mcpToolNames, toolRefs } from "../activities/session";

const served = (connectorKey: string) => GATEWAY_TOOL_NAMES[connectorKey] !== undefined;
const workspace = (connectorKey: string) => SDK_BUILTIN_CAPABILITIES[connectorKey] !== undefined;

/** What to do about a grant that resolves to nothing: the message a failing template shows. */
const REMEDY = "Build the tool (a connector tool and its entry in packages/connectors/src/grants.ts), or leave the grant out of the template and note it in packages/agents/src/templates/PLANNED_GRANTS.md.";

describe("agent template grants resolve to real gateway tools", () => {
  it("every platform surface a template may name is served: by the gateway (platform, web, quarantine) or the session workspace (sandbox)", () => {
    for (const key of PLATFORM_CONNECTOR_KEYS) expect(served(key) || workspace(key), key).toBe(true);
  });

  it("every third-party connector a template may name is built and is an agent's to call", () => {
    for (const key of THIRD_PARTY_CONNECTOR_KEYS) {
      expect(served(key), `${key} is in THIRD_PARTY_CONNECTOR_KEYS (packages/agents/src/connectors.ts) but the gateway serves no such connector. ${REMEDY}`).toBe(true);
      expect(isServiceOnlyConnector(key), `${key} is a service-only connector: no template may grant it`).toBe(false);
    }
  });

  it("there are 48 templates and no deliberate gap is open", () => {
    expect(ALL_TEMPLATES).toHaveLength(48);
    expect(NOT_YET_SERVED).toEqual({});
  });

  it.each(ALL_TEMPLATES.map((t) => [t.key, t] as const))("%s", (_key, template) => {
    const resolved = resolveGrants(template.tools);
    // Every grant resolves completely: no capability nothing serves, no connector without an implementation.
    expect(
      resolved.unresolved.map((u) => `${u.connectorKey}.${u.capability} (${u.reason})`),
      `${template.key} grants what no tool serves. ${REMEDY}`,
    ).toEqual([]);
    // The token mints: every ref is in the gateway's grammar and names a tool of a served connector.
    for (const ref of resolved.toolRefs) {
      expect(ToolRef.safeParse(ref).success, ref).toBe(true);
      const [connector, tool] = ref.split(":") as [string, string];
      expect(tool === "*" || GATEWAY_TOOL_NAMES[connector]?.includes(tool), ref).toBe(true);
    }
    // One MCP server per served connector, never one the gateway would 404 (the session workspace has none).
    for (const server of resolved.servers) expect(served(server), server).toBe(true);
    expect(toolRefs(template.tools)).toEqual(resolved.toolRefs);
    expect(mcpToolNames(template.tools)).toEqual(resolved.mcpTools);
    // What a founder is shown is the template's grants as they are: nothing is hidden because nothing is unserved.
    expect(servedGrants(template.tools)).toEqual(template.tools.map((g) => ({ connectorKey: g.connectorKey, tools: [...g.tools] })));

    for (const grant of template.tools) {
      // The connector exists: the gateway serves it, or it is the session workspace.
      expect(served(grant.connectorKey) || workspace(grant.connectorKey), `${template.key}: the ${grant.connectorKey} connector is not built. ${REMEDY}`).toBe(true);
      const one = resolveGrants([grant]);
      const managed = grant.tools.every((c) => SESSION_MANAGED_CAPABILITIES[grant.connectorKey]?.[c]);
      // Every grant gives the agent at least one real tool (or is handled by the session itself).
      expect(one.toolRefs.length + one.builtinTools.length > 0 || managed, `${template.key}: ${grant.connectorKey} [${grant.tools.join(", ")}] resolves to nothing. ${REMEDY}`).toBe(true);
      // Capability by capability, so the failure names the one to build or drop.
      for (const capability of grant.tools) {
        expect(resolveGrants([{ connectorKey: grant.connectorKey, tools: [capability] }]).unresolved, `${template.key}: ${grant.connectorKey}.${capability} resolves to no tool. ${REMEDY}`).toEqual([]);
      }
    }
  });

  it("a grant nothing serves is reported with the capability and the reason, which is what fails a template", () => {
    const gap = resolveGrants([{ connectorKey: "instagram", tools: ["media.publish"] }, { connectorKey: "platform", tools: ["tasks.list", "campaigns.create"] }, { connectorKey: "sandbox", tools: ["shell"] }]);
    expect(gap.unresolved).toEqual([
      { connectorKey: "instagram", capability: "media.publish", reason: "the instagram connector is not built yet" },
      { connectorKey: "platform", capability: "campaigns.create", reason: 'platform has no tool for "campaigns.create"' },
      { connectorKey: "sandbox", capability: "shell", reason: "not a capability of the session workspace" },
    ]);
    expect(gap.toolRefs).toEqual(["platform:list_tasks", "platform:get_task"]);
  });

  it("every agent with the base platform grant can work the board, message the team and ask the founder", () => {
    const withBoard = ALL_TEMPLATES.filter((t) => t.tools.some((g) => g.connectorKey === "platform" && g.tools.includes("tasks.list")));
    expect(withBoard.length).toBeGreaterThan(30);
    for (const t of withBoard) {
      const refs = toolRefs(t.tools);
      for (const ref of ["platform:list_tasks", "platform:claim_task", "platform:complete_task", "platform:send_message", "platform:list_messages", "platform:request_human_action"]) expect(refs, `${t.key} lacks ${ref}`).toContain(ref);
    }
  });

  it("every agent with the base platform grant can read the product notes, which the brief's About section points to (WP-05 T4)", () => {
    const withBoard = ALL_TEMPLATES.filter((t) => t.tools.some((g) => g.connectorKey === "platform" && g.tools.includes("tasks.list")));
    for (const t of withBoard) expect(toolRefs(t.tools), `${t.key} lacks platform:read_product`).toContain("platform:read_product");
    const backend = ALL_TEMPLATES.find((t) => t.agentType === "backend_engineer")!;
    expect(mcpToolNames(backend.tools)).toContain("mcp__platform__read_product");
  });

  it("every agent with the base platform grant can read its own skills' text (WP-06 T4: skills.read → read_skill)", () => {
    expect(resolveGrants([{ connectorKey: "platform", tools: ["skills.read"] }]).toolRefs).toEqual(["platform:read_skill"]);
    const withBoard = ALL_TEMPLATES.filter((t) => t.tools.some((g) => g.connectorKey === "platform" && g.tools.includes("tasks.list")));
    for (const t of withBoard) expect(toolRefs(t.tools), `${t.key} lacks platform:read_skill`).toContain("platform:read_skill");
    expect(mcpToolNames(ALL_TEMPLATES.find((t) => t.agentType === "backend_engineer")!.tools)).toContain("mcp__platform__read_skill");
  });

  it("every role the cold email skill is for can run the suppression check it asks for (WP-06 T4 tool review)", () => {
    const roles = getLibrarySkill("cold_email")!.roles;
    expect(roles.length).toBeGreaterThan(0);
    for (const key of roles) {
      const t = ALL_TEMPLATES.find((x) => x.key === key)!;
      expect(toolRefs(t.tools), `${key} lacks platform:check_contact`).toContain("platform:check_contact");
    }
  });
});
