/**
 * The inputs of the business shell's first-screen queries, shared by the business layout (which starts them on the
 * server and hands them over, lib/hydrate.server.tsx) and BusinessShell (whose tRPC hooks read them). Both sides must
 * build the same query key, so both take the input from here. Server-safe: no React, no browser APIs.
 */

/** Inbox rows the shell reads for sidebar badges and the Continue state. */
export const SHELL_INBOX_PAGE = 50;

export function shellQueryInputs(businessId: string) {
  return {
    /** Sidebar: every department, hidden ones too (widgets read the same list and filter). */
    departments: { businessId, includeHidden: true, includeArchived: false },
    inbox: { businessId, limit: SHELL_INBOX_PAGE },
    finance: { businessId },
    cycle: { businessId },
  } as const;
}
