/**
 * Agents are granted, told about and planned for only tools that exist (founder, Nov 11, 2026; docs/THESIS_REVIEW.md §7.2,
 * package 0.5). The resolution of every grant is pinned where both packages are visible (apps/orchestrator
 * grants-contract.test.ts); this file pins what packages/agents owns: the vocabulary of connector keys, the record of
 * what was removed, the one sentence every agent gets, the Planner's rule, and the text of the templates.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_NAME } from "@foundmill/config";
import { CHANNEL_META } from "@foundmill/shared";
import { buildSystemPrompt } from "../club-rules";
import { CONNECTOR_KEYS, THIRD_PARTY_CONNECTOR_KEYS } from "../connectors";
import { CLUB_RULES, clubRulesPrompt } from "../prompts/club-rules";
import { getPrompt } from "../prompts";
import { PLANNER_SYSTEM_PROMPT, PLANNER_TOOL_RULE } from "../prompts/planner";
import { ALL_BLUEPRINTS } from "../skills/generate";
import { ALL_TEMPLATES, CHANNEL_TEMPLATES } from "../templates";
import { CHANNEL_PLATFORM_TOOLS, NO_TOOL_HANDOVER } from "../templates/channels/_channel";
import { CHANNEL_COMMON_RULES } from "../templates/_shared";
import { SPECIALIST_PLATFORM_TOOLS } from "../templates/specialists/_specialist";
import { UNBUILT_VENDOR } from "./tool-patterns";

/** The per-template sections of PLANNED_GRANTS.md (a `##` heading with the template key as code), each with its `connector.capability` rows. */
function plannedGrants(): Map<string, string[]> {
  const text = readFileSync(fileURLToPath(new URL("../templates/PLANNED_GRANTS.md", import.meta.url)), "utf8");
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of text.split("\n")) {
    const heading = /^## `([^`]+)`$/.exec(line);
    if (heading) {
      current = [];
      out.set(heading[1]!, current);
      continue;
    }
    const row = /^\| `([^`]+)` \| `([^`]+)` \|/.exec(line);
    if (row && current) current.push(`${row[1]}.${row[2]}`);
  }
  return out;
}

describe("the connector keys a template may name", () => {
  it("are the connectors that are built: none of a later phase, none the platform keeps to itself", () => {
    expect([...THIRD_PARTY_CONNECTOR_KEYS].sort()).toEqual(
      ["anthropic", "apollo", "bolagsverket", "buffer", "cloudflare_dns", "companies_house", "domains", "dropbox_sign", "e2b", "ecb_rates", "elevenlabs_voice", "firecrawl", "gemini", "github", "gmail", "google_calendar", "google_drive", "indexnow", "lightbringer_mcp", "notion", "openai", "opencorporates", "perplexity", "plaid", "posthog", "resend", "runway", "sendgrid", "sentry_mcp", "serpapi", "shopify", "stripe", "tink", "vercel", "voyage"],
    );
    for (const gone of ["instagram", "google_ads", "ga4", "figma", "lob", "browserbase", "openai_images", "onesignal"]) expect(CONNECTOR_KEYS as readonly string[]).not.toContain(gone);
  });
});

describe("PLANNED_GRANTS.md (what was removed, kept as data)", () => {
  const planned = plannedGrants();

  // 428 were removed on Nov 11, 2026. A row goes when its tool is built: the GEO Engine's three panels, then Apollo, Vercel and PostHog (Nov 12, 2026).
  it("lists the capabilities removed on Nov 11, 2026 that are still waiting for a tool, under templates that exist", () => {
    const keys = new Set(ALL_TEMPLATES.map((t) => t.key));
    for (const key of planned.keys()) expect(keys.has(key), key).toBe(true);
    expect([...planned.values()].reduce((n, rows) => n + rows.length, 0)).toBe(398);
    expect(planned.get("channel_social")).toContain("instagram.media.publish");
    expect(planned.get("product_lead")).toContain("platform.spec.publish");
  });

  it("names nothing a template grants today: a grant comes back with its tool, and its row goes", () => {
    for (const t of ALL_TEMPLATES) {
      const granted = new Set(t.tools.flatMap((g) => g.tools.map((c) => `${g.connectorKey}.${c}`)));
      for (const row of planned.get(t.key) ?? []) expect(granted.has(row), `${t.key} grants ${row} again: delete its row from PLANNED_GRANTS.md`).toBe(false);
    }
  });

  it("the shared lists hold none of the capabilities no tool serves", () => {
    for (const c of ["campaigns.create", "campaigns.update", "campaigns.pause", "campaigns.results", "assets.create", "attribution.links.create", "attribution.codes.create", "crm.entities.create", "crm.interactions.append"]) expect(CHANNEL_PLATFORM_TOOLS).not.toContain(c);
    for (const c of ["documents.read", "documents.write", "rfq.create", "rfq.track", "quotes.record", "samples.track", "costing.model.read", "costing.model.update"]) expect(SPECIALIST_PLATFORM_TOOLS).not.toContain(c);
  });
});

describe("what every agent is told", () => {
  it("the house rules say it once, for every template: never plan, promise or report a step you have no tool for", () => {
    const sentence = "Never plan, promise or report a step you have no tool for: say what is missing.";
    expect(CLUB_RULES[3]!.text.endsWith(sentence)).toBe(true);
    expect(clubRulesPrompt.render({ business_name: "Northwind Skincare", APP_NAME })).toContain(sentence);
    for (const t of ALL_TEMPLATES) {
      const prompt = buildSystemPrompt({ businessName: "Northwind Skincare", appName: APP_NAME, template: t });
      expect(prompt.split(sentence).length - 1, t.key).toBe(1);
    }
  });

  it("a channel engine without a tool for a platform works in offline tracking and reports the step as prepared", () => {
    const rule = CHANNEL_COMMON_RULES.find((r) => r.includes("offline tracking"))!;
    expect(rule).toContain("or you hold no tool that acts on it");
    expect(rule).toContain("a founder task with the exact steps");
    expect(rule).toContain("report the step as prepared, not launched");
    for (const t of Object.values(CHANNEL_TEMPLATES)) expect(t.instructions.rules, t.key).toContain(rule);
  });

  it("a channel's description says what happens where it holds no tool, unless it already runs in offline tracking", () => {
    const offline: string[] = [];
    for (const t of Object.values(CHANNEL_TEMPLATES)) {
      // Exactly one of the two: "the founder books and signs" (offline tracking by default) or the handover sentence.
      const kit = /offline tracking by default: I prepare every material and a founder task/.test(t.description);
      expect(t.description.includes(NO_TOOL_HANDOVER), t.key).toBe(!kit);
      if (kit) offline.push(t.channelKey!);
      if (CHANNEL_META[t.channelKey!].kitModeByDefault) expect(kit, t.key).toBe(true);
    }
    // WP-08 T9: no channel starts in offline tracking (print and broadcast were the only engines a real project could start).
    expect(offline.sort()).toEqual([]);
    expect(CHANNEL_TEMPLATES.social.description).toContain(NO_TOOL_HANDOVER);
  });
});

describe("template text names no tool the agent does not hold", () => {
  it("no description lists a removed tool in its Tools sentence", () => {
    const gone = /\b(Figma|Playwright|shell|test run|preview deployments?|deployment platform|error tracking|analytics read|browser sessions?|accounting books|RFQ and quote tracking|roadmap editing|review comments|CRM read and create)\b/i;
    for (const t of ALL_TEMPLATES) {
      const tools = /Tools: ([^.]*)\./.exec(t.description)?.[1];
      if (tools) expect(tools, t.key).not.toMatch(gone);
    }
  });

  it("no instruction sends an agent to a vendor whose connector is not built", () => {
    const vendors = UNBUILT_VENDOR;
    for (const t of ALL_TEMPLATES) {
      const i = t.instructions;
      // An example's input is what the agent is handed (a founder's words, a report); its output is what it does.
      for (const text of [...i.goals, ...i.rules, ...i.playbook, ...i.examples.map((e) => e.output)]) expect(text, `${t.key}: ${text}`).not.toMatch(vendors);
    }
  });

  it("the specialists and the legal lead prepare what they cannot do themselves and hand it to the founder", () => {
    const byKey = new Map(ALL_TEMPLATES.map((t) => [t.key, t]));
    const sourcing = byKey.get("sourcing_manufacturing")!.instructions;
    expect(sourcing.playbook.join("\n")).toMatch(/hand sample orders to the founder as a founder task/);
    expect(sourcing.examples[0]!.output).not.toMatch(/Samples ordered/);
    expect(byKey.get("logistics")!.instructions.playbook.join("\n")).toMatch(/as email drafts the business sends \(no freight quoting tool yet\)/);
    expect(byKey.get("legal_lead")!.instructions.goals.join("\n")).not.toMatch(/supervised session/);
  });

  it("the engines with no publishing, ad, mail or network tool hand the launch to the founder", () => {
    for (const key of ["social", "paid_ads", "direct_mail", "affiliate", "events", "pr", "influencer"] as const) {
      const launch = CHANNEL_TEMPLATES[key].instructions.playbook.find((p) => p.startsWith("Launch:"))!;
      expect(launch, key).toMatch(/founder task|drafts in the business mailbox for the founder to send/);
      expect(launch, key).toMatch(/founder/);
    }
    const social = CHANNEL_TEMPLATES.social;
    // Social alone has a publishing tool, on the founder's own Buffer: the founder task is what it falls back to when Buffer is not connected.
    expect(social.tools.map((g) => g.connectorKey)).toEqual(["platform", "quarantine", "runway", "elevenlabs_voice", "buffer", "cli_gimp"]);
    expect(social.tools.find((g) => g.connectorKey === "buffer")!.tools).toEqual(["channels.read", "posts.queue", "posts.read"]);
    expect(social.instructions.playbook.join("\n")).not.toMatch(/schedule within rate limits/);
    expect(CHANNEL_TEMPLATES.paid_ads.instructions.examples[0]!.output).toMatch(/Nothing was changed on the ad platform by me\./);
    expect(CHANNEL_TEMPLATES.broadcast.instructions.examples[0]!.output).toMatch(/not launched by me/);
  });
});

describe("skill tests offer no tool of a connector that is not built", () => {
  it("every mock tool a blueprint lists is on a built connector, and no prompt sends the agent to one that is not", () => {
    const built = new Set<string>(CONNECTOR_KEYS);
    const unbuilt = /\b(Apollo|PDL|Hunter|Lob|CosIng\/annex tools|freight tools|tariff tools|across 4 assistants)\b/;
    for (const [skill, blueprints] of Object.entries(ALL_BLUEPRINTS)) {
      for (const b of blueprints) {
        for (const tool of b.mockTools ?? []) expect(built.has(tool.split(".")[0]!), `${skill}: ${b.title} offers ${tool}`).toBe(true);
        expect(b.prompt, `${skill}: ${b.title}`).not.toMatch(unbuilt);
      }
    }
  });
});

describe("the Planner", () => {
  it("is told not to plan a task no agent has a tool for, in the system prompt every task-writing call uses and in its rules", () => {
    expect(PLANNER_TOOL_RULE).toMatch(/^Never plan a task that needs a tool no agent has/);
    expect(PLANNER_TOOL_RULE).toMatch(/say once, in that task's goal, which step the founder does themselves\.$/);
    expect(PLANNER_SYSTEM_PROMPT).toContain(PLANNER_TOOL_RULE);
    expect(getPrompt("planner").text).toContain(`- ${PLANNER_TOOL_RULE}`);
    // It stays one rule: the Planner is given the goal, the roadmap item and the specification, not the agents' tools.
    expect(PLANNER_SYSTEM_PROMPT.split(PLANNER_TOOL_RULE).length - 1).toBe(1);
  });
});
