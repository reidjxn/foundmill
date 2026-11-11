/**
 * Agent tool grants → real tools (audit GPC-03: 0 of 164 template grants named a real connector tool, so live sessions
 * listed no tools). The capability map must name only tools that exist, stay in step with what the gateway registers,
 * and `resolveGrants` must give a session exactly the servers the gateway serves. The per-template contract (every
 * grant of every template) is in apps/orchestrator, which sees both packages/agents and this package.
 */
import { describe, expect, it } from "vitest";
import { BUILTIN_CONNECTOR_KEYS, CONNECTOR_KEYS, createAllConnectors, createBuiltinConnectors } from "../catalogue";
import { CAPABILITY_TOOLS, GATEWAY_TOOL_NAMES, NOT_YET_SERVED, resolveGrants, ROUTE_ONLY_REASON, ROUTE_ONLY_TOOLS, SDK_BUILTIN_CAPABILITIES, SERVICE_ONLY_CONNECTORS, SERVICE_ONLY_REASON, SESSION_MANAGED_CAPABILITIES, toolsForCapability } from "../grants";

describe("the capability map", () => {
  it("knows every tool of every connector the gateway serves, and nothing else", () => {
    const served = [...createAllConnectors({ secrets: {} }), ...createBuiltinConnectors({ secrets: {} })];
    expect(Object.keys(GATEWAY_TOOL_NAMES).sort()).toEqual([...CONNECTOR_KEYS, ...BUILTIN_CONNECTOR_KEYS].sort());
    for (const c of served) expect([...GATEWAY_TOOL_NAMES[c.key]!].sort(), c.key).toEqual(c.tools.map((t) => t.name).sort());
  });

  it("maps every capability to tools that exist on its connector", () => {
    for (const [connector, capabilities] of Object.entries(CAPABILITY_TOOLS)) {
      const real = GATEWAY_TOOL_NAMES[connector];
      expect(real, `${connector} is not served by the gateway`).toBeDefined();
      for (const [capability, tools] of Object.entries(capabilities)) {
        expect(tools.length, `${connector}.${capability}`).toBeGreaterThan(0);
        for (const t of tools) expect(real, `${connector}.${capability} → ${t}`).toContain(t);
      }
    }
  });

  it("lists a gap only while nothing serves it, and never on a connector of a later phase", () => {
    for (const [connector, gaps] of Object.entries(NOT_YET_SERVED)) {
      expect(GATEWAY_TOOL_NAMES[connector] ?? SDK_BUILTIN_CAPABILITIES[connector], `${connector} is neither served nor the session workspace`).toBeDefined();
      for (const capability of Object.keys(gaps)) {
        expect(toolsForCapability(connector, capability), `${connector}.${capability} is served now; drop it from NOT_YET_SERVED`).toEqual([]);
        expect(SDK_BUILTIN_CAPABILITIES[connector]?.[capability], `${connector}.${capability}`).toBeUndefined();
        expect(SESSION_MANAGED_CAPABILITIES[connector]?.[capability], `${connector}.${capability}`).toBeUndefined();
      }
    }
    for (const [connector, managed] of Object.entries(SESSION_MANAGED_CAPABILITIES)) {
      for (const capability of Object.keys(managed)) expect(toolsForCapability(connector, capability), `${connector}.${capability}`).toEqual([]);
    }
  });
});

describe("resolveGrants", () => {
  it("turns template capabilities into the real tools that serve them", () => {
    const r = resolveGrants([{ connectorKey: "github", tools: ["repos.read", "pulls.merge"] }, { connectorKey: "platform", tools: ["tasks.list", "messages.request", "inbox.request_human_action"] }]);
    expect(r.toolRefs).toEqual(["github:list_repos", "github:read_tree", "github:read_file", "github:compare_refs", "github:merge_pr", "platform:list_tasks", "platform:get_task", "platform:send_message", "platform:list_messages", "platform:request_human_action"]);
    expect(r.mcpTools).toContain("mcp__platform__request_human_action");
    expect(r.servers).toEqual(["github", "platform"]);
    expect(r.unresolved).toEqual([]);
  });

  it("accepts real tool names (what the Tools tab saves) and wildcards, without duplicates", () => {
    const r = resolveGrants([{ connectorKey: "gmail", tools: ["send_message", "threads.read", "get_message"] }, { connectorKey: "stripe", tools: ["*"] }, { connectorKey: "stripe", tools: ["get_balance"] }]);
    expect(r.toolRefs).toEqual(["gmail:send_message", "gmail:list_messages", "gmail:get_message", "gmail:list_labels", "stripe:*", "stripe:get_balance"]);
    expect(r.mcpTools).toEqual(["mcp__gmail__send_message", "mcp__gmail__list_messages", "mcp__gmail__get_message", "mcp__gmail__list_labels", "mcp__stripe", "mcp__stripe__get_balance"]);
    expect(r.servers).toEqual(["gmail", "stripe"]);
  });

  it("gives no MCP server for what the gateway does not serve: the session workspace, a later-phase connector, an unknown name", () => {
    const r = resolveGrants([
      { connectorKey: "sandbox", tools: ["read_file", "write_file", "shell", "git.commit"] },
      { connectorKey: "figma", tools: ["files.read"] },
      { connectorKey: "github", tools: ["issues.list", "repos.delete"] },
      { connectorKey: "platform", tools: ["labels.read"] },
    ]);
    expect(r.servers).toEqual([]);
    expect(r.toolRefs).toEqual([]);
    expect(r.builtinTools).toEqual(["Read", "Glob", "Grep", "Edit", "Write"]);
    expect(r.unresolved).toEqual([
      { connectorKey: "sandbox", capability: "shell", reason: NOT_YET_SERVED.sandbox!.shell },
      { connectorKey: "figma", capability: "files.read", reason: "the figma connector is not built yet" },
      { connectorKey: "github", capability: "issues.list", reason: NOT_YET_SERVED.github!["issues.list"] },
      { connectorKey: "github", capability: "repos.delete", reason: 'github has no tool for "repos.delete"' },
    ]);
  });

  it("never puts a route-only tool (the repository archive) in an agent's token: not by capability, by name or through *", () => {
    expect([...ROUTE_ONLY_TOOLS].sort()).toEqual(["github:download_archive", "github:get_repository"]);
    const r = resolveGrants([{ connectorKey: "github", tools: ["repos.read", "download_archive", "get_repository"] }]);
    expect(r.toolRefs).toEqual(["github:list_repos", "github:read_tree", "github:read_file", "github:compare_refs"]);
    expect(r.unresolved).toEqual([
      { connectorKey: "github", capability: "download_archive", reason: ROUTE_ONLY_REASON },
      { connectorKey: "github", capability: "get_repository", reason: ROUTE_ONLY_REASON },
    ]);
    const wildcard = resolveGrants([{ connectorKey: "github", tools: ["*"] }]);
    expect(wildcard.toolRefs).not.toContain("github:*");
    expect(wildcard.toolRefs).not.toContain("github:download_archive");
    expect(wildcard.toolRefs).not.toContain("github:get_repository");
    expect(wildcard.toolRefs).toContain("github:commit_files");
    expect(wildcard.mcpTools).not.toContain("mcp__github");
    expect(wildcard.servers).toEqual(["github"]);
  });

  it("never gives an agent a service-only connector (openai_images, onesignal), whatever the grant names", () => {
    expect([...SERVICE_ONLY_CONNECTORS]).toEqual(["openai_images", "onesignal"]);
    const push = resolveGrants([{ connectorKey: "onesignal", tools: ["send_push"] }]);
    expect(push.toolRefs.some((t) => t.startsWith("onesignal"))).toBe(false);
    expect(push.unresolved).toEqual([{ connectorKey: "onesignal", capability: "send_push", reason: SERVICE_ONLY_REASON }]);
    const r = resolveGrants([{ connectorKey: "openai_images", tools: ["generate_image", "*"] }, { connectorKey: "platform", tools: ["tasks.list"] }]);
    expect(r.servers).toEqual(["platform"]);
    expect(r.toolRefs.some((t) => t.startsWith("openai_images"))).toBe(false);
    expect(r.mcpTools.some((t) => t.startsWith("mcp__openai_images"))).toBe(false);
    expect(r.unresolved).toEqual([
      { connectorKey: "openai_images", capability: "generate_image", reason: SERVICE_ONLY_REASON },
      { connectorKey: "openai_images", capability: "*", reason: SERVICE_ONLY_REASON },
    ]);
    expect(SERVICE_ONLY_REASON).toBe("the platform calls this connector itself; agents never do");
  });
});
