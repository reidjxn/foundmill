/**
 * The web's side of the way in (THESIS_REVIEW packages 2.2 and 3.1): where the invitation page and the "You're on the
 * list" panel send a person. No imports of server code: client pages use it too.
 */
import { NEXT_PARAM } from "@/lib/auth/constants";
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
