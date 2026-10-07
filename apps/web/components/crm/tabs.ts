/** Entity profile tabs (BUILD §11.12). Server-safe: imported by the route page, so no Dugout here. */
export const ENTITY_TABS = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "relationships", label: "Relationships" },
  { id: "commercial", label: "Commercial" },
  { id: "documents", label: "Documents" },
  { id: "notes", label: "Notes" },
  { id: "journey", label: "Journey" },
] as const;
export type EntityTab = (typeof ENTITY_TABS)[number]["id"];
export const ENTITY_TAB_IDS: readonly string[] = ENTITY_TABS.map((t) => t.id);
export function isEntityTab(v: string): v is EntityTab {
  return ENTITY_TAB_IDS.includes(v);
}
