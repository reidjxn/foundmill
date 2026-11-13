"use server";
/**
 * The end of attribution on the web (docs/NETWORK.md §5; lib/via.ts): once the save that created the person's profile
 * has succeeded, the browser calls this to clear the `fm_via` cookie. The cookie is httpOnly, so only the server can
 * remove it; the api has recorded the reference by then (or ignored it), and never reads it a second time.
 *
 * It clears the caller's own cookie and nothing else, so it needs no session. Next.js checks a Server Action's Origin
 * against the Host before it runs, so another site cannot wipe a visitor's reference with a form.
 */
import { VIA_COOKIE } from "@foundmill/shared/via";
import { cookies } from "next/headers";
import { isDevLike } from "@/lib/env";
import { viaCookie } from "@/lib/via";

export async function forgetVia(): Promise<void> {
  const store = await cookies();
  // The same attributes it was set with, expired at once.
  if (store.has(VIA_COOKIE)) store.set({ ...viaCookie("", !isDevLike()), maxAge: 0 });
}
