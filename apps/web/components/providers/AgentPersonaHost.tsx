"use client";
/**
 * Anthropomorphic agents' host (founder preference `anthropomorphicAgents`, Settings › Preferences and the Launch step):
 * mounted by the business layout inside the guidance host, it reads the account's switch and provides the design
 * system's `AgentPersonaProvider`, so every surface that names or pictures an agent (Inbox, Team, profile, palette,
 * conversation, hover cards) shows the persona's first name and face, or today's name and portrait when the switch is off.
 *
 * - Style (`agentStyle`: humans, 3D cartoon humans, 2D cartoon humans and animals, fantasy; absent reads as humans): the
 *   same persona key is a different character in each style, so the style names the agent (through the provider), picks
 *   the face's URL (`GET /personas/<style>/<key>`) and is part of the ensure query's key, so choosing another style asks
 *   again at once. An answer the API made for another style (a choice shown before it was saved) is never used.
 * - On: `team.personas.ensure` for the business on screen says which of its agents' persona keys have a face (`ready`),
 *   which are still being made (`pending`) and which were refused for good (`failed`), and starts making the missing ones
 *   in the background. While any is `pending` the query runs again every 15 seconds; a `failed` key is never waited on,
 *   so once nothing is pending the polling stops. A face is used only for keys in `ready`, loaded from the API's public
 *   `GET /personas/<style>/<key>` (cached for a day). Until a face is ready, and for good for a failed key, the drawn portrait
 *   stands in, so a screen never waits on one.
 * - Off: nothing is asked, nothing is fetched; every value is today's.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, type ReactNode } from "react";
import { AgentPersonaProvider } from "@foundmill/dugout";
import { DEFAULT_AGENT_STYLE, type AgentStyle } from "@foundmill/shared/personas";
import { publicEnv } from "@/lib/env";
import { useTRPC } from "@/lib/trpc-react";
import { agentStyleOf, useGuidancePreferences } from "./guidance-context";

/** How often the faces still being made are asked about again. */
export const PERSONA_POLL_MS = 15_000;

/** Where one persona's face is served in a style: the API's public route (a platform asset, no sign-in). */
export function personaPortraitUrl(apiUrl: string, personaKey: string, style: AgentStyle = DEFAULT_AGENT_STYLE): string {
  return `${apiUrl.replace(/\/+$/, "")}/personas/${encodeURIComponent(style)}/${encodeURIComponent(personaKey)}`;
}

/** What `team.personas.ensure` answers (apps/api services/personas.ts `PortraitStatus`). */
export interface PersonaPortraitStatus {
  /** The style the answer is for (older APIs leave it out: humans). */
  style?: AgentStyle;
  ready: readonly string[];
  pending: readonly string[];
  /** Refused for good: never polled for, the drawn portrait stays. */
  failed: readonly string[];
}

/** How soon an `ensure` answer made for another style (asked before the new choice was saved) is asked for again. */
export const PERSONA_STYLE_RECHECK_MS = 2_000;

/** True when the answer was made for another style than the one on screen. An answer without a style is humans' (older API). */
export function isOtherStyle(data: Pick<PersonaPortraitStatus, "style"> | undefined, style: AgentStyle): boolean {
  return data !== undefined && (data.style ?? DEFAULT_AGENT_STYLE) !== style;
}

/**
 * The poll interval for an `ensure` answer: every 15 s while faces are pending, never once none is (ready or failed).
 * An answer for another style (the choice was shown before the API had saved it) is asked for again after 2 s.
 */
export function personaRefetchInterval(data: (Pick<PersonaPortraitStatus, "pending"> & Partial<PersonaPortraitStatus>) | undefined, style: AgentStyle = DEFAULT_AGENT_STYLE): number | false {
  if (isOtherStyle(data, style)) return PERSONA_STYLE_RECHECK_MS;
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
  const style = agentStyleOf(prefs);
  const trpc = useTRPC();
  const options = trpc.team.personas.ensure.queryOptions(
    { businessId },
    {
      enabled: on,
      retry: false,
      staleTime: 60_000,
      refetchInterval: (query) => personaRefetchInterval(query.state.data, style),
    },
  );
  // The API ensures the faces in the account's style; the style is part of the cache key, so choosing another one
  // asks again at once instead of showing the previous style's answer.
  // tRPC builds the request from the key (`[path, { input, type }]`; a third element would read as a prefix), so the style
  // goes inside the second element, where nothing reads it but the cache. Invalidating `team.personas.ensure` by prefix
  // still reaches it.
  const [path, args] = options.queryKey;
  const queryKey = [path, { ...args, agentStyle: style }] as unknown as typeof options.queryKey;
  const q = useQuery({ ...options, queryKey });
  const base = apiUrl ?? publicEnv().apiUrl;
  // The ready keys as one string, so a poll that finds nothing new does not render every reader again.
  // An answer made for another style says nothing about this one's faces.
  const readyKey = q.data && !isOtherStyle(q.data, style) ? [...q.data.ready].sort().join(",") : "";
  const portraitUrl = useCallback(
    (key: string) => {
      const ready = readyKey ? readyKey.split(",") : [];
      return ready.includes(key) ? personaPortraitUrl(base, key, style) : null;
    },
    [readyKey, base, style],
  );
  const lookup = useMemo(() => (on ? portraitUrl : undefined), [on, portraitUrl]);
  return (
    <AgentPersonaProvider anthropomorphic={on} style={style} portraitUrl={lookup}>
      {children}
    </AgentPersonaProvider>
  );
}
