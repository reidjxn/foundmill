/**
 * Server-side loader for the first-run screens (/onboarding, /new/*): the signed-in founder's profile from
 * `founder.profile.get`. Imported by Server Components only (no "use client").
 *
 * Returns one of three outcomes so each page decides its own redirect:
 *   - signed out → the caller redirects to /login?next=
 *   - API unreachable, or the account is not on the invite list → the caller renders ApiErrorPage with the error
 *   - ok → the viewer (email, profile, businesses)
 */
import { serverApi } from "@/lib/trpc-server";
import { errorMessage, type RouterOutputs } from "@/lib/trpc";
import { EXPERIENCE_OPTIONS, TIME_OPTIONS, budgetWords } from "@/components/onboarding/profile-form";

export type FounderProfileGet = RouterOutputs["founder"]["profile"]["get"];

export interface StudioViewer {
  /** The account ID a co-founder adds this person by. */
  userId: string | null;
  email: string | null;
  profile: FounderProfileGet["profile"];
  complete: boolean;
  businesses: FounderProfileGet["businesses"];
}

export type StudioViewerResult = { kind: "signed_out" } | { kind: "unreachable"; message: string; error: unknown; email: string | null } | { kind: "ok"; viewer: StudioViewer };

export async function loadStudioViewer(): Promise<StudioViewerResult> {
  const server = await serverApi();
  if (!server) return { kind: "signed_out" };
  try {
    const data = await server.api.founder.profile.get.query();
    return {
      kind: "ok",
      viewer: { userId: data.userId ?? null, email: data.email ?? server.auth.email, profile: data.profile, complete: data.complete, businesses: data.businesses },
    };
  } catch (err) {
    return { kind: "unreachable", message: errorMessage(err, "The API did not answer."), error: err, email: server.auth.email };
  }
}

/**
 * The one-line profile summary shown under studio titles ("First-time founder · evenings and weekends · EUR 25,000 ·
 * EU, UK"). Experience and time read as the option labels the founder picked (`EXPERIENCE_OPTIONS`, `TIME_OPTIONS`),
 * never as a humanized key (A16); a key the lists do not know falls back to its words.
 */
export function profileLineOf(profile: StudioViewer["profile"]): string | null {
  if (!profile) return null;
  const parts: string[] = [];
  if (profile.experience) parts.push(EXPERIENCE_OPTIONS.find((o) => o.value === profile.experience)?.label ?? humanise(profile.experience));
  if (profile.timeCommitment) parts.push((TIME_OPTIONS.find((o) => o.value === profile.timeCommitment)?.label ?? humanise(profile.timeCommitment)).toLowerCase());
  if (typeof profile.budgetMinor === "number") parts.push(budgetWords(profile.budgetMinor, profile.currency));
  if (profile.targetMarkets?.length) parts.push(profile.targetMarkets.slice(0, 3).join(", "));
  return parts.length ? parts.join(" · ") : null;
}

/** Last resort for a stored key the option lists do not know: its words, capitalized. */
function humanise(key: string): string {
  const s = key.replace(/_/g, " ").replace(/-/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
