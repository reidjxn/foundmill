/**
 * Product module screens (BUILD §6.3, §11.5): one ModuleScreen per tab in MODULE_TABS.product, registered on import.
 * Vision · Specification · Public page · Roadmap (board | timeline) · Changes · Sources · Research.
 */
import { MODULE_TABS } from "@foundmill/shared";
import { SITE_TAB } from "@foundmill/shared/sites";
import { registerModule, type ModuleScreen } from "../registry";
import { ChangesScreen } from "./ChangesScreen";
import { PublicPageScreen } from "./PublicPageScreen";
import { ResearchScreen } from "./ResearchScreen";
import { ROADMAP_SUB_VIEWS, RoadmapScreen } from "./RoadmapScreen";
import { SiteScreen } from "./SiteScreen";
import { SourcesScreen } from "./SourcesScreen";
import { SpecificationScreen } from "./SpecificationScreen";
import { VisionScreen } from "./VisionScreen";

const COMPONENTS: Record<string, Pick<ModuleScreen, "Component" | "subViews">> = {
  vision: { Component: VisionScreen },
  specification: { Component: SpecificationScreen },
  "public-page": { Component: PublicPageScreen },
  roadmap: { Component: RoadmapScreen, subViews: [...ROADMAP_SUB_VIEWS] },
  changes: { Component: ChangesScreen },
  sources: { Component: SourcesScreen },
  research: { Component: ResearchScreen },
};

export const productScreens: ModuleScreen[] = [
  ...MODULE_TABS.product.map((tab) => {
    const entry = COMPONENTS[tab.slug];
    if (!entry) throw new Error(`product module: no screen for tab "${tab.slug}"`);
    return { moduleKey: "product" as const, tabSlug: tab.slug, title: tab.title, ...entry };
  }),
  // Not a default tab: a project gets it only once the platform made it a site (WP-07; `repos.sites.ensure`).
  { moduleKey: "product", tabSlug: SITE_TAB.slug, title: SITE_TAB.title, Component: SiteScreen },
];

registerModule({ key: "product", screens: productScreens });

export { ChangesScreen, PublicPageScreen, ResearchScreen, SiteScreen, RoadmapScreen, SourcesScreen, SpecificationScreen, VisionScreen };
export { PUBLIC_PAGE_EXPLAINER, PUBLIC_PAGE_WORDS, publishConsequence, type PageViewResponse } from "./PublicPageScreen";
export { ROADMAP_SUB_VIEWS } from "./RoadmapScreen";
export { SITE_EXPLAINER, SITE_WORDS, type SiteViewResponse } from "./SiteScreen";
export { PAY_LINK_WORDS, PayLinksPanel, type PayLinkViewResponse } from "./PayLinksPanel";
export type { SpecEditorProps, SpecEditorStatus } from "../env";
export { specDocumentName } from "./spec/contract";
export * from "./types";
export { FoundationsBanner, VisionPanels, useFoundations, foundationsBasis, foundationsDisplayState, foundationsSummary, FOUNDATIONS_INTERRUPTED, FOUNDATIONS_PATH, FOUNDATIONS_POLL_MS, type FoundationsBannerProps, type FoundationsQuery } from "./foundations";
export { PlainDoc } from "./PlainDoc";
export { ResearchPlanPanel, researchPlanState, resetResearchEnsured, RESEARCH_ENSURE_PATH, RESEARCH_PATH, type ResearchPlanState } from "./research/ResearchPlanPanel";
