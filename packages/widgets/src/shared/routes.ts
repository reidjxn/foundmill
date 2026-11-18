/** App routes widgets navigate to (BUILD §6.2). Only the host router knows how to push; widgets build hrefs. */
export const routes = {
  /** Today, the business's front door (founder, 2026-11-07): the goal, what needs you, the week and the health figures. */
  today: (bid: string) => `/b/${bid}/today`,
  /** The dashboards (shown as "Details" since Today became the front door; the path and the G H item stay). */
  home: (bid: string, dashboardId?: string) => (dashboardId ? `/b/${bid}/home/${dashboardId}` : `/b/${bid}/home`),
  inbox: (bid: string, itemId?: string) => (itemId ? `/b/${bid}/inbox/${itemId}` : `/b/${bid}/inbox`),
  /**
   * The Customer Update (replay) for a journey. apps/web also accepts a conversion id here and forwards. `from` is the
   * in-app path the founder opened it from; the replay's back button and breadcrumb return there (the Inbox without it).
   */
  journey: (bid: string, journeyId: string, from?: string) => `/b/${bid}/journey/${journeyId}${from ? `?from=${encodeURIComponent(from)}` : ""}`,
  department: (bid: string, deptSlug: string, tabSlug: string) => `/b/${bid}/d/${deptSlug}/${tabSlug}`,
  agent: (bid: string, agentId: string, tab = "overview") => `/b/${bid}/agents/${agentId}/${tab}`,
  crm: (bid: string, entityId?: string, tab = "overview") => (entityId ? `/b/${bid}/crm/${entityId}/${tab}` : `/b/${bid}/crm`),
  /** Milestones page (CLAUDE.md vocabulary: never "trophies" in anything a user reads; apps/web redirects /trophies here). */
  milestones: (bid: string, shareKey?: string) => (shareKey ? `/b/${bid}/milestones?share=${encodeURIComponent(shareKey)}` : `/b/${bid}/milestones`),
  /** Team call (docs/TEAM_CALL.md): the lobby, and one call by id. */
  calls: (bid: string) => `/b/${bid}/calls`,
  call: (bid: string, callId: string) => `/b/${bid}/calls/${callId}`,
  settings: (bid: string, tab: string) => `/b/${bid}/settings/${tab}`,
  community: (communityId: string) => `/communities/${communityId}`,
} as const;
