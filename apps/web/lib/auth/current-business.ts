/**
 * Which business a screen outside /b/[bid] (the LIVE pages: /network, /communities, /leaderboards) and the index route
 * use as "the current business": the one the founder last opened (the cookie the business layout sets), else their
 * newest (`founder.profile.get` lists businesses newest first). An example business (`isExample`, 0065: a demo the
 * founder is walking around) is never the fallback: it counts only when it is the one they last opened, so a founder
 * whose only membership is the example lands on /new rather than in the demo. Pure, so it is unit-tested without Next.js.
 */
export function pickCurrentBusiness<T extends { id: string; isExample?: boolean }>(lastBusinessId: string | null | undefined, businesses: readonly T[]): T | undefined {
  return (lastBusinessId ? businesses.find((b) => b.id === lastBusinessId) : undefined) ?? businesses.find((b) => !b.isExample);
}
