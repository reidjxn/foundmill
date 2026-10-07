/**
 * Development bypass (docs/DECISIONS.md "Development auth bypass"): sets the dev cookie so the proxy treats the
 * visitor as signed in and the API/stream clients send the literal "dev" bearer. 404 outside development/test.
 */
import { NextResponse } from "next/server";
import { COOKIE_MAX_AGE_SECONDS, DEV_AUTH_COOKIE, NEXT_PARAM } from "@/lib/auth/constants";
import { safeNextPath } from "@/lib/auth/redirects";
import { isDevLike } from "@/lib/env";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  if (!isDevLike()) return new NextResponse("Not found", { status: 404 });
  const requested = request.method === "POST" ? (await request.formData().catch(() => null))?.get(NEXT_PARAM)?.toString() : new URL(request.url).searchParams.get(NEXT_PARAM);
  const next = safeNextPath(requested);
  const response = NextResponse.redirect(new URL(next, request.url), { status: 303 });
  response.cookies.set({ name: DEV_AUTH_COOKIE, value: "1", path: "/", httpOnly: true, sameSite: "lax", maxAge: COOKIE_MAX_AGE_SECONDS });
  return response;
}

export const GET = handle;
export const POST = handle;
