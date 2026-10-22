/**
 * The signed-in person's guidance preferences for this server render (`founder.preferences.guidance`: one small row),
 * read by each signed-in layout with the rest of its data and handed to its GuidanceHost as `initial`. The first render
 * then already holds the account's answer: a tour already done never opens for a frame, an account with guidance off
 * never sees an explainer flash in, and the browser does not ask again (review F28, perf audit item 2).
 *
 * React `cache()`d (one read per request, shared by a layout and its page). Never rejects: a failed read hands `prefs:
 * null` over, and the host then reads once in the browser while the coach marks and explainers wait.
 *
 * Imported by Server Components only (no "use client").
 */
import { cache } from "react";
import type { RouterOutputs } from "./trpc";
import { serverApi } from "./trpc-server";

export interface ServerGuidance {
  /** Whether a session was found (the layout's host reads and saves only then). */
  signedIn: boolean;
  /** The account's answer, or null when nobody is signed in or the read failed. */
  prefs: RouterOutputs["founder"]["preferences"]["guidance"] | null;
}

export const getServerGuidance = cache(async (): Promise<ServerGuidance> => {
  const server = await serverApi();
  if (!server) return { signedIn: false, prefs: null };
  try {
    return { signedIn: true, prefs: await server.api.founder.preferences.guidance.query() };
  } catch {
    return { signedIn: true, prefs: null };
  }
});
