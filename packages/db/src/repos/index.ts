/**
 * Repositories (docs/ARCHITECTURE.md §4). Every function takes `(db, businessId, …)` with the business id first
 * and filters on `business_id` in SQL; account-scoped repos (founders, preferences, ideas before commit, memberships-by-user,
 * social connections/messages) take `userId` first instead. Service code reaches the database only through
 * `repos` (ESLint `fm/no-raw-db`).
 */
import { agentsRepo } from "./agents";
import { approvalsRepo } from "./approvals";
import { auditRepo } from "./audit";
import { businessesRepo } from "./businesses";
import { campaignsRepo } from "./campaigns";
import { capTableRepo } from "./capTable";
import { channelsRepo } from "./channels";
import { checkoutsRepo } from "./checkouts";
import { credentialsRepo } from "./credentials";
import { dashboardsRepo } from "./dashboards";
import { departmentsRepo } from "./departments";
import { entitiesRepo } from "./entities";
import { eventsRepo } from "./events";
import { financeRepo } from "./finance";
import { foundationsRepo } from "./foundations";
import { foundersRepo } from "./founders";
import { holidaysRepo } from "./holidays";
import { ideasRepo } from "./ideas";
import { inboxRepo } from "./inbox";
import { integrationsRepo } from "./integrations";
import { journeysRepo } from "./journeys";
import { legalRepo } from "./legal";
import { logosRepo } from "./logos";
import { membershipsRepo } from "./memberships";
import { plansRepo } from "./plans";
import { playbooksRepo } from "./playbooks";
import { policiesRepo } from "./policies";
import { productRepo } from "./product";
import { screensRepo } from "./screens";
import { skillsRepo } from "./skills";
import { socialRepo } from "./social";
import { tasksRepo } from "./tasks";
import { trainingRepo } from "./training";
import { usageRepo } from "./usage";
import { workspacesRepo } from "./workspaces";
import { conversationsRepo } from "./conversations";
import { preferencesRepo } from "./preferences";
import { portabilityRepo } from "./portability";
import { tableViewsRepo } from "./table-views";

export const repos = {
  businesses: businessesRepo,
  memberships: membershipsRepo,
  founders: foundersRepo,
  ideas: ideasRepo,
  product: productRepo,
  departments: departmentsRepo,
  screens: screensRepo,
  dashboards: dashboardsRepo,
  agents: agentsRepo,
  skills: skillsRepo,
  training: trainingRepo,
  tasks: tasksRepo,
  playbooks: playbooksRepo,
  holidays: holidaysRepo,
  inbox: inboxRepo,
  plans: plansRepo,
  channels: channelsRepo,
  campaigns: campaignsRepo,
  journeys: journeysRepo,
  entities: entitiesRepo,
  finance: financeRepo,
  capTable: capTableRepo,
  usage: usageRepo,
  legal: legalRepo,
  integrations: integrationsRepo,
  credentials: credentialsRepo,
  policies: policiesRepo,
  approvals: approvalsRepo,
  audit: auditRepo,
  events: eventsRepo,
  social: socialRepo,
  workspaces: workspacesRepo,
  logos: logosRepo,
  foundations: foundationsRepo,
  conversations: conversationsRepo,
  preferences: preferencesRepo,
  tableViews: tableViewsRepo,
  checkouts: checkoutsRepo,
  portability: portabilityRepo,
} as const;
export type Repos = typeof repos;
export type RepoArea = keyof Repos;

export type { Executor, Page, PageInput, DateRange, DayRange } from "./_shared";
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, encodeCursor, decodeCursor, decodeTimeCursor, sqlState, uniqueViolation } from "./_shared";

export * from "./agents";
export * from "./approvals";
export * from "./audit";
export * from "./businesses";
export * from "./campaigns";
export * from "./capTable";
export * from "./channels";
export * from "./credentials";
export * from "./dashboards";
export * from "./departments";
export * from "./entities";
export * from "./events";
export * from "./finance";
export * from "./foundations";
export * from "./founders";
export * from "./holidays";
export * from "./ideas";
export * from "./inbox";
export * from "./integrations";
export * from "./journeys";
export * from "./legal";
export * from "./memberships";
export * from "./plans";
export * from "./playbooks";
export * from "./policies";
export * from "./product";
export * from "./screens";
export * from "./skills";
export * from "./social";
export * from "./tasks";
export * from "./training";
export * from "./usage";
export * from "./workspaces";
export * from "./logos";
export * from "./conversations";
export * from "./preferences";
export * from "./table-views";
export * from "./checkouts";
export * from "./portability";
