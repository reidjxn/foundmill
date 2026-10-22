"use client";
/**
 * Anthropomorphic agents' host (founder preference `anthropomorphicAgents`, Settings › Preferences and the Launch step):
 * mounted by the business layout inside the guidance host, it reads the account's switch and provides the design
 * system's `AgentPersonaProvider`, so every surface that names or pictures an agent (Inbox, Team, profile, palette,
 * conversation, hover cards) shows the persona's first name and face, or today's name and portrait when the switch is off.
 *
 * - On: `team.personas.ensure` for the business on screen says which of its agents' persona keys have a face and starts
 *   making the missing ones in the background. While any is `pending` the query runs again every 15 seconds; a face is
 *   used only for keys in `ready`, loaded from the API's public `GET /personas/<key>` (immutable, cached for a year).
 *   Until a face is ready the drawn portrait stands in, so a screen never waits on one.
 * - Off: nothing is asked, nothing is fetched; every value is today's.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, type ReactNode } from "react";
import { AgentPersonaProvider } from "@foundmill/dugout";
import { publicEnv } from "@/lib/env";
import { useTRPC } from "@/lib/trpc-react";
import { useGuidancePreferences } from "./guidance-context";

/** How often the faces still being made are asked about again. */
export const PERSONA_POLL_MS = 15_000;

/** Where one persona's face is served: the API's public route (a platform asset, no sign-in). */
export function personaPortraitUrl(apiUrl: string, personaKey: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/personas/${encodeURIComponent(personaKey)}`;
}

/** The poll interval for an `ensure` answer: every 15 s while faces are pending, never once all are ready. */
export function personaRefetchInterval(data: { pending: readonly string[] } | undefined): number | false {
  return data && data.pending.length > 0 ? PERSONA_POLL_MS : false;
}

export interface AgentPersonaHostProps {
  businessId: string;
  children?: ReactNode;
  /** Tests and stories: the API origin the faces load from. Default NEXT_PUBLIC_API_URL. */
  apiUrl?: string;
}

export function AgentPersonaHost({ businessId, apiUrl, children }: AgentPersonaHostProps) {
  const { prefs } = useGuidancePreferences();
  const on = prefs.anthropomorphicAgents === true;
  const trpc = useTRPC();
  const q = useQuery(
    trpc.team.personas.ensure.queryOptions(
      { businessId },
      {
        enabled: on,
        retry: false,
        staleTime: 60_000,
        refetchInterval: (query) => personaRefetchInterval(query.state.data),
      },
    ),
  );
  const base = apiUrl ?? publicEnv().apiUrl;
  // The ready keys as one string, so a poll that finds nothing new does not render every reader again.
  const readyKey = q.data ? [...q.data.ready].sort().join(",") : "";
  const portraitUrl = useCallback(
    (key: string) => {
      const ready = readyKey ? readyKey.split(",") : [];
      return ready.includes(key) ? personaPortraitUrl(base, key) : null;
    },
    [readyKey, base],
  );
  const lookup = useMemo(() => (on ? portraitUrl : undefined), [on, portraitUrl]);
  return (
    <AgentPersonaProvider anthropomorphic={on} portraitUrl={lookup}>
      {children}
    </AgentPersonaProvider>
  );
}
