/** Deterministic IndexNow fixtures: a project site, its public key, and the answers api.indexnow.org gives (documented codes). */
import { indexNowKeyFileUrl } from "../tools";

export const IN_HOST = "northwindskincare.com";
/** A fixture key; real keys are public too (served at /<key>.txt). */
export const IN_KEY = "nw-indexnow-7f3a9c21";
export const IN_KEY_FILE = indexNowKeyFileUrl(IN_HOST, IN_KEY);
export const IN_NESTED_KEY_FILE = `https://${IN_HOST}/seo/${IN_KEY}.txt`;

export const IN_URLS = [`https://${IN_HOST}/`, `https://${IN_HOST}/blog/retinol-guide`, `https://${IN_HOST}/seo/faq`];

/** The key file as the site serves it (a trailing newline is common). */
export const IN_KEY_FILE_BODY = `${IN_KEY}\n`;

/** The documented answers; the body of a 200 or 202 is empty. */
export const IN_ANSWERS = { received: 200, pending: 202, badRequest: 400, keyNotValid: 403, urlNotOnHost: 422, tooMany: 429 } as const;
