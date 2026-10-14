/** Reading a tRPC query key (shared by lib/query-client.ts and lib/auth/session-end.ts, which must not import each other). */

/** The router of a tRPC query key (`[["inbox", "list"], {…}]` → "inbox"). */
export function routerOfKey(queryKey: readonly unknown[]): string | null {
  const path = queryKey[0];
  return Array.isArray(path) && typeof path[0] === "string" ? path[0] : null;
}

/** The business a tRPC query key reads (`[["inbox", "list"], { input: { businessId } }]`); null for account-level reads. */
export function businessOfKey(queryKey: readonly unknown[]): string | null {
  const meta = queryKey[1];
  const input = meta && typeof meta === "object" ? (meta as { input?: unknown }).input : undefined;
  const businessId = input && typeof input === "object" ? (input as { businessId?: unknown }).businessId : undefined;
  return typeof businessId === "string" ? businessId : null;
}
