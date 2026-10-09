/**
 * Team module screens (BUILD §6.3, §11.9): one ModuleScreen per tab in MODULE_TABS.team, registered on import.
 * Squad · Staff · Responsibilities · Health · Hierarchy · Recruitment. Data only through @foundmill/widgets
 * (team.*, agent.model.*, department.list, founder.profile.get); UI only through @foundmill/dugout.
 */
import { MODULE_TABS } from "@foundmill/shared/constants";
import { registerModule, type ModuleScreen } from "../registry";
import { HealthScreen } from "./HealthScreen";
import { HierarchyScreen } from "./HierarchyScreen";
import { RecruitmentScreen } from "./RecruitmentScreen";
import { ResponsibilitiesScreen } from "./ResponsibilitiesScreen";
import { SquadScreen } from "./SquadScreen";
import { StaffScreen } from "./StaffScreen";

const COMPONENTS: Record<string, Pick<ModuleScreen, "Component" | "subViews">> = {
  squad: { Component: SquadScreen },
  staff: { Component: StaffScreen },
  responsibilities: { Component: ResponsibilitiesScreen },
  health: { Component: HealthScreen },
  hierarchy: { Component: HierarchyScreen },
  recruitment: { Component: RecruitmentScreen },
};

export const teamScreens: ModuleScreen[] = MODULE_TABS.team.map((tab) => {
  const entry = COMPONENTS[tab.slug];
  if (!entry) throw new Error(`team module: no screen for tab "${tab.slug}"`);
  return { moduleKey: "team", tabSlug: tab.slug, title: tab.title, ...entry };
});

registerModule({ key: "team", screens: teamScreens });

export { HealthScreen, HierarchyScreen, RecruitmentScreen, ResponsibilitiesScreen, SquadScreen, StaffScreen };
export { TeamScreenOptionsProvider, type TeamScreenOptions } from "./shared";
export { ModelChangeDialog } from "./ModelChangeDialog";
export { HireDialog, ReleaseDialog, CloneDialog, LoanDialog } from "./dialogs";
export type { AgentRow as TeamAgentRow, AgentsListResponse as TeamAgentsListResponse, MembershipRow as TeamMembershipRow, ResponsibilitiesResponse as TeamResponsibilitiesResponse, TemplateRow as TeamTemplateRow } from "./types";
