/**
 * Distribution module screens (BUILD §6.3, §11.7): one ModuleScreen per tab in MODULE_TABS.distribution, registered on
 * import. First ten · Formation · Channels · Leads · Campaigns · Creative · Attribution.
 */
import { MODULE_TABS } from "@foundmill/shared/constants";
import { registerModule, type ModuleScreen } from "../registry";
import { AttributionScreen } from "./AttributionScreen";
import { CampaignsScreen } from "./CampaignsScreen";
import { ChannelsScreen } from "./ChannelsScreen";
import { CreativeScreen } from "./CreativeScreen";
import { FirstTenScreen } from "./FirstTenScreen";
import { FormationScreen } from "./FormationScreen";
import { LeadsScreen } from "./LeadsScreen";

const COMPONENTS: Record<string, ModuleScreen["Component"]> = {
  "first-ten": FirstTenScreen,
  formation: FormationScreen,
  channels: ChannelsScreen,
  leads: LeadsScreen,
  campaigns: CampaignsScreen,
  creative: CreativeScreen,
  attribution: AttributionScreen,
};

export const distributionScreens: ModuleScreen[] = MODULE_TABS.distribution.map((tab) => {
  const Component = COMPONENTS[tab.slug];
  if (!Component) throw new Error(`distribution module: no screen for tab "${tab.slug}"`);
  return { moduleKey: "distribution", tabSlug: tab.slug, title: tab.title, Component };
});

registerModule({ key: "distribution", screens: distributionScreens });

export { AttributionScreen, CampaignsScreen, ChannelsScreen, CreativeScreen, FirstTenScreen, FormationScreen, LeadsScreen };
export { ChannelProfileDrawer } from "./ChannelProfileDrawer";
export * as distributionData from "./channel-data";
export type * as DistributionTypes from "./types";
