/**
 * Agent tool grants → real tools (audit GPC-03: 0 of 164 template grants named a real connector tool, so live sessions
 * listed no tools). The capability map must name only tools that exist, stay in step with what the gateway registers,
 * and `resolveGrants` must give a session exactly the servers the gateway serves. The per-template contract (every
 * grant of every template) is in apps/orchestrator, which sees both packages/agents and this package.
 */
import { describe, expect, it } from "vitest";
import { BUILTIN_CONNECTOR_KEYS, CONNECTOR_KEYS, createAllConnectors, createBuiltinConnectors } from "../catalogue";
import { CAPABILITY_TOOLS, GATEWAY_TOOL_NAMES, grantsActOutside, NOT_YET_SERVED, resolveGrants, ROUTE_ONLY_REASON, ROUTE_ONLY_TOOLS, SDK_BUILTIN_CAPABILITIES, servedGrants, SERVICE_ONLY_CONNECTORS, SERVICE_ONLY_REASON, SESSION_MANAGED_CAPABILITIES, toolsForCapability } from "../grants";

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
      { connectorKey: "sandbox", capability: "shell", reason: "not a capability of the session workspace" },
      { connectorKey: "figma", capability: "files.read", reason: "the figma connector is not built yet" },
      { connectorKey: "github", capability: "issues.list", reason: 'github has no tool for "issues.list"' },
      { connectorKey: "github", capability: "repos.delete", reason: 'github has no tool for "repos.delete"' },
    ]);
  });

  it("lists no gap today: every template grant resolves, and the table stays for a deliberate new one", () => {
    expect(NOT_YET_SERVED).toEqual({});
    expect(Object.isFrozen(NOT_YET_SERVED)).toBe(true);
  });

  it("never puts a route-only tool (the repository archive) in an agent's token: not by capability, by name or through *", () => {
    expect([...ROUTE_ONLY_TOOLS].sort()).toEqual(["github:download_archive", "github:get_repository", "runway:download_video"]);
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

  it("never gives an agent a service-only connector (openai_images, onesignal, platform_notify, elevenlabs), whatever the grant names", () => {
    expect([...SERVICE_ONLY_CONNECTORS]).toEqual(["openai_images", "onesignal", "platform_notify", "elevenlabs"]);
    const speech = resolveGrants([{ connectorKey: "elevenlabs", tools: ["synthesize_speech", "*"] }]);
    expect(speech.toolRefs).toEqual([]);
    expect(speech.servers).toEqual([]);
    expect(speech.unresolved).toEqual([
      { connectorKey: "elevenlabs", capability: "synthesize_speech", reason: SERVICE_ONLY_REASON },
      { connectorKey: "elevenlabs", capability: "*", reason: SERVICE_ONLY_REASON },
    ]);
    const notify = resolveGrants([{ connectorKey: "platform_notify", tools: ["send_notification", "*"] }]);
    expect(notify.toolRefs).toEqual([]);
    expect(notify.servers).toEqual([]);
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
    const mail = resolveGrants([{ connectorKey: "platform_notify", tools: ["send_notification"] }]);
    expect(mail.servers).toEqual([]);
    expect(mail.toolRefs).toEqual([]);
    expect(mail.unresolved).toEqual([{ connectorKey: "platform_notify", capability: "send_notification", reason: SERVICE_ONLY_REASON }]);
    expect(SERVICE_ONLY_REASON).toBe("the platform calls this connector itself; agents never do");
  });
});

describe("servedGrants (what a founder is shown)", () => {
  it("drops grants on connectors that are not built and capabilities no tool serves, and keeps the rest as stored", () => {
    // What an agent hired before Nov 11, 2026 still holds: a social engine's version copied from the old template.
    const stored = [
      { connectorKey: "platform", tools: ["tasks.list", "campaigns.create", "assets.create", "inbox.request_human_action", "crm.entities.create"] },
      { connectorKey: "quarantine", tools: ["read_untrusted"] },
      { connectorKey: "instagram", tools: ["media.publish", "comments.list"] },
      { connectorKey: "x_publishing", tools: ["posts.publish"] },
      { connectorKey: "sendgrid", tools: ["mail.send", "subusers.read"] },
    ];
    expect(servedGrants(stored)).toEqual([
      { connectorKey: "platform", tools: ["tasks.list", "inbox.request_human_action"] },
      { connectorKey: "quarantine", tools: ["read_untrusted"] },
      { connectorKey: "sendgrid", tools: ["mail.send"] },
    ]);
    // The input is not changed.
    expect(stored[0]!.tools).toHaveLength(5);
  });

  it("keeps real tool names, wildcards, the session workspace's file tools and what the session does itself", () => {
    const grants = [
      { connectorKey: "github", tools: ["open_pr", "repos.read", "issues.list", "download_archive"] },
      { connectorKey: "stripe", tools: ["*"] },
      { connectorKey: "sandbox", tools: ["read_file", "write_file", "git.commit", "shell"] },
      { connectorKey: "platform", tools: ["labels.read"] },
    ];
    expect(servedGrants(grants)).toEqual([
      { connectorKey: "github", tools: ["open_pr", "repos.read"] },
      { connectorKey: "stripe", tools: ["*"] },
      { connectorKey: "sandbox", tools: ["read_file", "write_file", "git.commit"] },
      { connectorKey: "platform", tools: ["labels.read"] },
    ]);
  });

  it("shows nothing for a service-only connector or a grant with nothing left, and what it keeps resolves completely", () => {
    expect(servedGrants([{ connectorKey: "onesignal", tools: ["send_push"] }, { connectorKey: "figma", tools: ["files.read"] }, { connectorKey: "platform", tools: ["documents.write"] }])).toEqual([]);
    expect(servedGrants([])).toEqual([]);
    const stored = [{ connectorKey: "platform", tools: ["tasks.list", "rfq.create"] }, { connectorKey: "lob", tools: ["letters.create"] }];
    const kept = servedGrants(stored);
    expect(resolveGrants(kept).unresolved).toEqual([]);
    // Nothing real is hidden: what is shown resolves to exactly the tools the stored grants gave a session.
    expect(resolveGrants(kept).toolRefs).toEqual(resolveGrants(stored).toolRefs);
  });
});

describe("grantsActOutside (the credit saver keeps outward and money work on its model)", () => {
  it("is true when a granted tool reaches someone outside the business or spends money, and agrees with the connectors' own hints", () => {
    expect(grantsActOutside(resolveGrants([{ connectorKey: "resend", tools: ["mail.send"] }]).toolRefs)).toBe(true);
    expect(grantsActOutside(["platform_mail:*"])).toBe(true);
    const served = [...createAllConnectors({ secrets: {} }), ...createBuiltinConnectors({ secrets: {} })];
    for (const c of served) {
      for (const [tool, hints] of Object.entries(c.policyHints)) expect(grantsActOutside([`${c.key}:${tool}`]), `${c.key}:${tool}`).toBe(!hints.hardGate && Boolean(hints.contactsThirdParty || hints.spendsMoney || hints.irreversible));
    }
  });

  it("is false for research, reading and a hard-gated hand-off to the founder", () => {
    const research = resolveGrants([
      { connectorKey: "web", tools: ["fetch"] },
      { connectorKey: "quarantine", tools: ["*"] },
      { connectorKey: "google_drive", tools: ["files.list", "files.read"] },
    ]).toolRefs;
    expect(research.length).toBeGreaterThan(0);
    expect(grantsActOutside(research)).toBe(false);
    expect(grantsActOutside(["platform:request_human_action"])).toBe(false);
    expect(grantsActOutside([])).toBe(false);
  });

  it("counts a tool that cannot be undone (a merge to main, a DNS change), and fails closed on a connector or tool it does not know", () => {
    expect(grantsActOutside(["github:merge_pr"])).toBe(true);
    expect(grantsActOutside(resolveGrants([{ connectorKey: "github", tools: ["pulls.merge"] }]).toolRefs)).toBe(true);
    expect(grantsActOutside(["cloudflare_dns:*"])).toBe(true);
    // Reading the same repository is still routine.
    expect(grantsActOutside(["github:read_tree", "github:read_file"])).toBe(false);
    expect(grantsActOutside(["unknown_connector:thing"])).toBe(true);
    expect(grantsActOutside(["github:no_such_tool"])).toBe(true);
  });
});
