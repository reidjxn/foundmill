/** Agent profile tabs (BUILD §6.2). Server-safe: imported by the route page, so no Dugout here. */
export const AGENT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "training", label: "Training" },
  // plain-allow: a tab label (a link, so no Term inside); the Autonomy tab defines the word with a Term in its title.
  { id: "autonomy", label: "Autonomy" },
  { id: "tools", label: "Tools" },
  { id: "history", label: "History" },
  // Builder view's (docs/DESIGN.md): offered only while it is on; opened by URL while off, the Builder view gate.
  { id: "logs", label: "Logs", builderOnly: true },
] as const;
export type AgentTab = (typeof AGENT_TABS)[number]["id"];
export const AGENT_TAB_IDS: readonly string[] = AGENT_TABS.map((t) => t.id);
export function isAgentTab(v: string): v is AgentTab {
  return AGENT_TAB_IDS.includes(v);
}
/** Whether an agent profile tab is shown only in Builder view. */
export function isBuilderOnlyAgentTab(id: string): boolean {
  return AGENT_TABS.some((t) => t.id === id && "builderOnly" in t && t.builderOnly);
}
/** The agent profile tabs a person sees: Builder view's dropped while it is off. */
export function visibleAgentTabs(builder: boolean): readonly (typeof AGENT_TABS)[number][] {
  return builder ? AGENT_TABS : AGENT_TABS.filter((t) => !isBuilderOnlyAgentTab(t.id));
}
