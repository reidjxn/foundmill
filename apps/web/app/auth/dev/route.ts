/**
 * Development bypass (docs/DECISIONS.md "Development auth bypass"): sets the dev cookie so the proxy treats the
 * visitor as signed in and the API/stream clients send the literal "dev" bearer. 404 outside development/test.
 *
 * `?as=<uuid>` (or an `as` form field) signs in as that auth user instead of DEV_AUTH_USER_ID: the id goes in its own
 * cookie (`DEV_AS_COOKIE`, lib/auth/dev-as.ts) and the bearer becomes `dev:<uuid>`, which apps/api and apps/stream
 * honor in development and test only. Without it the cookie is cleared, so plain /auth/dev is the dev user again. An
 * `as` that is not a UUID is refused (400) rather than read as the dev user.
 */
import { NextResponse } from "next/server";
import { COOKIE_MAX_AGE_SECONDS, DEV_AS_COOKIE, DEV_AS_PARAM, DEV_AUTH_COOKIE, NEXT_PARAM } from "@/lib/auth/constants";
import { parseDevAsUserId } from "@/lib/auth/dev-as";
import { safeNextPath } from "@/lib/auth/redirects";
import { isDevLike } from "@/lib/env";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  if (!isDevLike()) return new NextResponse("Not found", { status: 404 });
  const form = request.method === "POST" ? await request.formData().catch(() => null) : null;
  const param = (name: string): string | null => (form ? (form.get(name)?.toString() ?? null) : new URL(request.url).searchParams.get(name));
  const requestedAs = param(DEV_AS_PARAM);
  const as = requestedAs === null || requestedAs === "" ? null : parseDevAsUserId(requestedAs);
  if (requestedAs && !as) return new NextResponse("as must be an account id (a UUID)", { status: 400 });
  const next = safeNextPath(param(NEXT_PARAM));
  const response = NextResponse.redirect(new URL(next, request.url), { status: 303 });
  response.cookies.set({ name: DEV_AUTH_COOKIE, value: "1", path: "/", httpOnly: true, sameSite: "lax", maxAge: COOKIE_MAX_AGE_SECONDS });
  // Readable by the page's script: the browser builds its `dev:<uuid>` bearer from it (lib/auth/dev-as.ts).
  if (as) response.cookies.set({ name: DEV_AS_COOKIE, value: as, path: "/", httpOnly: false, sameSite: "lax", maxAge: COOKIE_MAX_AGE_SECONDS });
  else response.cookies.set({ name: DEV_AS_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}

export const GET = handle;
export const POST = handle;
