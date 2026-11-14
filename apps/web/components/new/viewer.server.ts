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
import { EXPERIENCE_OPTIONS, TIME_OPTIONS, budgetWords, placeAndMarketsWords } from "@/components/onboarding/profile-form";

export type FounderProfileGet = RouterOutputs["founder"]["profile"]["get"];

export interface StudioViewer {
  /** The person's account ID (for support: people join a project by invitation, not by it). */
  userId: string | null;
  email: string | null;
  profile: FounderProfileGet["profile"];
  /**
   * The person may go on past sign-up: the founder profile exists AND their "I am 18 or older" is on record (0100).
   * Every first-run page sends a person without both to /onboarding, which asks for whichever is missing.
   */
  complete: boolean;
  /** The account's "I am 18 or older" is on record (`founder.profile.get` `adultConfirmed`). */
  adultConfirmed: boolean;
  businesses: FounderProfileGet["businesses"];
  /** Whether the people layer (LIVE: finding people, requests, messages) is open on this deployment. */
  liveMode: boolean;
}

export type StudioViewerResult = { kind: "signed_out" } | { kind: "unreachable"; message: string; error: unknown; email: string | null } | { kind: "ok"; viewer: StudioViewer };

export async function loadStudioViewer(): Promise<StudioViewerResult> {
  const server = await serverApi();
  if (!server) return { kind: "signed_out" };
  try {
    const data = await server.api.founder.profile.get.query();
    return {
      kind: "ok",
      viewer: { userId: data.userId ?? null, email: data.email ?? server.auth.email, profile: data.profile, complete: data.complete && data.adultConfirmed, adultConfirmed: data.adultConfirmed, businesses: data.businesses, liveMode: data.features?.liveMode ?? false },
    };
  } catch (err) {
    return { kind: "unreachable", message: errorMessage(err, "The API did not answer."), error: err, email: server.auth.email };
  }
}

/**
 * The one-line profile summary shown under studio titles ("First-time founder · evenings and weekends · £5,000 ·
 * based in the United Kingdom · markets: UK, Ireland"), the same words as the form's own summary. Experience and time read as the option labels the founder picked (`EXPERIENCE_OPTIONS`, `TIME_OPTIONS`),
 * never as a humanized key (A16); a key the lists do not know falls back to its words.
 */
export function profileLineOf(profile: StudioViewer["profile"]): string | null {
  if (!profile) return null;
  const parts: string[] = [];
  if (profile.experience) parts.push(EXPERIENCE_OPTIONS.find((o) => o.value === profile.experience)?.label ?? humanise(profile.experience));
  if (profile.timeCommitment) parts.push((TIME_OPTIONS.find((o) => o.value === profile.timeCommitment)?.label ?? humanise(profile.timeCommitment)).toLowerCase());
  if (typeof profile.budgetMinor === "number") parts.push(budgetWords(profile.budgetMinor, profile.currency));
  // Where they live and where they sell, each named (a market never reads as the founder's home).
  parts.push(...placeAndMarketsWords(profile.residence, profile.targetMarkets ?? []));
  return parts.length ? parts.join(" · ") : null;
}

/** Last resort for a stored key the option lists do not know: its words, capitalized. */
function humanise(key: string): string {
  const s = key.replace(/_/g, " ").replace(/-/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
