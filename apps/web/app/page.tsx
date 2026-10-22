/**
 * `/` for a signed-out visitor: the landing page (what Foundmill is, and a way in), prerendered and served from the CDN
 * (audit topology F4): it reads no cookie and asks the API nothing. proxy.ts never shows it to a signed-in founder: with
 * the last-business cookie it redirects to that business's Home, without it it serves app/start/page.tsx, which picks.
 * A deep link to another example business (`/?example=glitchwick|northwind`) is served from that business's own
 * prerendered page (app/examples/[id]/page.tsx); Tutorlane, the default, is in the page's own bundle.
 *
 * Regenerated hourly, and the day it was rendered on is handed to the page, so a page rendered on an earlier day still
 * hydrates without a mismatch (components/landing/parts.tsx `useToday`).
 */
import { LandingPage } from "@/components/landing/LandingPage";
import { calendarDay } from "@/components/landing/examples/helpers";

export const revalidate = 3600;
// The root layout reads the session and the text-size cookie (app/layout.tsx), which would render every visit on demand:
// forced static, those reads come back empty here, which is what a signed-out visitor has anyway (proxy.ts never serves
// this page to a signed-in founder).
export const dynamic = "force-static";

export default function IndexPage() {
  return <LandingPage renderDay={calendarDay(new Date(), "utc")} />;
}
