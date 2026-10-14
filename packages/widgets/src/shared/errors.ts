/**
 * A failed query is never empty data. Widgets and module screens that build figures from a query check its error first
 * and say what happened in these words: "No access" when the person's role is walled from the section (tRPC FORBIDDEN,
 * BUILD §11.9 section permissions), "Couldn't load" otherwise. Never a zero, "Quiet" or setup advice ("Connect a bank")
 * that is only true when the data really is empty.
 */

/** The tRPC error code an error carries (`data.code` on a TRPCClientError), or one named in its message. */
export function queryErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { data?: { code?: unknown } }).data?.code;
  if (typeof code === "string") return code;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? (/\b(FORBIDDEN|UNAUTHORIZED|NOT_FOUND)\b/.exec(message)?.[1] ?? null) : null;
}

/** The query was refused because the person may not read that section. */
export function isForbidden(error: unknown): boolean {
  return queryErrorCode(error) === "FORBIDDEN" || (error instanceof Error && /do not have read access/i.test(error.message));
}

/** A query failed and nothing was cached: the figures it feeds are unknown, not zero. */
export function failedWithoutData(q: { data: unknown; error: Error | null }): boolean {
  return !!q.error && q.data === undefined;
}

/** The value and caption a tile shows when its query failed, naming the section a walled person cannot read. */
export function unavailableWords(error: unknown, section: string): { value: string; caption: string } {
  return isForbidden(error) ? { value: "No access", caption: `Your role has no access to ${section}` } : { value: "Couldn't load", caption: `${section} could not be loaded. Try again shortly.` };
}
