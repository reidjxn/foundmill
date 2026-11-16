/**
 * The facts the Terms of Service and the Privacy Policy state about the company behind Foundmill (founder, 2026-11-13).
 *
 * The company's name appears on the two legal pages and nowhere else a visitor can read (founder, 2026-11-13): this
 * directory is the only place in the apps and packages that holds it, and `legal-name.test.ts` keeps it that way. Show
 * the product by APP_NAME everywhere else.
 *
 * The registered address is not held here: it lives in @foundmill/config (`APP_POSTAL_ADDRESS`), because every email the
 * product sends of its own carries it too (US CAN-SPAM), and the gateway cannot read this directory. One source.
 */
import { APP_POSTAL_ADDRESS } from "@foundmill/config";

export const LEGAL_ENTITY = {
  name: "Collingham AB",
  orgNumber: "559360-6907",
  country: "Sweden",
  /** The registered postal address, one line (founder, 2026-11-13): `APP_POSTAL_ADDRESS`, the one source. */
  postalAddress: APP_POSTAL_ADDRESS as string | null,
} as const;

/** Where people write about privacy, their data and these documents. */
export const LEGAL_CONTACT_EMAIL = "privacy@foundmill.com";

/** Where copyright notices and counter-notices go (the Terms' "Copyright complaints", 17 U.S.C. § 512). */
export const COPYRIGHT_EMAIL = "copyright@foundmill.com";

/**
 * The designated agent for copyright notices under the US DMCA (17 U.S.C. § 512(c)(2); founder, 2026-11-13). The
 * founder registers the agent with the US Copyright Office (copyright.gov/dmca-directory) and then fills this in exactly
 * as registered: `registered: true`, the registration number, and the name or role, address, email and phone given to
 * the Office. Until then the Terms show the intake email and the company's postal address, and say nothing about a
 * registration. Never put a person's name here that was not registered.
 */
export interface CopyrightAgent {
  registered: boolean;
  /** The directory's registration number (such as "DMCA-1234567"); null until registered. */
  registrationNumber: string | null;
  /** The agent's name or role as registered, such as "Copyright Agent". */
  name: string;
  /** One line; null uses LEGAL_ENTITY.postalAddress. */
  postalAddress: string | null;
  email: string;
  phone: string | null;
}

export const COPYRIGHT_AGENT: CopyrightAgent = {
  registered: false,
  registrationNumber: null,
  name: "Copyright Agent",
  postalAddress: null,
  email: COPYRIGHT_EMAIL,
  phone: null,
};

/** The date both documents were last changed (US dates, CLAUDE.md). Change it with the text. */
export const TERMS_UPDATED = "Nov 16, 2026";
export const PRIVACY_UPDATED = "Nov 13, 2026";

/** The two documents, for the bar and the footer of each and for the links on the landing and sign-in pages. */
export const LEGAL_ROUTES = { terms: "/terms", privacy: "/privacy" } as const;

/** "Collingham AB, a company registered in Sweden (organization number 559360-6907)", with the address when known. */
export function entityLine(): string {
  const base = `${LEGAL_ENTITY.name}, a company registered in ${LEGAL_ENTITY.country} (organization number ${LEGAL_ENTITY.orgNumber})`;
  return LEGAL_ENTITY.postalAddress ? `${base}, ${LEGAL_ENTITY.postalAddress}` : base;
}
