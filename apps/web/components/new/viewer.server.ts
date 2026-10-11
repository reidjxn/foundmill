/**
 * Server-side loader for the first-run screens (/onboarding, /new/*): the signed-in founder's profile from
 * `founder.profile.get`. Imported by Server Components only (no "use client").
 *
 * Returns one of three outcomes so each page decides its own redirect:
 *   - signed out → the caller redirects to /login?next=
 *   - API unreachable → the caller renders UnreachablePage
 *   - ok → the viewer (email, profile, businesses)
 */
import { serverApi } from "@/lib/trpc-server";
import { errorMessage, type RouterOutputs } from "@/lib/trpc";
import { formatNumber } from "@/lib/format";

export type FounderProfileGet = RouterOutputs["founder"]["profile"]["get"];

export interface StudioViewer {
  email: string | null;
  profile: FounderProfileGet["profile"];
  complete: boolean;
  businesses: FounderProfileGet["businesses"];
}

export type StudioViewerResult = { kind: "signed_out" } | { kind: "unreachable"; message: string } | { kind: "ok"; viewer: StudioViewer };

export async function loadStudioViewer(): Promise<StudioViewerResult> {
  const server = await serverApi();
  if (!server) return { kind: "signed_out" };
  try {
    const data = await server.api.founder.profile.get.query();
    return {
      kind: "ok",
      viewer: { email: data.email ?? server.auth.email, profile: data.profile, complete: data.complete, businesses: data.businesses },
    };
  } catch (err) {
    return { kind: "unreachable", message: errorMessage(err, "The API did not answer.") };
  }
}

/** The one-line profile summary shown under studio titles ("First-time founder · full time · EUR 25,000 · EU, UK"). */
export function profileLineOf(profile: StudioViewer["profile"]): string | null {
  if (!profile) return null;
  const parts: string[] = [];
  if (profile.experience) parts.push(humanise(profile.experience));
  if (profile.timeCommitment) parts.push(humanise(profile.timeCommitment).toLowerCase());
  if (typeof profile.budgetMinor === "number") parts.push(`${profile.currency} ${formatNumber(profile.budgetMinor / 100, { maximumFractionDigits: 0 })}`);
  if (profile.targetMarkets?.length) parts.push(profile.targetMarkets.slice(0, 3).join(", "));
  return parts.length ? parts.join(" · ") : null;
}

function humanise(key: string): string {
  const s = key.replace(/_/g, " ").replace(/-/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
