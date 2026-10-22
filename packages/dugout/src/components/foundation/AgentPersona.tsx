"use client";
/**
 * Anthropomorphic agents' display layer (founder preference `anthropomorphicAgents`, Settings › Preferences and the
 * Launch step). The app mounts one provider per business with the preference and, when it is on, a way to turn a
 * persona key into a portrait URL; everything that names or pictures an agent reads it:
 *
 * - `nameFor(agent)`: the persona's first name ("Bob"), else the agent's own name. For a table cell or a card title,
 *   where the position sits beside it (a Role column, a subtitle).
 * - `labelFor(agent)`: "Bob (Chief of Staff)", else the agent's own name. For a sender, a mention, a heading with no
 *   role beside it. Agents stay AI agents: the position is always shown with a persona name.
 * - `portraitFor(agent)`: the AI-generated face's URL when it exists, else undefined (the Avatar then draws the
 *   department portrait, as it does with the preference off).
 *
 * The rules themselves (`agentDisplayName`, `agentLabel`, `agentPosition`) live in @foundmill/shared/personas. Outside a
 * provider (stories, tests, the landing page) the preference reads as off and every function returns today's value.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { agentDisplayName, agentLabel, agentPosition, personaByKey, type AgentIdentity } from "@foundmill/shared/personas";

export interface AgentPersonaProviderValue {
  /** The account's `anthropomorphicAgents` preference. */
  anthropomorphic: boolean;
  /** The face for a persona key, or null when it is not made yet. Only called while `anthropomorphic` is on. */
  portraitUrl?: (personaKey: string) => string | null | undefined;
}

export interface AgentPersonaApi {
  anthropomorphic: boolean;
  /** The first name when the preference is on and the agent has a persona; else the agent's own name. */
  nameFor: (agent: AgentIdentity) => string;
  /** "Bob (Chief of Staff)" when on and the agent has a persona; else the agent's own name. */
  labelFor: (agent: AgentIdentity) => string;
  /** The position shown beside a persona name: the role, else the agent's own name. */
  positionFor: (agent: AgentIdentity) => string;
  /** True when this agent is shown under a persona name now (the preference is on and it has a catalog persona). */
  hasPersona: (agent: AgentIdentity) => boolean;
  /** The face URL, or undefined (preference off, no persona, or the portrait is not made yet). */
  portraitFor: (agent: Pick<AgentIdentity, "personaKey">) => string | undefined;
}

/** Today's behavior: names as stored, no faces. */
export const AGENT_PERSONA_OFF: AgentPersonaApi = Object.freeze({
  anthropomorphic: false,
  nameFor: (agent: AgentIdentity) => agent.name,
  labelFor: (agent: AgentIdentity) => agent.name,
  positionFor: (agent: AgentIdentity) => agentPosition(agent),
  hasPersona: () => false,
  portraitFor: () => undefined,
});

/** The display functions for one preference and portrait lookup. Pure; exported for tests and for non-React callers. */
export function createAgentPersonaApi(value: AgentPersonaProviderValue): AgentPersonaApi {
  if (!value.anthropomorphic) return AGENT_PERSONA_OFF;
  const portraitUrl = value.portraitUrl;
  return {
    anthropomorphic: true,
    nameFor: (agent) => agentDisplayName(agent, true),
    labelFor: (agent) => agentLabel(agent, true),
    positionFor: (agent) => agentPosition(agent),
    hasPersona: (agent) => personaByKey(agent.personaKey) !== null,
    portraitFor: (agent) => {
      if (!agent.personaKey || !personaByKey(agent.personaKey)) return undefined;
      return portraitUrl?.(agent.personaKey) || undefined;
    },
  };
}

const AgentPersonaContext = createContext<AgentPersonaApi>(AGENT_PERSONA_OFF);

export function AgentPersonaProvider({ anthropomorphic, portraitUrl, children }: AgentPersonaProviderValue & { children?: ReactNode }) {
  const api = useMemo(() => createAgentPersonaApi({ anthropomorphic, portraitUrl }), [anthropomorphic, portraitUrl]);
  return <AgentPersonaContext.Provider value={api}>{children}</AgentPersonaContext.Provider>;
}

/** The display rules for the preference in force. Off outside a provider. */
export function useAgentPersona(): AgentPersonaApi {
  return useContext(AgentPersonaContext);
}

export interface AgentNameProps {
  agent: AgentIdentity;
  /** "name": the first name, for a place with the position beside it. "label" (default): "Bob (Chief of Staff)". */
  as?: "name" | "label";
}

/** An agent's name as text under the preference in force, for cells and lines that cannot call the hook themselves. */
export function AgentName({ agent, as = "label" }: AgentNameProps) {
  const persona = useAgentPersona();
  return <>{as === "name" ? persona.nameFor(agent) : persona.labelFor(agent)}</>;
}
