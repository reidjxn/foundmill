/**
 * Which business a screen outside /b/[bid] (the LIVE pages: /network, /communities, /leaderboards) and the index route
 * use as "the current business": the one the founder last opened (the cookie the business layout sets), else their
 * newest (`founder.profile.get` lists businesses newest first). Pure, so it is unit-tested without Next.js.
 */
export function pickCurrentBusiness<T extends { id: string }>(lastBusinessId: string | null | undefined, businesses: readonly T[]): T | undefined {
  return (lastBusinessId ? businesses.find((b) => b.id === lastBusinessId) : undefined) ?? businesses[0];
}
