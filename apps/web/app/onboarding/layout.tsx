/**
 * The founder profile (/onboarding) is a signed-in page: it reads dates in the person's own format (Settings ›
 * Preferences) like the business shell does. The page redirects signed-out visitors itself.
 */
import type { ReactNode } from "react";
import { getServerDateFormat } from "@/lib/date-format.server";
import { DateFormatHost } from "@/components/providers/DateFormatHost";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const date = await getServerDateFormat();
  return (
    <DateFormatHost initial={date.prefs} owner={date.owner}>
      {children}
    </DateFormatHost>
  );
}
