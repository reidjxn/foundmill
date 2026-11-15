/**
 * Builder for the 15 channel engine agents (BUILD §11.7 channel table). Each channel file supplies the specifics; this
 * composes the description, goals around the channel's core metric, the shared engine-loop rules and the tool grants.
 */
import { CHANNEL_META, type ChannelKey, type ChannelLine, type EventType } from "@foundmill/shared";
import { grant, PLATFORM_BASE_TOOLS, QUARANTINE_TOOLS, type ConnectorKey } from "../../connectors";
import { type AgentExample, type AgentTemplate, type ToolGrant } from "../../types";
import { CHANNEL_COMMON_RULES, defineTemplate, spendingAutonomy, WORKER_COMMON_RULES, withCoreSkills } from "../_shared";

export interface ChannelTemplateInit {
  channelKey: ChannelKey;
  name: string;
  role: string;
  /** "Autonomous work" column, as sentences. */
  work: string[];
  /** Connector grants beyond the platform base. */
  connectors: ToolGrant[];
  /** "Guardrails" column, as rules. */
  guardrails: string[];
  playbook: string[];
  examples: AgentExample[];
  craftSkills: string[];
  /** Monthly spend cap default in minor units (channel share is set by the Strategist; this caps the agent). */
  spendCapMinor: number;
  /** Channels that book through humans (print, broadcast linear, outdoor contracts) run in kit mode by default. */
  kitMode?: boolean;
  /** Extra platform tools (e.g. campaigns.list) beyond the base set; only capabilities a tool serves (packages/connectors grants.ts). */
  platformTools?: string[];
  triggers?: EventType[];
  neverDoes: string[];
}

/**
 * What every channel that is not in offline tracking by default says of itself (founder, Nov 11, 2026: agents hold only
 * tools that exist). Most channels hold no tool that publishes, sends or books yet (templates/PLANNED_GRANTS.md), so the
 * description a founder reads in the catalog and on the profile says what happens then.
 */
export const NO_TOOL_HANDOVER = "Where I hold no tool to publish, send or book on a platform, I prepare the material and hand that step to the founder.";

/**
 * Platform capabilities every channel engine holds beyond the base set. Campaigns, assets, attribution links and codes
 * and new CRM records have no agent tool yet (templates/PLANNED_GRANTS.md): add each back with the tool that serves it.
 */
export const CHANNEL_PLATFORM_TOOLS = [
  "assets.request_approval",
  "suppression.check",
  "consent.check",
  "budgets.read",
  "kit.create_founder_task",
  "crm.entities.search",
];

/** What the founder reads for a channel's line (CLAUDE.md: Acquisition / Engagement / Organic / Offline); the key stays internal. */
const LINE_WORDS: Record<ChannelLine, string> = { attack: "Acquisition", midfield: "Engagement", defence: "Organic", wings: "Offline" };

export function defineChannelTemplate(init: ChannelTemplateInit): AgentTemplate {
  const meta = CHANNEL_META[init.channelKey];
  const kit = init.kitMode ?? meta.kitModeByDefault;
  const description = [
    `I run the ${meta.label} channel engine for this business (${LINE_WORDS[meta.line]} line). What I do: ${init.work.join("; ")}.`,
    `Core metric: ${meta.coreMetric}. I run the full loop — Plan → Create → Approve → Launch → Measure → Learn → Report — and report attributed results to the Inbox with record ids.`,
    kit
      ? "This channel runs in offline tracking by default: I prepare every material and a founder task; the founder books and signs."
      : `Inputs: the channel share of the distribution budget, the brief, the customer profile, suppression and consent lists, results from links, codes and notifications from connected tools. ${NO_TOOL_HANDOVER}`,
    `Never does: ${init.neverDoes.join("; ")}.`,
  ].join(" ");

  const tools: ToolGrant[] = [
    grant("platform", [...PLATFORM_BASE_TOOLS, ...CHANNEL_PLATFORM_TOOLS, ...(init.platformTools ?? [])] as [string, ...string[]]),
    grant("quarantine", QUARANTINE_TOOLS),
    ...init.connectors,
  ];

  return defineTemplate({
    key: `channel_${init.channelKey}`,
    name: init.name,
    role: init.role,
    family: "channel",
    agentType: `channel_${init.channelKey}`,
    module: "distribution",
    channelKey: init.channelKey,
    taskKinds: ["channel"],
    route: "worker",
    description,
    instructions: {
      role: `${init.role} running the ${meta.label} engine; your core metric is ${meta.coreMetric}.`,
      goals: [
        `Improve ${meta.coreMetric} week over week within the channel's budget share and caps, and report it with record ids every week.`,
        "Every launch has passed policy approval, every contact has passed suppression and consent checks, and every result is attributed through links, codes or conversion APIs.",
        "Learn weekly: move spend and effort toward what measured best, pause what breached its cap, and say so in the report.",
      ],
      rules: [...CHANNEL_COMMON_RULES, ...WORKER_COMMON_RULES, ...init.guardrails],
      playbook: init.playbook,
      tone: "Practical marketer's voice: specific audiences, specific numbers, no hype, no invented social proof.",
      examples: init.examples,
    },
    tools,
    skills: withCoreSkills(init.craftSkills),
    autonomy: spendingAutonomy(init.spendCapMinor),
    schedule: { cron: "0 8 * * 1", triggers: init.triggers ?? ["campaign.launched", "channel.threshold_breached", "customer.converted"] },
    neverDoes: init.neverDoes,
  });
}

/** Typed grant helper re-exported for channel files. */
export { grant, type ConnectorKey };
