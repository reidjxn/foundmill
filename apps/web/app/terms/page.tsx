/**
 * The Terms of Service (founder, 2026-11-13): public (lib/auth/redirects.ts `PUBLIC_PREFIXES`), from 390 px
 * (components/providers/DesktopOnly.tsx `SMALL_SCREEN_PREFIXES`), indexable, and prerendered: the text is
 * content/legal/terms.ts.
 */
import { APP_NAME } from "@foundmill/config";
import { LegalPage } from "@foundmill/dugout";
import { TERMS } from "@/content/legal/terms";
import { legalLinks, legalMetadata } from "@/content/legal/routes";

// The root layout's reads come back empty here, which is what any visitor of a legal page needs (as on `/`).
export const dynamic = "force-static";

export const metadata = legalMetadata("terms", TERMS, `The terms for using ${APP_NAME}: your account, what your team of agents does, what you own, credits and payment, and your rights.`);

export default function TermsPage() {
  return <LegalPage document={TERMS} links={legalLinks("terms")} />;
}
