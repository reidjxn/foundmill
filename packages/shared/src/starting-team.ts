/**
 * The starting team (WP-04 T4; founder, 2026-11-16, decision 2): commit still hires everyone an archetype seed lists,
 * since tasks, channels and leads find agents by template, but a new project is shown these three first and the rest
 * as the work reaches them. Here, not in packages/agents, so Commit (apps/web) and Team › Agents (packages/modules) read
 * the same list; `@foundmill/agents` re-exports it. Deleting the constant's entries shows everyone again.
 */
export const STARTING_TEAM_TEMPLATE_KEYS: readonly string[] = Object.freeze(["chief_of_staff", "product_lead", "researcher"]);

/** Splits a team into the starting agents, in `STARTING_TEAM_TEMPLATE_KEYS` order, and everyone else in their own order. */
export function startingTeam<T extends { templateKey: string }>(agents: readonly T[]): { starting: T[]; later: T[] } {
  const starting = STARTING_TEAM_TEMPLATE_KEYS.flatMap((key) => agents.filter((a) => a.templateKey === key).slice(0, 1));
  return { starting, later: agents.filter((a) => !starting.includes(a)) };
}
