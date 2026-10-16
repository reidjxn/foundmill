/**
 * /businesses (Your businesses) is a signed-in account page: it reads dates in the person's own format (Settings ›
 * Preferences) like /new and the business shell do. The page redirects signed-out visitors itself.
 */
import type { ReactNode } from "react";
import { getServerDateFormat } from "@/lib/date-format.server";
import { DateFormatHost } from "@/components/providers/DateFormatHost";

export default async function BusinessesLayout({ children }: { children: ReactNode }) {
  const date = await getServerDateFormat();
  return (
    <DateFormatHost initial={date.prefs} owner={date.owner}>
      {children}
    </DateFormatHost>
  );
}
