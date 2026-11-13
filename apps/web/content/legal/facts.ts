/**
 * The facts the Terms of Service and the Privacy Policy state about the company behind Foundmill (founder, 2026-11-13).
 *
 * The company's name appears on the two legal pages and nowhere else a visitor can read (founder, 2026-11-13): this
 * directory is the only place in the apps and packages that holds it, and `legal-name.test.ts` keeps it that way. Show
 * the product by APP_NAME everywhere else.
 */
export const LEGAL_ENTITY = {
  name: "Collingham AB",
  orgNumber: "559360-6907",
  country: "Sweden",
  /** The registered postal address, one line (founder, 2026-11-13). */
  postalAddress: "Valhallavägen 38, 11422 Stockholm, Sweden" as string | null,
} as const;

/** Where people write about privacy, their data and these documents. */
export const LEGAL_CONTACT_EMAIL = "privacy@foundmill.com";

/** The date both documents were last changed (US dates, CLAUDE.md). Change it with the text. */
export const TERMS_UPDATED = "Nov 13, 2026";
export const PRIVACY_UPDATED = "Nov 13, 2026";

/** The two documents, for the bar and the footer of each and for the links on the landing and sign-in pages. */
export const LEGAL_ROUTES = { terms: "/terms", privacy: "/privacy" } as const;

/** "Collingham AB, a company registered in Sweden (organization number 559360-6907)", with the address when known. */
export function entityLine(): string {
  const base = `${LEGAL_ENTITY.name}, a company registered in ${LEGAL_ENTITY.country} (organization number ${LEGAL_ENTITY.orgNumber})`;
  return LEGAL_ENTITY.postalAddress ? `${base}, ${LEGAL_ENTITY.postalAddress}` : base;
}
