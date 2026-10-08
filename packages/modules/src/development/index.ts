// development module screens (BUILD §6.3, §11.6): Training Ground · Plan · Pull requests · Environments · Specialists.
// Tab slugs and titles come from MODULE_TABS in @foundmill/shared; one file per screen in this folder.
import { MODULE_TABS } from "@foundmill/shared";
import { registerModule, type ModuleScreen } from "../registry";
import { EnvironmentsScreen } from "./EnvironmentsScreen";
import { PlanScreen } from "./PlanScreen";
import { PullRequestsScreen } from "./PullRequestsScreen";
import { SpecialistsScreen } from "./SpecialistsScreen";
import { TrainingGroundScreen } from "./TrainingGroundScreen";

const COMPONENTS: Record<string, ModuleScreen["Component"]> = {
  "training-ground": TrainingGroundScreen,
  plan: PlanScreen,
  "pull-requests": PullRequestsScreen,
  environments: EnvironmentsScreen,
  specialists: SpecialistsScreen,
};

const SUB_VIEWS: Record<string, ModuleScreen["subViews"]> = {
  "training-ground": [
    { slug: "tiles", title: "Tiles" },
    { slug: "formation", title: "Task graph" },
  ],
};

export const developmentScreens: ModuleScreen[] = MODULE_TABS.development.map((tab) => {
  const Component = COMPONENTS[tab.slug];
  if (!Component) throw new Error(`development module: no screen for tab "${tab.slug}"`);
  const subViews = SUB_VIEWS[tab.slug];
  return { moduleKey: "development", tabSlug: tab.slug, title: tab.title, Component, ...(subViews ? { subViews } : {}) };
});
registerModule({ key: "development", screens: developmentScreens });

export { TrainingGroundScreen, PlanScreen, PullRequestsScreen, EnvironmentsScreen, SpecialistsScreen };
export { DevScreenOptionsProvider, useDevScreenOptions, type DevScreenOptions } from "./options";
export type * as DevelopmentTypes from "./types";
export { SHOUT_PRESET_LABELS, shoutInput, toGraphNodes } from "./TrainingGroundScreen";
export { readSessionEvent, seedFromRows, baseSession, SessionThrottle, concurrencyHint, UNFOCUSED_FLUSH_MS } from "./session-store";
export { specialistDataFromSession, parseSpecialistNote, SPECIALIST_NOTE_PREFIX, type SpecialistNote } from "./specialist-data";
