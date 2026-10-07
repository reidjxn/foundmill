/** App routes widgets navigate to (BUILD §6.2). Only the host router knows how to push; widgets build hrefs. */
export const routes = {
  home: (bid: string, dashboardId?: string) => (dashboardId ? `/b/${bid}/home/${dashboardId}` : `/b/${bid}/home`),
  inbox: (bid: string, itemId?: string) => (itemId ? `/b/${bid}/inbox/${itemId}` : `/b/${bid}/inbox`),
  journey: (bid: string, journeyId: string) => `/b/${bid}/journey/${journeyId}`,
  department: (bid: string, deptSlug: string, tabSlug: string) => `/b/${bid}/d/${deptSlug}/${tabSlug}`,
  agent: (bid: string, agentId: string, tab = "overview") => `/b/${bid}/agents/${agentId}/${tab}`,
  crm: (bid: string, entityId?: string, tab = "overview") => (entityId ? `/b/${bid}/crm/${entityId}/${tab}` : `/b/${bid}/crm`),
  trophies: (bid: string) => `/b/${bid}/trophies`,
  settings: (bid: string, tab: string) => `/b/${bid}/settings/${tab}`,
  leaderboard: (boardId: string) => `/leaderboards/${boardId}`,
  community: (communityId: string) => `/communities/${communityId}`,
} as const;
