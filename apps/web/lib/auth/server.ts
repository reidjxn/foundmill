/**
 * Server-side auth facts for layouts, pages and route handlers: who is signed in and which bearer to send to the
 * API. The development bypass (cookie set by /auth/dev, honoured only when NEXT_PUBLIC_APP_ENV is development/test)
 * sends the literal "dev" token, which apps/api and apps/stream map to DEV_AUTH_USER_ID.
 */
import { cookies } from "next/headers";
import { cache } from "react";
import { DEV_AUTH_COOKIE, DEV_BEARER_TOKEN, LAST_BUSINESS_COOKIE } from "./constants";
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
    if (store.get(DEV_AUTH_COOKIE)?.value === "1") return { token: DEV_BEARER_TOKEN, userId: null, email: null, via: "dev" };
  }
  return null;
});

/** The business the founder last opened (set by the /b/[bid] layout). */
export async function getLastBusinessId(): Promise<string | null> {
  const store = await cookies();
  return parseLastBusinessId(store.get(LAST_BUSINESS_COOKIE)?.value);
}
