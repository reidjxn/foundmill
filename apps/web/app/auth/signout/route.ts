/**
 * Sign out (POST only: a GET that signed out would let any site log the founder out with a link, so there is no GET).
 * Ends this browser's Supabase session (`scope: "local"`: the founder's other devices stay signed in; cookies cleared by
 * @supabase/ssr) and drops the dev cookie, the last business and the copies of the person's date format and text size
 * (the signed-out pages read US dates in standard text).
 */
import { NextResponse } from "next/server";
import { DEV_AUTH_COOKIE, LAST_BUSINESS_COOKIE } from "@/lib/auth/constants";
import { DATE_FORMAT_COOKIE } from "@/lib/date-format";
import { TEXT_SIZE_COOKIE } from "@/components/providers/text-size-cookie";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_ACTION_TIMEOUT_MS } from "@/lib/supabase/timeouts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient({ requestTimeoutMs: SUPABASE_ACTION_TIMEOUT_MS });
  if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  response.cookies.set({ name: DEV_AUTH_COOKIE, value: "", path: "/", maxAge: 0 });
  response.cookies.set({ name: LAST_BUSINESS_COOKIE, value: "", path: "/", maxAge: 0 });
  response.cookies.set({ name: DATE_FORMAT_COOKIE, value: "", path: "/", maxAge: 0 });
  response.cookies.set({ name: TEXT_SIZE_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}
