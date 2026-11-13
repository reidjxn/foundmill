"use server";
/**
 * "Join the waitlist" on the not-invited page (docs/IDEA_BOX.md): reads the idea box's cookie on the server (it is
 * httpOnly) and asks the api to keep the card with the waitlist entry, 90 days. Next.js checks a Server Action's Origin
 * against the Host before it runs.
 */
import { cookies } from "next/headers";
import { IDEA_COOKIE } from "@foundmill/shared";
import { serverApi } from "@/lib/trpc-server";

export type WaitlistJoinState = { status: "idle" } | { status: "joined"; cardKept: boolean } | { status: "error" };

export async function joinWaitlist(_previous: WaitlistJoinState): Promise<WaitlistJoinState> {
  const server = await serverApi();
  if (!server) return { status: "error" };
  try {
    const token = (await cookies()).get(IDEA_COOKIE)?.value ?? null;
    const res = await server.api.waitlist.join.mutate({ token: token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null });
    return { status: "joined", cardKept: res.cardKept };
  } catch {
    return { status: "error" };
  }
}
