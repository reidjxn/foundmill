"use server";
/**
 * "Keep this card" and "Not mine" on /new/card/keep (docs/IDEA_BOX.md; security review 2026-11-13, P2-1 and P3-3). The
 * card is kept only when the person presses the button, never by landing on a page, and the browser's `fm_idea` cookie
 * is cleared either way, so the next person to sign in on a shared computer meets nothing. Next.js checks a Server
 * Action's Origin against the Host before it runs.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IDEA_CLAIM_PARAM, IDEA_COOKIE } from "@foundmill/shared";
import { serverApi } from "@/lib/trpc-server";

/** The cookie's Domain as the api set it (`IDEA_COOKIE_DOMAIN`, foundmill.com in production); unset: host-only. */
async function clearIdeaCookie(): Promise<void> {
  const store = await cookies();
  const domain = process.env.IDEA_COOKIE_DOMAIN?.trim();
  store.set({ name: IDEA_COOKIE, value: "", path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", ...(domain ? { domain } : {}) });
}

/**
 * Keeps the card, then its own page (and on to Commit), or with `studio` (the idea box's "Shape it in the Ideation
 * Studio") the Studio, where the kept card leads the deck. The page binds `studio` from its own `?then=`.
 */
export async function keepCard(studio: boolean, form: FormData): Promise<void> {
  const server = await serverApi();
  if (!server) redirect("/login?next=%2Fstart");
  const claim = form.get(IDEA_CLAIM_PARAM);
  const token = (await cookies()).get(IDEA_COOKIE)?.value ?? null;
  const res = await server.api.ideaBox.claim.mutate({ token, claim: typeof claim === "string" && claim ? claim : null }).catch(() => null);
  await clearIdeaCookie();
  if (!res) redirect("/start");
  redirect(studio ? "/new/ideate" : `/new/card/${res.ideaId}`);
}

export async function notMine(): Promise<void> {
  await clearIdeaCookie();
  redirect("/start");
}
