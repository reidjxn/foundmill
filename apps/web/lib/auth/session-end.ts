/**
 * What the tab does when it loses its right to be here (audit RES-08, RUI-13):
 *
 * - the session ended: this browser signed out in another tab (`announceSignedOut`), or the API answered UNAUTHORIZED.
 *   The tab closes its stream socket, empties its cache and goes to `/login?next=<where it was>`;
 * - the person was removed from the business on screen: the API answers FORBIDDEN with appCode `not_a_member`. The tab
 *   drops that business's cached reads, says what happened and goes to the person's businesses.
 *
 * `reportApiError` is called by the QueryCache and MutationCache (lib/query-client.ts) for every failed read and write;
 * the app registers one listener (components/providers/AuthLossWatcher.tsx) that runs `handleAuthLoss`.
 */
import type { QueryClient } from "@tanstack/react-query";
import { businessOfKey } from "../query-keys";
import { NEXT_PARAM } from "./constants";

export type AuthLoss = { kind: "signed-out" } | { kind: "removed"; businessId: string };
export type AuthLossSource = "api" | "tab";

/** The appCode the API puts on the FORBIDDEN of a business procedure called by someone who is not (or no longer) a member. */
export const NOT_A_MEMBER_CODE = "not_a_member";

const listeners = new Set<(loss: AuthLoss, from: AuthLossSource) => void>();

/** Listen for a lost session or membership. Returns the unsubscribe. */
export function onAuthLoss(listener: (loss: AuthLoss, from: AuthLossSource) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAuthLoss(loss: AuthLoss, from: AuthLossSource = "api"): void {
  for (const listener of [...listeners]) listener(loss, from);
}

/** What an API error says about the access: UNAUTHORIZED ends the session, a "not a member" FORBIDDEN the membership. */
export function classifyApiError(err: unknown, businessId: string | null): AuthLoss | null {
  const data = err && typeof err === "object" ? ((err as { data?: { code?: unknown; appCode?: unknown } }).data ?? null) : null;
  if (!data) return null;
  if (data.code === "UNAUTHORIZED") return { kind: "signed-out" };
  if (data.code === "FORBIDDEN" && data.appCode === NOT_A_MEMBER_CODE && businessId) return { kind: "removed", businessId };
  return null;
}

/** Called for every failed query and mutation; tells the listeners when the failure means the access is gone. */
export function reportApiError(err: unknown, businessId: string | null): void {
  const loss = classifyApiError(err, businessId);
  if (loss) emitAuthLoss(loss, "api");
}

// --- the other tabs ---------------------------------------------------------------------------------------------------

const SESSION_CHANNEL = "foundmill:session";

/** Identifies this tab, so a message it sends is not acted on by its own watcher (it is already navigating). */
const TAB_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());

interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
export type ChannelFactory = (name: string) => ChannelLike | null;

const browserChannel: ChannelFactory = (name) => (typeof BroadcastChannel === "undefined" ? null : (new BroadcastChannel(name) as unknown as ChannelLike));

/** Tells every other tab of this browser that the session ended; they close their socket and go to sign-in. */
export function announceSignedOut(open: ChannelFactory = browserChannel): void {
  try {
    const channel = open(SESSION_CHANNEL);
    if (!channel) return;
    channel.postMessage({ type: "signed-out", from: TAB_ID });
    channel.close();
  } catch {
    /* the other tabs find out from their next UNAUTHORIZED answer */
  }
}

/** Calls `handler` when another tab of this browser signs out. Returns the stop function. */
export function watchSignedOutElsewhere(handler: () => void, open: ChannelFactory = browserChannel): () => void {
  let channel: ChannelLike | null = null;
  try {
    channel = open(SESSION_CHANNEL);
  } catch {
    return () => undefined;
  }
  if (!channel) return () => undefined;
  channel.onmessage = (ev) => {
    const msg = ev.data as { type?: unknown; from?: unknown } | null;
    if (msg?.type === "signed-out" && msg.from !== TAB_ID) handler();
  };
  return () => {
    channel?.close();
    channel = null;
  };
}

// --- reacting ---------------------------------------------------------------------------------------------------------

export function signInUrl(path: string): string {
  return `/login?${NEXT_PARAM}=${encodeURIComponent(path)}`;
}

/** Marks a redirect to sign-in, so a session the API refuses while the proxy still accepts it cannot loop. */
export const REDIRECT_MARK = "fm_signin_redirect_at";
export const REDIRECT_LOOP_MS = 15_000;

export interface AuthLossDeps {
  queryClient: QueryClient;
  closeStream: () => void;
  /** Full navigation (`location.assign`). */
  navigate: (url: string) => void;
  /** Client navigation to a page of the app (`router.replace`). */
  replace: (path: string) => void;
  toast: (t: { title: string; description?: string; tone: "warn" }) => void;
  /** The page on screen: path and query. */
  location: () => { pathname: string; search: string };
  /** The name of a business from the cache, for the notice. */
  businessName: (businessId: string) => string | null;
  now?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

function recentlyRedirected(deps: AuthLossDeps): boolean {
  try {
    const at = Number(deps.storage?.getItem(REDIRECT_MARK) ?? 0);
    return at > 0 && (deps.now ?? Date.now)() - at < REDIRECT_LOOP_MS;
  } catch {
    return false;
  }
}

const removedHandled = new Set<string>();
let signedOutHandled = false;

/** Test hook: forget what was handled. */
export function resetAuthLossHandling(): void {
  removedHandled.clear();
  signedOutHandled = false;
}

/** Runs once per loss: a page whose queries all fail together gets one redirect and one notice, not one per query. */
export function handleAuthLoss(loss: AuthLoss, from: AuthLossSource, deps: AuthLossDeps): void {
  const { pathname, search } = deps.location();
  if (loss.kind === "signed-out") {
    // Already on a sign-in or sign-out page, or already leaving.
    if (signedOutHandled || pathname.startsWith("/login") || pathname.startsWith("/auth/")) return;
    // The API refused a session the proxy still accepts: one hop to sign-in, never a loop between the two.
    if (from === "api" && recentlyRedirected(deps)) return;
    signedOutHandled = true;
    deps.closeStream();
    deps.queryClient.clear();
    try {
      deps.storage?.setItem(REDIRECT_MARK, String((deps.now ?? Date.now)()));
    } catch {
      /* storage is blocked: the loop guard is best effort */
    }
    deps.navigate(signInUrl(`${pathname}${search}`));
    return;
  }
  if (removedHandled.has(loss.businessId)) return;
  removedHandled.add(loss.businessId);
  const name = deps.businessName(loss.businessId);
  const ofBusiness = (q: { queryKey: readonly unknown[] }) => businessOfKey(q.queryKey) === loss.businessId;
  void deps.queryClient.cancelQueries({ predicate: ofBusiness });
  deps.queryClient.removeQueries({ predicate: ofBusiness });
  deps.toast({ title: name ? `You no longer have access to ${name}` : "You no longer have access to that business", description: "Ask an owner of the business to add you again.", tone: "warn" });
  // Only a person looking at that business is sent away; the notice is enough for anyone else.
  const prefix = `/b/${loss.businessId}`;
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) deps.replace("/");
}
