/**
 * The web's side of the way in (THESIS_REVIEW packages 2.2 and 3.1): where the invitation page and the "You're on the
 * list" panel send a person. No imports of server code: client pages use it too.
 */
import { NEXT_PARAM } from "@/lib/auth/constants";
import { appErrorCode, trpcErrorCode } from "@/lib/trpc";
import { DEFAULT_EXAMPLE_ID, examplePath } from "@/components/landing/examples/ids";
import { EXAMPLE_IDS } from "@/components/landing/examples/types";

/**
 * Where "You're on the list" leads on: an example project to look around while the person waits. Not `/`: a signed-in
 * `/` goes to /start, which the api refuses again; the prerendered example pages (`/examples/<id>`) are public at any
 * session.
 */
export const ON_WAITLIST_ONWARD_HREF = examplePath(EXAMPLE_IDS.find((id) => id !== DEFAULT_EXAMPLE_ID) ?? DEFAULT_EXAMPLE_ID);

/** The sign-in page, coming back to `path` (an invitation or an admission link) once the person is signed in. */
export const signInThenBackTo = (path: string): string => `/login?${NEXT_PARAM}=${encodeURIComponent(path)}`;

/**
 * What `/i/<token>` shows when reading the invitation failed: `busy` when the api's limit refused it (too many people
 * opened links at once: try again in a minute), else `unavailable` (the one answer for a link that does not work).
 */
export function invitationReadFailure(err: unknown): "busy" | "unavailable" {
  return appErrorCode(err) === "rate_limited" || trpcErrorCode(err) === "TOO_MANY_REQUESTS" ? "busy" : "unavailable";
}
