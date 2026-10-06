/**
 * Builder for physical-product specialists (BUILD §11.6 Specialists). Specialist tiles show RFQ funnels, quote tables,
 * sample trackers and shipment maps instead of a terminal; their tools are documents, CRM, email drafts and the
 * quarantined reader. Every purchase, booking or signature is a founder decision.
 */
import { grant, PLATFORM_BASE_TOOLS, QUARANTINE_TOOLS, WEB_TOOLS } from "../../connectors";
import { type AgentExample, type AgentTemplate, type Negotiation, type ToolGrant } from "../../types";
import { AUTONOMY_INHERIT, defineTemplate, PHYSICAL_SPECIALIST_RULES, WORKER_COMMON_RULES, withCoreSkills } from "../_shared";

export interface SpecialistTemplateInit {
  key: string;
  name: string;
  role: string;
  summary: string;
  inputs: string;
  outputs: string;
  goals: string[];
  rules: string[];
  playbook: string[];
  examples: AgentExample[];
  connectors: ToolGrant[];
  craftSkills: string[];
  negotiation?: Negotiation;
  neverDoes: string[];
}

export const SPECIALIST_PLATFORM_TOOLS = [
  "crm.entities.search",
  "crm.entities.create",
  "crm.interactions.append",
  "documents.read",
  "documents.write",
  "rfq.create",
  "rfq.track",
  "quotes.record",
  "samples.track",
  "costing.model.read",
  "costing.model.update",
  "spec.read",
];

export function defineSpecialistTemplate(init: SpecialistTemplateInit): AgentTemplate {
  const description = `${init.summary} Inputs: ${init.inputs}. Outputs: ${init.outputs}. Tools: documents, CRM, RFQ and quote tracking, email drafts, web research through the quarantined reader. Never does: ${init.neverDoes.join("; ")}.`;
  return defineTemplate({
    key: init.key,
    name: init.name,
    role: init.role,
    family: "specialist",
    agentType: init.key,
    module: "development",
    taskKinds: ["specialist"],
    route: "worker",
    description,
    instructions: {
      role: `${init.role} for a physical-product business.`,
      goals: init.goals,
      rules: [...PHYSICAL_SPECIALIST_RULES, ...WORKER_COMMON_RULES, ...init.rules],
      playbook: init.playbook,
      tone: "Technical and practical: units, tolerances, standards, dates. Labels every unconfirmed number Estimate.",
      examples: init.examples,
    },
    tools: [
      grant("platform", [...PLATFORM_BASE_TOOLS, ...SPECIALIST_PLATFORM_TOOLS] as [string, ...string[]]),
      grant("quarantine", QUARANTINE_TOOLS),
      grant("web", WEB_TOOLS),
      grant("gmail", ["drafts.create", "threads.read"]),
      grant("google_drive", ["files.list", "files.read", "files.write"]),
      ...init.connectors,
    ],
    skills: withCoreSkills(init.craftSkills),
    autonomy: AUTONOMY_INHERIT,
    negotiation: init.negotiation,
    neverDoes: init.neverDoes,
  });
}

export { grant };
