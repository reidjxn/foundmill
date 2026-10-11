/**
 * The signed-in person's date format for this server render (see lib/date-format.ts). The cookie the browser keeps is
 * read first, so a page renders in the person's format without waiting on the API; when it is missing, malformed or
 * belongs to another account, `founder.preferences.get` answers instead (the browser then writes the cookie). Signed-out
 * requests and an unreachable API read the defaults (US, 12-hour). React `cache()`d: one answer per request, shared by
 * a layout and its page.
 *
 * Imported by Server Components only (no "use client").
 */
import { cookies } from "next/headers";
import { cache } from "react";
import { DEFAULT_DATE_FORMAT_PREFS, normalizeDateFormatPrefs, type DateFormatPrefs } from "@foundmill/dugout/lib/date-preferences";
import { DATE_FORMAT_COOKIE, dateFormatOwner, decodeDateFormatCookie } from "./date-format";
import { serverApi } from "./trpc-server";

export interface ServerDateFormat {
  prefs: DateFormatPrefs;
  /** Who the cookie belongs to ("" when nobody is signed in: nothing is written then). */
  owner: string;
  /** Where the choice came from: the cookie, the API, or neither (the defaults). */
  source: "cookie" | "api" | "default";
}

export const getServerDateFormat = cache(async (): Promise<ServerDateFormat> => {
  const server = await serverApi();
  const owner = dateFormatOwner(server?.auth);
  if (!server || !owner) return { prefs: DEFAULT_DATE_FORMAT_PREFS, owner: "", source: "default" };
  const fromCookie = decodeDateFormatCookie((await cookies()).get(DATE_FORMAT_COOKIE)?.value, owner);
  if (fromCookie) return { prefs: fromCookie, owner, source: "cookie" };
  try {
    return { prefs: normalizeDateFormatPrefs(await server.api.founder.preferences.get.query()), owner, source: "api" };
  } catch {
    return { prefs: DEFAULT_DATE_FORMAT_PREFS, owner, source: "default" };
  }
});
