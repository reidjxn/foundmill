"use server";
/**
 * The waitlist join the not-invited and on-waitlist pages run on arrival (docs/IDEA_BOX.md): reads the idea box's cookie on the server (it is
 * httpOnly) and asks the api to keep the card with the waitlist entry, 90 days. It hands over the `fm_via` cookie too
 * (also httpOnly): when it is someone's waitlist link (`w.<code>`, WP-03 T10) the api records who brought this person;
 * the cookie stays for the onboarding, which reads it for its own attribution. Next.js checks a Server Action's Origin
 * against the Host before it runs.
 */
import { cookies } from "next/headers";
import { IDEA_COOKIE } from "@foundmill/shared";
import { VIA_COOKIE } from "@foundmill/shared/via";
import { serverApi } from "@/lib/trpc-server";
import { viaToHandOver } from "@/lib/via";

export type WaitlistJoinState = { status: "idle" } | { status: "joined"; cardKept: boolean; shareUrl?: string | null } | { status: "error" };

/** `then`: "studio" when the visitor chose "Shape it in the Ideation Studio"; the api keeps it with the card (0124). */
export async function joinWaitlist(_previous: WaitlistJoinState, then: "studio" | null = null): Promise<WaitlistJoinState> {
  const server = await serverApi();
  if (!server) return { status: "error" };
  try {
    const jar = await cookies();
    const token = jar.get(IDEA_COOKIE)?.value ?? null;
    const via = viaToHandOver(jar.get(VIA_COOKIE)?.value);
    const res = await server.api.waitlist.join.mutate({ token: token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null, via, ...(then === "studio" ? { then } : {}) });
    return { status: "joined", cardKept: res.cardKept, shareUrl: res.shareUrl };
  } catch {
    return { status: "error" };
  }
}
