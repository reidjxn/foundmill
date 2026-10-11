"use client";
/**
 * The signed-in person's date and time format for everything below (mounted by every signed-in layout: the business
 * shell, LIVE, /new, /onboarding). It starts from the choice the server rendered with (`initial`, from the cookie or the
 * API; lib/date-format.server.ts), so the first client render matches the server's HTML, then:
 *
 * - reconciles with `founder.preferences.get` once on load (another device may have changed it) and whenever the query
 *   is refetched, and keeps the cookie in step with what it read, so the next server render is right;
 * - saves a change through `founder.preferences.update` (`useDatePreferences().save`), showing it at once everywhere
 *   (optimistic, rolled back if the save fails) and writing the cookie.
 *
 * Everything that prints a date reads it through the design system's `useFormatters()` / `useDateFormat()`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { DateFormatProvider, normalizeDateFormatPrefs, type DateFormatPrefs } from "@foundmill/dugout";
import { dateFormatCookieString, encodeDateFormatCookie, readDateFormatCookie } from "@/lib/date-format";
import { useTRPC } from "@/lib/trpc-react";

export interface DatePreferencesApi {
  prefs: DateFormatPrefs;
  /** Saves a change (one field or both); every date on screen follows at once. Rejects when the save fails. */
  save: (change: Partial<DateFormatPrefs>) => Promise<DateFormatPrefs>;
  saving: boolean;
}

const DatePreferencesCtx = createContext<DatePreferencesApi | null>(null);

/** The current choice and a way to change it (Settings › Preferences). Throws outside a signed-in layout. */
export function useDatePreferences(): DatePreferencesApi {
  const ctx = useContext(DatePreferencesCtx);
  if (!ctx) throw new Error("useDatePreferences must be used inside <DateFormatHost>");
  return ctx;
}

export interface DateFormatHostProps {
  /** The choice the server rendered with. */
  initial: DateFormatPrefs;
  /** Whose cookie this is (lib/date-format.ts); "" when nobody is signed in, and then nothing is read or written. */
  owner: string;
  children?: ReactNode;
}

export function DateFormatHost({ initial, owner, children }: DateFormatHostProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const queryKey = trpc.founder.preferences.get.queryKey();
  // Seeded with the server's choice (so hydration matches) and marked stale, so it is checked once against the account.
  const q = useQuery(
    trpc.founder.preferences.get.queryOptions(undefined, {
      enabled: owner !== "",
      initialData: initial,
      initialDataUpdatedAt: 0,
      staleTime: 5 * 60_000,
      retry: false,
    }),
  );
  const date = q.data?.date ?? initial.date;
  const time = q.data?.time ?? initial.time;
  const prefs = useMemo(() => normalizeDateFormatPrefs({ date, time }), [date, time]);

  // The cookie follows whatever was read or saved, so the next server render needs no API call and shows no flash.
  useEffect(() => {
    if (!owner) return;
    if (readDateFormatCookie(document.cookie) === encodeDateFormatCookie(prefs, owner)) return;
    document.cookie = dateFormatCookieString(prefs, owner, window.location.protocol === "https:");
  }, [owner, prefs]);

  const mutationKey = trpc.founder.preferences.update.mutationKey();
  // Two quick changes travel as two requests that may answer in either order: only the last one still pending writes
  // its answer, and the last to settle asks the account again, so the screen always ends on what was stored.
  const lastPending = () => queryClient.isMutating({ mutationKey }) <= 1;
  const overlapped = useRef(false);
  const update = useMutation(
    trpc.founder.preferences.update.mutationOptions({
      onMutate: async (change) => {
        if (!lastPending()) overlapped.current = true;
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData<DateFormatPrefs>(queryKey);
        queryClient.setQueryData<DateFormatPrefs>(queryKey, (old) => normalizeDateFormatPrefs({ ...(old ?? initial), ...change }));
        return { previous };
      },
      onError: (_err, _change, context) => {
        if (context?.previous && lastPending()) queryClient.setQueryData(queryKey, context.previous);
      },
      onSuccess: (saved) => {
        if (lastPending()) queryClient.setQueryData(queryKey, saved);
      },
      onSettled: () => {
        if (!lastPending() || !overlapped.current) return;
        overlapped.current = false;
        void queryClient.invalidateQueries({ queryKey });
      },
    }),
  );
  const { mutateAsync, isPending } = update;
  const save = useCallback((change: Partial<DateFormatPrefs>) => mutateAsync(change), [mutateAsync]);
  const api = useMemo<DatePreferencesApi>(() => ({ prefs, save, saving: isPending }), [prefs, save, isPending]);

  return (
    <DatePreferencesCtx.Provider value={api}>
      <DateFormatProvider value={prefs}>{children}</DateFormatProvider>
    </DatePreferencesCtx.Provider>
  );
}
