/**
 * The founder profile (/onboarding) is a signed-in page: it reads dates in the person's own format (Settings ›
 * Preferences) and the guided layer in the person's own choice (GuidanceHost) like the business shell does. The page
 * redirects signed-out visitors itself.
 */
import type { ReactNode } from "react";
import { getServerDateFormat } from "@/lib/date-format.server";
import { getServerGuidance } from "@/lib/guidance.server";
import { DateFormatHost } from "@/components/providers/DateFormatHost";
import { GuidanceHost } from "@/components/providers/GuidanceHost";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  // The guidance preferences come with the page, as in the business shell, so the host asks nothing after hydration.
  const [date, guided] = await Promise.all([getServerDateFormat(), getServerGuidance()]);
  return (
    <GuidanceHost initial={guided.prefs} signedIn={guided.signedIn} textSizeOwner={date.owner}>
      <DateFormatHost initial={date.prefs} owner={date.owner}>
        {children}
      </DateFormatHost>
    </GuidanceHost>
  );
}
