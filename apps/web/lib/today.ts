"use client";
/**
 * Today for the top bar's date chip: the business's day once it has a time zone (businesses.time_zone, audit #196, so
 * the chip names the same day as Home's tiles and the Journey), the founder's own day before that. The server renders
 * in UTC, and on a US evening UTC is already tomorrow ("Oct 11" on the server, "Oct 10" in the browser), so a date
 * rendered on both sides fails hydration. The day is only known in the browser: null on the server and during
 * hydration, the day after it. It moves on at midnight (checked once a minute), without re-rendering in between.
 */
import { isAdminRole } from "@foundmill/shared/constants";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { dayKeyIn, isValidTimeZone } from "@foundmill/shared/time-zone";

/** "2026-10-10" for the local calendar day of `now`. */
export function localDayKey(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Local noon on the day a key names, so formatting it in the browser's zone always gives that day. */
export function dateOfDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, 60_000);
  return () => clearInterval(id);
}

const getServerDay = (): string | null => null;

/** The day key for the chip: the business's calendar day when its zone is known, else the browser's. */
export function todayKey(now: Date, timeZone?: string | null): string {
  return isValidTimeZone(timeZone) ? dayKeyIn(now, timeZone) : localDayKey(now);
}

/** Today in the business's time zone (the browser's while it has none), or null on the server and while hydrating. */
export function useClientToday(timeZone?: string | null): Date | null {
  const read = useCallback(() => todayKey(new Date(), timeZone), [timeZone]);
  const key = useSyncExternalStore(subscribe, read, getServerDay);
  return useMemo(() => (key ? dateOfDayKey(key) : null), [key]);
}

/** The browser's IANA zone ("America/New_York"), or null when the runtime does not say. */
export function browserTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * The zone to set on a business that has none yet (audit #196): the browser's, when an owner or admin opens it. Others,
 * and a business that has a zone, leave it alone; Settings › Business changes it later.
 */
export function timeZoneToClaim(current: string | null | undefined, role: string | null | undefined, browser: string | null): string | null {
  if (current || !browser) return null;
  return isAdminRole(role) ? browser : null;
}

const MINUTE_MS = 60_000;

function subscribeTenSeconds(onChange: () => void): () => void {
  const id = setInterval(onChange, 10_000);
  return () => clearInterval(id);
}

/** The start of the current minute (stable between checks, so React sees no change until the minute turns). */
const currentMinute = (): number => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
const noMinute = (): number | null => null;

/**
 * Now, to the minute, in the browser only: null on the server and while hydrating (a time printed on both sides would
 * differ by zone and by the seconds between them), then the current minute, moving on within ten seconds of each turn.
 * For live examples such as Settings › Preferences.
 */
export function useClientNow(): Date | null {
  const ms = useSyncExternalStore(subscribeTenSeconds, currentMinute, noMinute);
  return useMemo(() => (ms === null ? null : new Date(ms)), [ms]);
}

const subscribeNever = (): (() => void) => () => undefined;

/**
 * False on the server and during hydration, true once the browser has taken over: for absolute times that depend on
 * the reader's time zone (an Inbox note's "Oct 7, 3:45 PM"), which the server, rendering in UTC, cannot print the same.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
