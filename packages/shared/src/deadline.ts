/**
 * A decision's deadline as the model writes it (`decision.expires_at`, BUILD §11.3). The model guesses at dates: a past
 * one would show "This decision expired; the team moved on with the recommended option" and lock the options on a note
 * that still blocks Continue, and a string that is not a date means nothing. A deadline is kept only when it is an ISO
 * timestamp in the future, within `maxDays` (audit CML-13); anything else is no deadline.
 */
export const DECISION_DEADLINE_MAX_DAYS = 90;

export function futureDeadline(value: unknown, now: Date, maxDays: number = DECISION_DEADLINE_MAX_DAYS): string | null {
  if (typeof value !== "string") return null;
  // ISO 8601 date or date-time only: Date.parse accepts far looser strings ("Tuesday", "5/6/26").
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value.trim())) return null;
  const at = Date.parse(value.trim());
  if (!Number.isFinite(at)) return null;
  if (at <= now.getTime() || at > now.getTime() + maxDays * 86_400_000) return null;
  return new Date(at).toISOString();
}
