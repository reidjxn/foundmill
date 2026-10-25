import { AGENT_STYLE_META, DEFAULT_AGENT_STYLE, type AgentStyle } from "@foundmill/shared/personas";

/**
 * Anthropomorphic agents' words (founder preference `anthropomorphicAgents` and `agentStyle`): one sentence, said the
 * same way in Settings › Preferences and on the Launch step of a new business. Plain words; the agents stay AI agents.
 */
export const ANTHROPOMORPHIC_EXPLAINER =
  "Agents get a first name and an AI-generated picture in the style you choose: human faces, 3D cartoon people, 2D cartoon people and animals, or fantasy characters. They are still AI agents, and their position always shows beside the name. Off shows them by role.";

/** The toast after the switch or the style is saved: the title names the choice, the line says what follows from it. */
export function anthropomorphicSavedLine(on: boolean, style: AgentStyle = DEFAULT_AGENT_STYLE): { title: string; description: string } {
  return on
    ? {
        title: `Anthropomorphic agents on: ${AGENT_STYLE_META[style].label}`,
        description: "Agents show a first name and an AI-generated picture in this style, with their position beside the name, in every business.",
      }
    : { title: "Anthropomorphic agents off", description: "Agents show by role, as before, in every business." };
}
