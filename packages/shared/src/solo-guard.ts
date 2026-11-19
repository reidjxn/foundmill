/**
 * The solo guard (docs/NETWORK.md §10, founder 2026-11-11 "Solo is complete"): a project with one person is complete,
 * so nothing a one-person project reads on Today, in Needs you or in its notes may nudge the founder to add someone,
 * count people at zero or say a person is missing. Finding people stays an offer, one step away in Settings › People
 * and on Network, never a prompt here.
 *
 * `soloGuardViolations` is the test's reader: it returns the phrases a text hits (empty means clean). Product code does
 * not call it. Every task that adds copy a solo founder can read adds a case to the suites that use it.
 */
export const SOLO_GUARD_PHRASES: readonly RegExp[] = [
  /invite (someone|a |your )/i,
  /co-?founder/i,
  /collaborator/i,
  /find (a )?partner/i,
  /team up/i,
  /\b0 people\b/i,
  /no people yet/i,
  /add (a person|someone)/i,
];

/** The matches of every guarded phrase in `text`, in list order; an empty list means the text passes. */
export function soloGuardViolations(text: string): string[] {
  const hits: string[] = [];
  for (const phrase of SOLO_GUARD_PHRASES) {
    const m = phrase.exec(text);
    if (m) hits.push(m[0]);
  }
  return hits;
}
