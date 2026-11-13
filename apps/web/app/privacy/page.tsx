/**
 * The Privacy Policy (founder, 2026-11-13): public (lib/auth/redirects.ts `PUBLIC_PREFIXES`), from 390 px
 * (components/providers/DesktopOnly.tsx `SMALL_SCREEN_PREFIXES`), indexable, and prerendered: the text is
 * content/legal/privacy.ts.
 */
import { APP_NAME } from "@foundmill/config";
import { LegalPage } from "@foundmill/dugout";
import { PRIVACY } from "@/content/legal/privacy";
import { legalLinks, legalMetadata } from "@/content/legal/routes";

// The root layout's reads come back empty here, which is what any visitor of a legal page needs (as on `/`).
export const dynamic = "force-static";

export const metadata = legalMetadata("privacy", PRIVACY, `How ${APP_NAME} collects, uses, shares and protects personal data, for people in the United States and the European Union, and how to use your rights.`);

export default function PrivacyPage() {
  return <LegalPage document={PRIVACY} links={legalLinks("privacy")} />;
}
