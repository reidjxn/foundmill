/** Agent profile tabs (BUILD §6.2). Server-safe: imported by the route page, so no Dugout here. */
export const AGENT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "training", label: "Training" },
  // plain-allow: a tab label (a link, so no Term inside); the Autonomy tab defines the word with a Term in its title.
  { id: "autonomy", label: "Autonomy" },
  { id: "tools", label: "Tools" },
  { id: "history", label: "History" },
  { id: "logs", label: "Logs" },
] as const;
export type AgentTab = (typeof AGENT_TABS)[number]["id"];
export const AGENT_TAB_IDS: readonly string[] = AGENT_TABS.map((t) => t.id);
export function isAgentTab(v: string): v is AgentTab {
  return AGENT_TAB_IDS.includes(v);
}
