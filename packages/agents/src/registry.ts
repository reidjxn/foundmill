/** Template registry: look templates up by key, type, module, family or channel. */
import { ValidationError, type ChannelKey, type ModuleKey } from "@foundmill/shared";
import { ALL_TEMPLATES } from "./templates";
import { type AgentTemplate, type TemplateFamily } from "./types";

const BY_KEY: ReadonlyMap<string, AgentTemplate> = new Map(ALL_TEMPLATES.map((t) => [t.key, t]));
const BY_TYPE: ReadonlyMap<string, AgentTemplate> = new Map(ALL_TEMPLATES.map((t) => [t.agentType, t]));

export const TEMPLATE_KEYS: readonly string[] = Object.freeze(ALL_TEMPLATES.map((t) => t.key));

/** An input error (400): a template key outside the catalog, from a crafted call or a catalog that changed meanwhile. */
export class UnknownTemplateError extends ValidationError {
  constructor(readonly key: string) {
    super(`Unknown agent template "${key}"`, { key });
    this.name = "UnknownTemplateError";
  }
}

export function getTemplate(key: string): AgentTemplate {
  const t = BY_KEY.get(key);
  if (!t) throw new UnknownTemplateError(key);
  return t;
}

export function findTemplate(key: string): AgentTemplate | undefined {
  return BY_KEY.get(key);
}

export function getTemplateByAgentType(agentType: string): AgentTemplate | undefined {
  return BY_TYPE.get(agentType);
}

export function hasTemplate(key: string): boolean {
  return BY_KEY.has(key);
}

export interface TemplateFilter {
  family?: TemplateFamily;
  module?: ModuleKey | null;
  channelKey?: ChannelKey;
  /** Filter on taskKinds containing this kind. */
  taskKind?: AgentTemplate["taskKinds"][number];
}

export function listTemplates(filter: TemplateFilter = {}): AgentTemplate[] {
  return ALL_TEMPLATES.filter((t) => {
    if (filter.family && t.family !== filter.family) return false;
    if (filter.module !== undefined && t.module !== filter.module) return false;
    if (filter.channelKey && t.channelKey !== filter.channelKey) return false;
    if (filter.taskKind && !t.taskKinds.includes(filter.taskKind)) return false;
    return true;
  });
}

export function getChannelTemplate(channelKey: ChannelKey): AgentTemplate {
  const t = ALL_TEMPLATES.find((x) => x.channelKey === channelKey);
  if (!t) throw new UnknownTemplateError(`channel_${channelKey}`);
  return t;
}

/**
 * Build the first `agent_versions` row for a hired agent from its template (AC-11.1.6). The club rules are not part of
 * the instructions; the runtime prepends them.
 */
export function initialVersionFromTemplate(template: AgentTemplate, agentId: string) {
  return {
    agentId,
    version: 1,
    description: template.description,
    instructions: template.instructions,
    tools: template.tools,
    modelKey: template.modelKey,
    skills: template.skills,
    autonomy: template.autonomy,
    negotiation: template.negotiation,
    schedule: template.schedule,
  };
}
