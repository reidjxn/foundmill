/**
 * /new and its steps (Ideation, Compare, Commit, Import) are signed-in pages: they read dates in the person's own
 * format (Settings › Preferences) like the business shell does. The pages redirect signed-out visitors themselves.
 */
import type { ReactNode } from "react";
import { getServerDateFormat } from "@/lib/date-format.server";
import { DateFormatHost } from "@/components/providers/DateFormatHost";

export default async function NewBusinessLayout({ children }: { children: ReactNode }) {
  const date = await getServerDateFormat();
  return (
    <DateFormatHost initial={date.prefs} owner={date.owner}>
      {children}
    </DateFormatHost>
  );
}
