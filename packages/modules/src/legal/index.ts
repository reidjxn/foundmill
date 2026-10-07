/**
 * Legal module screens (BUILD §6.3, §11.11): one ModuleScreen per tab in MODULE_TABS.legal, registered on import.
 * Entity · Incorporate · Compliance · Contracts · IP · Policies · Regulatory. Nothing here files, signs, pays or
 * accepts terms: those are founder clicks on the vendor's own page (AC-11.11.4).
 */
import { MODULE_TABS } from "@foundmill/shared";
import { registerModule, type ModuleScreen } from "../registry";
import { COMPLIANCE_SUB_VIEWS, ComplianceScreen } from "./ComplianceScreen";
import { ContractsScreen } from "./ContractsScreen";
import { EntityScreen } from "./EntityScreen";
import { IncorporateScreen } from "./IncorporateScreen";
import { IPScreen } from "./IPScreen";
import { PoliciesScreen } from "./PoliciesScreen";
import { RegulatoryScreen } from "./RegulatoryScreen";

const COMPONENTS: Record<string, Pick<ModuleScreen, "Component" | "subViews">> = {
  entity: { Component: EntityScreen },
  incorporate: { Component: IncorporateScreen },
  compliance: { Component: ComplianceScreen, subViews: COMPLIANCE_SUB_VIEWS.map((v) => ({ slug: v.slug, title: v.title })) },
  contracts: { Component: ContractsScreen },
  ip: { Component: IPScreen },
  policies: { Component: PoliciesScreen },
  regulatory: { Component: RegulatoryScreen },
};

export const legalScreens: ModuleScreen[] = MODULE_TABS.legal.map((tab) => {
  const entry = COMPONENTS[tab.slug];
  if (!entry) throw new Error(`legal module: no screen for tab "${tab.slug}"`);
  return { moduleKey: "legal", tabSlug: tab.slug, title: tab.title, ...entry };
});

registerModule({ key: "legal", screens: legalScreens });

export { ComplianceScreen, ContractsScreen, EntityScreen, IncorporateScreen, IPScreen, PoliciesScreen, RegulatoryScreen };
export { LegalScreenOptionsProvider, INFORMATION_CAPTION, SCREEN_CAPTION, type LegalScreenOptions } from "./shared";
/** Pure legal helpers (routes, steps, calendar, obligations, policies, trademark screen, sector gates) under one name. */
export * as legalData from "./legal-data";
export type { ComplianceListResponse, ContractRow, ContractsListResponse, IncorporationStatusResponse, JurisdictionCard, LegalEntityRow, LookupResult, RecommendResponse } from "./types";
