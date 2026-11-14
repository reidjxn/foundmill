/**
 * What a shared team post led to, the api's part (item 8, approved by the network session Nov 13, 2026; packages/db
 * `post_links`, `post_attributions`; packages/shared `post-outcomes.ts`).
 *
 * - `recordPostVisit` (`publicPage.visited`, signed out): the public page's beacon, sent after the page has loaded in a
 *   browser (crawlers run no scripts), with the `via` the address carried. Only a post's code (`s.<code>`) does
 *   anything: the link's first visit stamps `first_visited_at` and writes `visit.attributed` (ids only, never narrated,
 *   never counted). A member of the project opening their own post's link is left out. Limited like the public story
 *   reads (`PUBLIC_STORY_LIMITS`). The answer is always the same, so it tells nobody whether a code exists, and visits
 *   stay private: nothing anywhere shows a count of them.
 * - The link a follow keeps (`publicPage.follow` with the `fm_post` cookie's code, services/pages.ts `followPage`): the
 *   project's own, not simulated, visited; else none (`repos.postLinks.followable`).
 * - `postOutcomeCounts`: what each team post led to, as the reader may see it (follows and replies behind the CRM,
 *   payments behind Finance), for the line under it on the Creative tab.
 */
import { repos, type Executor } from "@foundmill/db";
import { hasSectionAccess, type Env, type SectionMembership } from "@foundmill/shared";
import { wallPostOutcomes, type PostOutcomeCounts } from "@foundmill/shared/post-outcomes";
import { parseVia } from "@foundmill/shared/via";
import type { Context } from "../context";
import { writeEventRow } from "./events";
import { PUBLIC_STORY_LIMITS } from "./milestones";
import { callerLimitKey } from "./pages";
import { takeOrThrow, type WindowLimit } from "./rate-limit";

/**
 * The visit beacon's limits (security review, Nov 14, 2026), in the order they are taken:
 * - `perCaller`: 30 a minute by the address the api sees. One page load sends one beacon, so this is plenty for a
 *   person and keeps a handful of addresses from filling the shared ceiling.
 * - `perKey` (one code) and `all` (every business together): the public story reads' ceilings.
 * - `unknown`: a code that names no link gives its `all` hit back and is counted here instead, so made-up codes never
 *   starve the first visits of real ones. The answer is the same either way: this bucket never refuses anyone, since a
 *   refusal only made-up codes could earn would tell a stranger which codes exist.
 */
export const POST_VISIT_LIMITS = {
  perCaller: { limit: 30, windowMs: 60_000 },
  perKey: PUBLIC_STORY_LIMITS.perKey,
  all: PUBLIC_STORY_LIMITS.all,
  unknown: PUBLIC_STORY_LIMITS.unknown,
} as const satisfies Record<string, WindowLimit>;

export const postVisitLimitKeys = {
  caller: (env: Pick<Env, "SESSION_TOKEN_SECRET">, address: string) =>
    callerLimitKey(env, "post-visit", address),
  code: (code: string) => `post-visit:code:${code}`,
  all: "post-visit:all",
  unknown: "post-visit:unknown",
} as const;

type VisitContext = Pick<Context, "db" | "env" | "limits" | "log"> & {
  clientAddress?: string | null;
  userId?: string | null;
  now?: () => Date;
};

/** The beacon's answer: always the same. */
export type PostVisitAnswer = { ok: true };

/**
 * A browser opened a page with `?via=<via>`. Records the first visit of a shared post's link (see the file comment);
 * anything else, a member's own visit and a repeat change nothing. Never says which.
 */
export async function recordPostVisit(
  ctx: VisitContext,
  input: { via: string },
): Promise<PostVisitAnswer> {
  const ok: PostVisitAnswer = { ok: true };
  const ref = parseVia(input.via);
  if (!ref || ref.kind !== "post") return ok;
  if (ctx.clientAddress)
    await takeOrThrow(ctx.limits, "Page visit", [
      {
        key: postVisitLimitKeys.caller(ctx.env, ctx.clientAddress),
        rule: POST_VISIT_LIMITS.perCaller,
      },
    ]);
  await takeOrThrow(ctx.limits, "Page visit", [{ key: postVisitLimitKeys.code(ref.ref), rule: POST_VISIT_LIMITS.perKey }]);
  const shared = await takeOrThrow(ctx.limits, "Page visit", [{ key: postVisitLimitKeys.all, rule: POST_VISIT_LIMITS.all }]);
  const link = await repos.postLinks.byCode(ctx.db, ref.ref);
  if (!link) {
    // Not a code anyone minted: the shared hit goes back and the unknown bucket counts it, without a refusal.
    await ctx.limits.refund(shared);
    await ctx.limits.take([{ key: postVisitLimitKeys.unknown, rule: POST_VISIT_LIMITS.unknown }]);
    return ok;
  }
  if (link.simulated || link.firstVisitedAt) return ok;
  // A founder (or anyone in the project) opening their own post's link is not a visit the post brought.
  if (ctx.userId && (await repos.memberships.get(ctx.db, link.businessId, ctx.userId))) return ok;
  const at = (ctx.now ?? (() => new Date()))();
  try {
    await ctx.db.transaction(async (tx) => {
      const first = await repos.postLinks.visit(tx, ref.ref, at);
      if (!first) return;
      await writeEventRow(
        tx,
        {
          businessId: first.businessId,
          type: "visit.attributed",
          actor: { kind: "system", id: "public-page" },
          payload: { linkId: first.id, assetId: first.assetId, network: first.network },
          occurredAt: at.toISOString(),
        },
        `visit.attributed:${first.id}`,
      );
    });
  } catch (err) {
    // Never the code: it was in an address a stranger may have typed.
    ctx.log.warn({ err: err instanceof Error ? err.name : "unknown" }, "post visit not recorded");
  }
  return ok;
}

/** What each of `assetIds` led to, walled for the reader. A post that led to nothing the reader may see is absent. */
export async function postOutcomeCounts(
  tx: Executor,
  scope: { businessId: string; membership: SectionMembership },
  assetIds: readonly string[],
): Promise<Map<string, PostOutcomeCounts>> {
  const all = await repos.postAttributions.countsByAsset(tx, scope.businessId, assetIds);
  const out = new Map<string, PostOutcomeCounts>();
  for (const [assetId, counts] of all) {
    const seen = wallPostOutcomes(counts, (section) =>
      hasSectionAccess(scope.membership, section, "read"),
    );
    if (seen.follow + seen.reply + seen.payment > 0) out.set(assetId, seen);
  }
  return out;
}
