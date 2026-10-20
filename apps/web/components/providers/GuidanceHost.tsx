"use client";
/**
 * The guided layer's host (docs/UX_AUDIT_AND_PLAN.md §6.3): mounted once in AppProviders, it reads the signed-in
 * person's guidance preferences (`founder.preferences.guidance`: the switch, the text size, the explainers seen, the
 * tours done, the checklist) and provides the design system's `GuidanceProvider` with them and with the definitions map
 * (`TERMS` run through the business glossary), the way DateFormatHost provides the date format. Below it every
 * primitive reads `useGuidance()`, and Settings › Preferences changes the choice through `useGuidancePreferences()`.
 *
 * - It reads only on a signed-in page (the proxy's own rule, lib/auth/redirects.ts `isFounderPath`; `/` is the landing
 *   page for a visitor): a read from a signed-out page would answer UNAUTHORIZED and send the visitor to sign in. The
 *   business layouts start the read on the server and hand it over with the page (lib/shell-data.server.ts), so the
 *   shell asks nothing after hydration; the other signed-in pages read once on load. Until the answer, and on every
 *   signed-out page, guidance reads as on with standard text.
 * - A change (`save`, and the provider's actions) shows at once everywhere (optimistic, rolled back if the save fails);
 *   two quick changes end on what was stored, as DateFormatHost does.
 * - Comfortable text is stamped on the document (`data-text="comfortable"` on <html>, the tokens' own hook) and removed
 *   when the choice is standard. The choice is mirrored into a cookie (text-size-cookie.ts, like the date format's),
 *   which app/layout.tsx reads so the first byte already carries the attribute; `initialTextSize` is what that render
 *   used, and it holds until the account answers.
 * - The glossary of the business on screen (`business.get`, read from the query cache under the route's id, never asked
 *   for here) renames the display words of the definitions, so a business that says "clients" reads it in every term;
 *   outside a business the map is `TERMS` as written. "Learn more" resolves through `learnPath` with the route's
 *   business id (LearnLinkProvider); outside a business only absolute URLs open.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { GuidanceProvider, LearnLinkProvider, type GuidanceActions, type GuidanceState, type TermDefinition } from "@foundmill/dugout";
import type { Glossary } from "@foundmill/shared/glossary";
import { TERMS, learnPath, termsWithGlossary } from "@foundmill/shared/terms";
import { isFounderPath } from "@/lib/auth/redirects";
import type { RouterInputs, RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { encodeTextSizeCookie, readTextSizeCookie, textSizeCookieString, type TextSizeChoice } from "./text-size-cookie";

/** The guided layer's preferences, as the API answers them. */
export type GuidancePrefs = RouterOutputs["founder"]["preferences"]["guidance"];
/** A change to them (the date format is DateFormatHost's). */
export type GuidancePatch = Omit<RouterInputs["founder"]["preferences"]["update"], "date" | "time">;

/** What everyone reads until the account answers, and on every signed-out page. */
export const DEFAULT_GUIDANCE_PREFS: Readonly<GuidancePrefs> = Object.freeze({ guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null });

/** How long the choice read on load is taken as current (the same as the date format's). */
export const GUIDANCE_FRESH_MS = 5 * 60_000;

/**
 * The key of this host's own mutations: not the procedure's, so DateFormatHost's "is another change of mine pending"
 * check (`isMutating` on the procedure key) never counts a guidance change, and this host's never counts a date one.
 */
export const GUIDANCE_MUTATION_KEY: readonly unknown[] = [["founder", "preferences", "guidance"]];

/** True on the pages the proxy reserves for a signed-in founder; `/` is the landing page for a visitor, so it is not one. */
export function isSignedInPath(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && pathname !== "/" && isFounderPath(pathname);
}

/** The guided layer's part of a full preferences answer (`founder.preferences.update` returns the formats too). */
export function guidancePrefsOf(p: GuidancePrefs): GuidancePrefs {
  return { guidance: p.guidance, textSize: p.textSize, explainersSeen: p.explainersSeen, toursDone: p.toursDone, checklistDismissedAt: p.checklistDismissedAt };
}

/** What the account will hold once `patch` is saved: the optimistic answer, written before the API's. */
export function applyGuidancePatch(prev: GuidancePrefs, patch: GuidancePatch, now: string): GuidancePrefs {
  const next: GuidancePrefs = { ...prev, explainersSeen: { ...prev.explainersSeen }, toursDone: { ...prev.toursDone } };
  if (patch.guidance !== undefined) next.guidance = patch.guidance;
  if (patch.textSize !== undefined) next.textSize = patch.textSize;
  if (patch.reset) {
    next.explainersSeen = {};
    next.toursDone = {};
    next.checklistDismissedAt = null;
    return next;
  }
  if (patch.explainersSeen) for (const id of Object.keys(patch.explainersSeen)) next.explainersSeen[id] = true;
  if (patch.toursDone) for (const id of Object.keys(patch.toursDone)) next.toursDone[id] = true;
  if (patch.checklistDismissed !== undefined) next.checklistDismissedAt = patch.checklistDismissed ? now : null;
  return next;
}

export interface GuidancePreferencesApi {
  prefs: GuidancePrefs;
  /** Saves a change; the guided layer follows at once everywhere. Rejects when the save fails (then it is rolled back). */
  save: (patch: GuidancePatch) => Promise<GuidancePrefs>;
  saving: boolean;
  /** False on a signed-out page: nothing is read, nothing can be saved, everything reads as the default. */
  signedIn: boolean;
}

const GuidancePreferencesCtx = createContext<GuidancePreferencesApi | null>(null);

/** The current choice and a way to change it (Settings › Preferences). Throws outside <GuidanceHost>. */
export function useGuidancePreferences(): GuidancePreferencesApi {
  const ctx = useContext(GuidancePreferencesCtx);
  if (!ctx) throw new Error("useGuidancePreferences must be used inside <GuidanceHost>");
  return ctx;
}

const NO_GLOSSARY: Glossary | null = null;

/** The business the route names (`/b/[bid]/…`), or null elsewhere (LIVE, /new, /onboarding, the sign-in pages). */
function useRouteBusinessId(): string | null {
  const params = useParams<{ bid?: string }>();
  return typeof params?.bid === "string" ? params.bid : null;
}

/** The glossary of the business the route names, from the query cache (BusinessShell holds `business.get`); null elsewhere. */
function useBusinessGlossary(bid: string | null): Glossary | null {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const subscribe = useCallback((onChange: () => void) => (bid ? queryClient.getQueryCache().subscribe(onChange) : () => undefined), [queryClient, bid]);
  const read = useCallback(() => {
    if (!bid) return NO_GLOSSARY;
    const data = queryClient.getQueryData<RouterOutputs["business"]["get"]>(trpc.business.get.queryKey({ businessId: bid }));
    return data?.business?.glossary ?? NO_GLOSSARY;
  }, [queryClient, trpc, bid]);
  return useSyncExternalStore(subscribe, read, () => NO_GLOSSARY);
}

/**
 * Where a definition's "Learn more" goes: an absolute URL as given; a route slug through `learnPath` inside the
 * business the route names; nowhere (no link) outside a business, since a department tab needs one.
 */
export function resolveLearn(learn: string, businessId: string | null): string | undefined {
  if (/^https?:\/\//.test(learn)) return learn;
  if (!businessId) return undefined;
  return learnPath(learn, businessId);
}

/** The definitions map for the business on screen (its glossary applied), or the map as written elsewhere. */
export function termsFor(businessId: string | null, glossary: Glossary | null): Record<string, TermDefinition> {
  return businessId ? termsWithGlossary(glossary) : TERMS;
}

export interface GuidanceHostProps {
  /** The account's preferences when the layout already has them (rendered with the page); else they are read. */
  initial?: GuidancePrefs | null;
  /** Whether a signed-in account is on screen; decided from the route when not given. */
  signedIn?: boolean;
  /** Whose text-size cookie this is (text-size-cookie.ts); "" or missing when nobody is signed in: nothing is written then. */
  textSizeOwner?: string;
  /** The text size the server rendered the document with (from the cookie), kept until the account answers. */
  initialTextSize?: TextSizeChoice | null;
  children?: ReactNode;
}

const noop = () => undefined;

export function GuidanceHost({ initial, signedIn: signedInProp, textSizeOwner = "", initialTextSize = null, children }: GuidanceHostProps) {
  const pathname = usePathname();
  const signedIn = signedInProp ?? isSignedInPath(pathname);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const queryKey = trpc.founder.preferences.guidance.queryKey();
  const q = useQuery(
    trpc.founder.preferences.guidance.queryOptions(undefined, {
      enabled: signedIn,
      initialData: initial ?? undefined,
      staleTime: GUIDANCE_FRESH_MS,
      retry: false,
    }),
  );
  // Until the account answers, the text size is what the server rendered with (the cookie): no flash.
  const seed = useMemo<GuidancePrefs>(() => (initialTextSize ? { ...DEFAULT_GUIDANCE_PREFS, textSize: initialTextSize } : DEFAULT_GUIDANCE_PREFS), [initialTextSize]);
  const prefs: GuidancePrefs = q.data ?? initial ?? seed;

  // Comfortable text: the tokens read the attribute on the root (packages/dugout tokens.css); standard removes it.
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.textSize === "comfortable") root.setAttribute("data-text", "comfortable");
    else root.removeAttribute("data-text");
  }, [prefs.textSize]);

  // The cookie follows whatever the account said or the person saved, so the next server render carries the attribute
  // on the first byte. Only once the account has answered (or the layout handed its answer over): the default is never
  // written over a real choice.
  const answered = q.data !== undefined;
  useEffect(() => {
    if (!signedIn || !textSizeOwner || !answered) return;
    if (readTextSizeCookie(document.cookie) === encodeTextSizeCookie(prefs.textSize, textSizeOwner)) return;
    document.cookie = textSizeCookieString(prefs.textSize, textSizeOwner, window.location.protocol === "https:");
  }, [signedIn, textSizeOwner, answered, prefs.textSize]);

  // Two quick changes travel as two requests that may answer in either order: only the last one still pending writes
  // its answer, and the last to settle asks the account again, so the screen always ends on what was stored.
  const lastPending = () => queryClient.isMutating({ mutationKey: GUIDANCE_MUTATION_KEY }) <= 1;
  const overlapped = useRef(false);
  const fallback = useRef(prefs);
  fallback.current = prefs;
  const options = trpc.founder.preferences.update.mutationOptions({
    onMutate: async (change) => {
      if (!lastPending()) overlapped.current = true;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<GuidancePrefs>(queryKey);
      queryClient.setQueryData<GuidancePrefs>(queryKey, (old) => applyGuidancePatch(old ?? fallback.current, change, new Date().toISOString()));
      return { previous };
    },
    onError: (_err, _change, context) => {
      if (!lastPending()) return;
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      else void queryClient.invalidateQueries({ queryKey });
    },
    onSuccess: (saved) => {
      if (lastPending()) queryClient.setQueryData(queryKey, guidancePrefsOf(saved));
    },
    onSettled: () => {
      if (!lastPending() || !overlapped.current) return;
      overlapped.current = false;
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const { mutateAsync, isPending } = useMutation({ ...options, mutationKey: GUIDANCE_MUTATION_KEY });
  const save = useCallback(
    (patch: GuidancePatch): Promise<GuidancePrefs> => {
      if (!signedIn) return Promise.reject(new Error("Sign in to change your preferences"));
      return mutateAsync(patch).then(guidancePrefsOf);
    },
    [mutateAsync, signedIn],
  );

  // The primitives' actions: fire and forget (a failed "Got it" is rolled back and asked again next time).
  const actions = useMemo<GuidanceActions>(
    () => ({
      setGuidance: (mode) => void save({ guidance: mode }).catch(noop),
      setTextSize: (size) => void save({ textSize: size }).catch(noop),
      markExplainerSeen: (screenId) => void save({ explainersSeen: { [screenId]: true } }).catch(noop),
      markTourDone: (tourId) => void save({ toursDone: { [tourId]: true } }).catch(noop),
      dismissChecklist: () => void save({ checklistDismissed: true }).catch(noop),
      resetGuidance: () => void save({ reset: true }).catch(noop),
    }),
    [save],
  );

  const bid = useRouteBusinessId();
  const glossary = useBusinessGlossary(bid);
  const terms = useMemo(() => termsFor(bid, glossary), [bid, glossary]);
  const resolve = useCallback((learn: string) => resolveLearn(learn, bid), [bid]);
  const value = useMemo<GuidanceState>(
    () => ({ guidance: prefs.guidance, textSize: prefs.textSize, explainersSeen: prefs.explainersSeen, toursDone: prefs.toursDone, checklistDismissedAt: prefs.checklistDismissedAt, terms }),
    [prefs, terms],
  );
  const api = useMemo<GuidancePreferencesApi>(() => ({ prefs, save, saving: isPending, signedIn }), [prefs, save, isPending, signedIn]);

  return (
    <GuidancePreferencesCtx.Provider value={api}>
      <LearnLinkProvider resolve={resolve}>
        <GuidanceProvider value={value} actions={actions}>
          {children}
        </GuidanceProvider>
      </LearnLinkProvider>
    </GuidancePreferencesCtx.Provider>
  );
}
