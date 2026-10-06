/**
 * Builder for the 15 channel engine agents (BUILD §11.7 channel table). Each channel file supplies the specifics; this
 * composes the description, goals around the channel's core metric, the shared engine-loop rules and the tool grants.
 */
import { CHANNEL_META, type ChannelKey, type EventType } from "@founder-manager/shared";
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
  /** Extra platform tools (e.g. campaigns.create) beyond the base set. */
  platformTools?: string[];
  triggers?: EventType[];
  neverDoes: string[];
}

export const CHANNEL_PLATFORM_TOOLS = [
  "campaigns.create",
  "campaigns.update",
  "campaigns.pause",
  "campaigns.results",
  "assets.create",
  "assets.request_approval",
  "attribution.links.create",
  "attribution.codes.create",
  "suppression.check",
  "consent.check",
  "budgets.read",
  "kit.create_founder_task",
  "crm.entities.search",
  "crm.entities.create",
  "crm.interactions.append",
];

export function defineChannelTemplate(init: ChannelTemplateInit): AgentTemplate {
  const meta = CHANNEL_META[init.channelKey];
  const kit = init.kitMode ?? meta.kitModeByDefault;
  const description = [
    `I run the ${meta.label} channel engine for this business (${meta.line} line). What I do: ${init.work.join("; ")}.`,
    `Core metric: ${meta.coreMetric}. I run the full loop — Plan → Create → Approve → Launch → Measure → Learn → Report — and report attributed results to the Inbox with record ids.`,
    kit
      ? "This channel runs in kit mode by default: I prepare every material and a founder task; the founder books and signs."
      : "Inputs: the channel share of the distribution budget, the brief, the customer profile, suppression and consent lists, results from links, codes and webhooks.",
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
