/**
 * Product module screens (BUILD §6.3, §11.5): one ModuleScreen per tab in MODULE_TABS.product, registered on import.
 * Vision · Specification · Roadmap (board | timeline) · Changes · Sources · Research.
 */
import { MODULE_TABS } from "@foundmill/shared";
import { registerModule, type ModuleScreen } from "../registry";
import { ChangesScreen } from "./ChangesScreen";
import { ResearchScreen } from "./ResearchScreen";
import { ROADMAP_SUB_VIEWS, RoadmapScreen } from "./RoadmapScreen";
import { SourcesScreen } from "./SourcesScreen";
import { SpecificationScreen } from "./SpecificationScreen";
import { VisionScreen } from "./VisionScreen";

const COMPONENTS: Record<string, Pick<ModuleScreen, "Component" | "subViews">> = {
  vision: { Component: VisionScreen },
  specification: { Component: SpecificationScreen },
  roadmap: { Component: RoadmapScreen, subViews: [...ROADMAP_SUB_VIEWS] },
  changes: { Component: ChangesScreen },
  sources: { Component: SourcesScreen },
  research: { Component: ResearchScreen },
};

export const productScreens: ModuleScreen[] = MODULE_TABS.product.map((tab) => {
  const entry = COMPONENTS[tab.slug];
  if (!entry) throw new Error(`product module: no screen for tab "${tab.slug}"`);
  return { moduleKey: "product", tabSlug: tab.slug, title: tab.title, ...entry };
});

registerModule({ key: "product", screens: productScreens });

export { ChangesScreen, ResearchScreen, RoadmapScreen, SourcesScreen, SpecificationScreen, VisionScreen };
export { ROADMAP_SUB_VIEWS } from "./RoadmapScreen";
export type { SpecEditorProps, SpecEditorStatus } from "../env";
export { specDocumentName } from "./spec/contract";
export * from "./types";
export { FoundationsBanner, VisionPanels, useFoundations, foundationsBasis, foundationsSummary, FOUNDATIONS_PATH, FOUNDATIONS_POLL_MS, type FoundationsBannerProps, type FoundationsQuery } from "./foundations";
