/**
 * Which dashboard Home shows, server-safe (no React, no design-system or widget imports) so the Home page can start
 * `dashboard.get` on the server with the same id the client picks (components/home/dashboards.ts re-exports it).
 */
import { isGuid } from "@/lib/ids";

export interface DashboardPick {
  id: string;
  isActive: boolean;
}

/**
 * Which dashboard the route shows: the one in the URL, else the founder's active one, else the first. An address segment
 * that is not an id at all is ignored (Home shows the default and corrects the address), so it never reaches the API.
 */
export function pickDashboardId(routeId: string | undefined, list: readonly DashboardPick[]): string | undefined {
  if (routeId && isGuid(routeId)) return routeId;
  return list.find((d) => d.isActive)?.id ?? list[0]?.id;
}
