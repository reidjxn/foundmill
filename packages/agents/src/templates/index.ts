/** Every built-in agent template (BUILD §9.1 squad structure). Order: assistant, leads, workers, channels, specialists, utilities. */
import { type AgentTemplate } from "../types";
import { chiefOfStaff } from "./chief_of_staff";
import { distributionStrategist, engineeringLead, financeLead, legalLead, operationsLead, productLead } from "./leads";
import {
  backendEngineer,
  dataEngineer,
  designToCode,
  docsWriter,
  frontendEngineer,
  infraEngineer,
  integrationAgent,
  planner,
  productResearcher,
  qaEngineer,
  researcher,
  reviewAgent,
} from "./workers";
import { CHANNEL_TEMPLATES } from "./channels";
import { certification, costing, formulationChemist, logistics, packagingDesign, pharmacologyRegulatory, quality, sourcingManufacturing } from "./specialists";
import { categoriser, classifier, entityLinker, moderation, triage } from "./utilities";

export * from "./chief_of_staff";
export * from "./leads";
export * from "./workers";
export * from "./channels";
export * from "./specialists";
export * from "./utilities";
export * from "./_shared";

export const LEAD_TEMPLATES: readonly AgentTemplate[] = Object.freeze([productLead, engineeringLead, distributionStrategist, financeLead, legalLead, operationsLead]);

export const WORKER_TEMPLATES: readonly AgentTemplate[] = Object.freeze([
  backendEngineer,
  frontendEngineer,
  dataEngineer,
  infraEngineer,
  qaEngineer,
  designToCode,
  docsWriter,
  researcher,
  productResearcher,
  reviewAgent,
  integrationAgent,
  planner,
]);

export const CHANNEL_TEMPLATE_LIST: readonly AgentTemplate[] = Object.freeze(Object.values(CHANNEL_TEMPLATES));

export const SPECIALIST_TEMPLATES: readonly AgentTemplate[] = Object.freeze([
  sourcingManufacturing,
  formulationChemist,
  pharmacologyRegulatory,
  certification,
  packagingDesign,
  quality,
  logistics,
  costing,
]);

export const UTILITY_TEMPLATES: readonly AgentTemplate[] = Object.freeze([entityLinker, classifier, categoriser, triage, moderation]);

export const ALL_TEMPLATES: readonly AgentTemplate[] = Object.freeze([
  chiefOfStaff,
  ...LEAD_TEMPLATES,
  ...WORKER_TEMPLATES,
  ...CHANNEL_TEMPLATE_LIST,
  ...SPECIALIST_TEMPLATES,
  ...UTILITY_TEMPLATES,
]);
