"use client";
/**
 * How the call screen names and pictures an agent: only through `useAgentPersona()` (the persona's first name, position,
 * label and portrait) and the existing `Avatar`, exactly as DeskPresence, the profile header and the Inbox do. Nothing in
 * `components/call` computes a name or a face itself.
 */
import { DEPT_COLOUR_TOKENS, type DeptColourToken } from "@foundmill/shared/constants";
import type { AgentIdentity } from "@foundmill/shared/personas";
import type { TeamCallParticipantView } from "@foundmill/shared/team-call";
import { useAgentPersona } from "../foundation/AgentPersona";

/** What the persona rules read of a participant. */
export function participantIdentity(p: Pick<TeamCallParticipantView, "name" | "role" | "personaKey" | "layer" | "agentType">): AgentIdentity {
  return { name: p.name, role: p.role, personaKey: p.personaKey, layer: p.layer, agentType: p.agentType };
}

/** The participant's department color token, else null (the tile then takes the brand's tone). */
export function participantDept(p: Pick<TeamCallParticipantView, "colourToken">): DeptColourToken | null {
  return (DEPT_COLOUR_TOKENS as readonly string[]).includes(p.colourToken ?? "") ? (p.colourToken as DeptColourToken) : null;
}

export interface CallAgentDisplay {
  /** `nameFor`: the persona's first name in the founder's style, else the stored name. */
  name: string;
  /** `labelFor`: "Bob (Chief of Staff)" with a persona, else the stored name. For a speaker label. */
  label: string;
  /** `positionFor`, or "" when it would only repeat the name (an agent named by its role). */
  position: string;
  /** The AI portrait's URL when one exists. */
  portrait: string | undefined;
  hasPersona: boolean;
  dept: DeptColourToken | null;
}

/** An agent the call screen can name and picture: a participant, or a candidate for the lobby (no accent needed). */
export type CallAgentInput = Omit<TeamCallParticipantView, "speechAccent">;

/** The display of one participant under the preference in force. */
export function useCallAgentDisplay(): (p: CallAgentInput) => CallAgentDisplay {
  const persona = useAgentPersona();
  return (p) => {
    const identity = participantIdentity(p);
    const name = persona.nameFor(identity);
    const position = persona.positionFor(identity);
    return {
      name,
      label: persona.labelFor(identity),
      position: position === name ? "" : position,
      portrait: persona.portraitFor(identity),
      hasPersona: persona.hasPersona(identity),
      dept: participantDept(p),
    };
  };
}
