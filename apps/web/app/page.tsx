/**
 * `/` for a signed-out visitor: the first-timer's landing page (DESIGN §9a), prerendered and served from the CDN
 * (audit topology F4): it reads no cookie and asks the API nothing. proxy.ts never shows it to a signed-in founder: with
 * the last-business cookie it redirects to that business's Home, without it it serves app/start/page.tsx, which picks.
 * The earlier page, with its example businesses, is `/tour` (app/tour/page.tsx); a deep link to one of them
 * (`/?example=glitchwick|northwind`) is served from app/examples/[id]/page.tsx, which renders the tour.
 *
 * Regenerated hourly, and the day it was rendered on is handed to the page, so a page rendered on an earlier day still
 * hydrates without a mismatch (components/landing/parts.tsx `useToday`).
 */
import { LandingPage } from "@/components/landing/LandingPage";
import { landingSwitches } from "@/components/landing/flags";
import { homeMetadata } from "@/components/landing/seo";
import { calendarDay } from "@/components/landing/examples/helpers";

export const revalidate = 3600;
/** Title, description, canonical, share image, and indexing that follows open sign-up (components/landing/seo.tsx). */
export const metadata = homeMetadata(landingSwitches(process.env));
// The root layout reads the session and the text-size cookie (app/layout.tsx), which would render every visit on demand:
// forced static, those reads come back empty here, which is what a signed-out visitor has anyway (proxy.ts never serves
// this page to a signed-in founder).
export const dynamic = "force-static";

export default function IndexPage() {
  // The switches are read here, at build (and hourly regeneration) time, from the web deployment's own environment:
  // SIGNUP_OPEN, LIVE_MODE and PLATFORM_MAIL_DOMAIN, unset meaning off (components/landing/flags.ts).
  return <LandingPage switches={landingSwitches(process.env)} renderDay={calendarDay(new Date(), "utc")} />;
}
