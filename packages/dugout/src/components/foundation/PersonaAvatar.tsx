"use client";
import { useAgentPersona } from "./AgentPersona";
import { AvatarBase, type AvatarProps } from "./Avatar";

/**
 * The client side of Avatar for an agent with a persona key (anthropomorphic agents): with the preference on it is named
 * by the persona's first name and wears the persona's face when one is ready; off, or outside a provider, it is
 * AvatarBase unchanged. Use `Avatar`, which picks this.
 */
export function PersonaAvatar(props: AvatarProps) {
  const persona = useAgentPersona();
  const agent = props.agent;
  if (!agent) return <AvatarBase {...props} />;
  const src = agent.src || persona.portraitFor({ personaKey: agent.personaKey, layer: agent.layer });
  const name = persona.nameFor({ name: props.name, personaKey: agent.personaKey, layer: agent.layer });
  return <AvatarBase {...props} name={name} agent={{ ...agent, src }} />;
}
