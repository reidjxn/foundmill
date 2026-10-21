/**
 * Server-side auth facts for layouts, pages and route handlers: who is signed in and which bearer to send to the
 * API. The development bypass (cookie set by /auth/dev, honoured only when NEXT_PUBLIC_APP_ENV is development/test)
 * sends the literal "dev" token, which apps/api and apps/stream map to DEV_AUTH_USER_ID, or `dev:<uuid>` after
 * /auth/dev?as=<uuid> (lib/auth/dev-as.ts), which they map to that account.
 */
import { cookies } from "next/headers";
import { cache } from "react";
import { DEV_AS_COOKIE, DEV_AUTH_COOKIE, LAST_BUSINESS_COOKIE } from "./constants";
import { devBearerFor, parseDevAsUserId } from "./dev-as";
import { parseLastBusinessId } from "./last-business";
import { isDevLike } from "@/lib/env";
import { getServerSession } from "@/lib/supabase/server";

export interface ServerAuth {
  /** Bearer for apps/api and apps/stream. */
  token: string;
  userId: string | null;
  email: string | null;
  via: "supabase" | "dev";
}

/**
 * Who is signed in for this request. Wrapped in React `cache()` so a layout and the page read and verify the session
 * once per request (the cache never outlives the request); the check itself is local (lib/supabase/server.ts).
 */
export const getServerAuth = cache(async (): Promise<ServerAuth | null> => {
  const session = await getServerSession();
  if (session) return { token: session.accessToken, userId: session.userId, email: session.email, via: "supabase" };
  if (isDevLike()) {
    const store = await cookies();
    if (store.get(DEV_AUTH_COOKIE)?.value === "1") {
      // `/auth/dev?as=<uuid>` signs in as another account: the bearer names it (`dev:<uuid>`).
      const as = parseDevAsUserId(store.get(DEV_AS_COOKIE)?.value);
      return { token: devBearerFor(as), userId: as, email: null, via: "dev" };
    }
  }
  return null;
});

/** The business the founder last opened (set by the /b/[bid] layout). */
export async function getLastBusinessId(): Promise<string | null> {
  const store = await cookies();
  return parseLastBusinessId(store.get(LAST_BUSINESS_COOKIE)?.value);
}
