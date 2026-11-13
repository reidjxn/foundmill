/**
 * The web's side of attribution (docs/NETWORK.md §5; @foundmill/shared/via): every public address accepts
 * `?via=<reference>`, and the first reference a visitor arrives with is kept in the `fm_via` cookie until they become a
 * person. Then the onboarding hands it to the api with the save that creates their profile (`founder.profile.update`),
 * which records it once, and the cookie is cleared (app/onboarding/actions.ts).
 *
 * proxy.ts sets the cookie: nothing is written to a database and no api is called on a visit. First touch wins: a
 * visitor who already carries a reference keeps it, whatever arrives later. The cookie is httpOnly, so the page's
 * scripts neither read nor replace it; the one screen that needs its value gets it from the server render.
 *
 * No imports beyond the shared module: proxy.ts runs this on every request.
 */
import { VIA_COOKIE, VIA_MAX_AGE_SECONDS, formatVia, parseVia } from "@foundmill/shared/via";

/**
 * The value to remember for this request, or null to leave everything as it is: the `via` parameter when it is a
 * reference and the visitor carries none yet. Anything that is not a reference is dropped without a trace.
 */
export function viaToRemember(input: { param: string | null | undefined; existing: string | null | undefined }): string | null {
  if (input.existing) return null;
  const ref = parseVia(input.param);
  return ref ? formatVia(ref) : null;
}

/** The cookie that remembers a reference. `secure` everywhere but development and test (plain http on localhost). */
export function viaCookie(value: string, secure: boolean) {
  return { name: VIA_COOKIE, value, httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: VIA_MAX_AGE_SECONDS };
}

/** What the onboarding hands to the api: the cookie's reference, or null when there is none (or it is not one). */
export function viaToHandOver(cookieValue: string | null | undefined): string | null {
  const ref = parseVia(cookieValue);
  return ref ? formatVia(ref) : null;
}
