import { type ChannelKey } from "@founder-manager/shared";
import { type AgentTemplate } from "../../types";
import { channelLeadGeneration } from "./lead_generation";
import { channelEmailAutomation } from "./email_automation";
import { channelSeo } from "./seo";
import { channelGeo } from "./geo";
import { channelContent } from "./content";
import { channelSocial } from "./social";
import { channelPaidAds } from "./paid_ads";
import { channelInfluencer } from "./influencer";
import { channelAffiliate } from "./affiliate";
import { channelDirectMail } from "./direct_mail";
import { channelPrint } from "./print";
import { channelBroadcast } from "./broadcast";
import { channelOutdoor } from "./outdoor";
import { channelPr } from "./pr";
import { channelEvents } from "./events";

export {
  channelLeadGeneration,
  channelEmailAutomation,
  channelSeo,
  channelGeo,
  channelContent,
  channelSocial,
  channelPaidAds,
  channelInfluencer,
  channelAffiliate,
  channelDirectMail,
  channelPrint,
  channelBroadcast,
  channelOutdoor,
  channelPr,
  channelEvents,
};

export const CHANNEL_TEMPLATES: Readonly<Record<ChannelKey, AgentTemplate>> = Object.freeze({
  lead_generation: channelLeadGeneration,
  email_automation: channelEmailAutomation,
  seo: channelSeo,
  geo: channelGeo,
  content: channelContent,
  social: channelSocial,
  paid_ads: channelPaidAds,
  influencer: channelInfluencer,
  affiliate: channelAffiliate,
  direct_mail: channelDirectMail,
  print: channelPrint,
  broadcast: channelBroadcast,
  outdoor: channelOutdoor,
  pr: channelPr,
  events: channelEvents,
});

export { defineChannelTemplate, CHANNEL_PLATFORM_TOOLS } from "./_channel";
