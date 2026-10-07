/**
 * Finance module screens (BUILD §6.3, §11.8): one ModuleScreen per tab in MODULE_TABS.finance, registered on import.
 * Overview · Profit and loss · Cash · Runway · Wage bill · Cap table. Read-only for money movement: no screen here
 * can initiate a payment.
 */
import { MODULE_TABS } from "@foundmill/shared";
import { registerModule, type ModuleScreen } from "../registry";
import { CapTableScreen } from "./CapTableScreen";
import { CashScreen } from "./CashScreen";
import { OverviewScreen } from "./OverviewScreen";
import { ProfitAndLossScreen } from "./ProfitAndLossScreen";
import { RunwayScreen } from "./RunwayScreen";
import { WageBillScreen } from "./WageBillScreen";

const COMPONENTS: Record<string, Pick<ModuleScreen, "Component" | "subViews">> = {
  overview: { Component: OverviewScreen },
  pnl: { Component: ProfitAndLossScreen },
  cash: { Component: CashScreen },
  runway: { Component: RunwayScreen },
  "wage-bill": { Component: WageBillScreen },
  "cap-table": { Component: CapTableScreen },
};

export const financeScreens: ModuleScreen[] = MODULE_TABS.finance.map((tab) => {
  const entry = COMPONENTS[tab.slug];
  if (!entry) throw new Error(`finance module: no screen for tab "${tab.slug}"`);
  return { moduleKey: "finance", tabSlug: tab.slug, title: tab.title, ...entry };
});

registerModule({ key: "finance", screens: financeScreens });

export { CapTableScreen, CashScreen, OverviewScreen, ProfitAndLossScreen, RunwayScreen, WageBillScreen };
export { FinanceScreenOptionsProvider, type FinanceScreenOptions } from "./shared";
export { RecategoriseDialog } from "./RecategoriseDialog";
/** Pure finance arithmetic (P&L tree, forecast, round modelling, registers) under one name so nothing collides with the other packs. */
export * as financeMetrics from "./metrics";
export type { ForecastDrivers, ForecastPoint, ForecastScenario, CapTableResponse, PnlResponse, WagesResponse, AccountRow, TransactionRow } from "./types";
