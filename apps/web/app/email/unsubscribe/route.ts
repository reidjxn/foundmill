/**
 * One-click unsubscribe for founder emails (RFC 8058; security review 2026-11-11): the `List-Unsubscribe` header points
 * here with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so a mail app's "Unsubscribe" POSTs and every email is
 * paused through `email.pause` (the signed token is the credential). A GET (someone opening the address) changes nothing
 * and goes to the page with its button.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createApiClient } from "@/lib/trpc";

export async function POST(request: NextRequest): Promise<Response> {
  const token = request.nextUrl.searchParams.get("t");
  if (!token) return new NextResponse(null, { status: 400 });
  const api = createApiClient({ getToken: () => null, fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) });
  const result = await api.email.pause.mutate({ token }).catch(() => null);
  return new NextResponse(null, { status: result?.paused ? 200 : 400 });
}

export function GET(request: NextRequest): Response {
  const url = new URL("/email/pause", request.nextUrl.origin);
  const token = request.nextUrl.searchParams.get("t");
  if (token) url.searchParams.set("t", token);
  return NextResponse.redirect(url, 303);
}
