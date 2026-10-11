"use client";
/**
 * The signed-in person's date and time format (Settings › Preferences), handed down to every component that prints a
 * date. The app mounts one provider per signed-in layout with the choice the server rendered with, so the first client
 * render matches the server's HTML; changing `value` re-renders every date below without a reload. Outside a provider
 * (the signed-out pages, stories, tests) everything reads US dates and 12-hour times.
 *
 *   const { formatDate, formatDateShort, formatTime, formatDateTime, formatRange, formatHourOfDay } = useFormatters();
 *
 * Server components cannot use the hooks: they take the choice as a prop and call `bindFormatters(prefs)` (lib/format).
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { bindFormatters, type DateFormatters } from "../../lib/format";
import { DEFAULT_DATE_FORMAT_PREFS, normalizeDateFormatPrefs, type DateFormatPrefs } from "../../lib/date-preferences";

const DateFormatContext = createContext<DateFormatPrefs>(DEFAULT_DATE_FORMAT_PREFS);

export interface DateFormatProviderProps {
  /** The person's choice; anything missing or unknown reads as the default (US, 12-hour). */
  value?: Partial<DateFormatPrefs> | null;
  children?: ReactNode;
}

export function DateFormatProvider({ value, children }: DateFormatProviderProps) {
  const date = value?.date;
  const time = value?.time;
  const prefs = useMemo(() => normalizeDateFormatPrefs({ date, time }), [date, time]);
  return <DateFormatContext.Provider value={prefs}>{children}</DateFormatContext.Provider>;
}

/** The current person's date and time format (US and 12-hour outside a provider). */
export function useDateFormat(): DateFormatPrefs {
  return useContext(DateFormatContext);
}

/** Every date helper bound to the current person's choice; a new object only when the choice changes. */
export function useFormatters(): DateFormatters {
  const prefs = useDateFormat();
  return useMemo(() => bindFormatters(prefs), [prefs]);
}
