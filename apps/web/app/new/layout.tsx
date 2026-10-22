/**
 * /new and its steps (Ideation, Compare, Commit, Import) are signed-in pages: they read dates in the person's own
 * format (Settings › Preferences) and the guided layer in the person's own choice (GuidanceHost) like the business shell
 * does. The pages redirect signed-out visitors themselves.
 */
import type { ReactNode } from "react";
import { getServerDateFormat } from "@/lib/date-format.server";
import { getServerGuidance } from "@/lib/guidance.server";
import { DateFormatHost } from "@/components/providers/DateFormatHost";
import { GuidanceHost } from "@/components/providers/GuidanceHost";

export default async function NewBusinessLayout({ children }: { children: ReactNode }) {
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
