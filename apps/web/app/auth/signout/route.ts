/**
 * Sign out: ends the Supabase session (cookies cleared by @supabase/ssr) and drops the dev cookie, the last business and
 * the copy of the person's date format (the signed-out pages read US dates).
 */
import { NextResponse } from "next/server";
import { DEV_AUTH_COOKIE, LAST_BUSINESS_COOKIE } from "@/lib/auth/constants";
import { DATE_FORMAT_COOKIE } from "@/lib/date-format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut().catch(() => undefined);
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  response.cookies.set({ name: DEV_AUTH_COOKIE, value: "", path: "/", maxAge: 0 });
  response.cookies.set({ name: LAST_BUSINESS_COOKIE, value: "", path: "/", maxAge: 0 });
  response.cookies.set({ name: DATE_FORMAT_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}

export const GET = handle;
export const POST = handle;
