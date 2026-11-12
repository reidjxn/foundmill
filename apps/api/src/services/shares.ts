/**
 * Recording a share (docs/NETWORK.md F3 "Tap-to-post"; docs/DECISIONS.md 2026-11-12): a member pressed a share control
 * in the console, and `share.opened` goes through the outbox for the metrics consumer.
 *
 * What it is and is not: a share that was opened. The press opened a network's own window (or copied something, or
 * opened a message app or the device's sheet); whether anything was then posted is not known here, so nothing in this
 * file, its event or its answer says "posted" or "published", and it is not a real outcome for the north star.
 *
 * - Who: any member who can read the section the shared thing belongs to (`SHARE_SECTIONS`). An example membership
 *   and a sample business record nothing: a sample shows nothing in public.
 * - What is stored: the control (network, target), what kind of thing was shared and its id. Never the words.
 * - The id is checked, never trusted: a milestone must be one of this business's, the page id is read here (the client
 *   does not send it), and a drafted post carries none.
 * - Limited per person (`SHARE_OPENED_LIMIT`), so a held-down key cannot flood the outbox. Over the limit, and for
 *   anything that is not recorded, the answer is `{ recorded: false }` and never an error: the web calls this after the
 *   share itself and does not wait on it.
 */
import { repos } from "@foundmill/db";
import { ForbiddenError, MESSAGE_APPS, POST_NETWORKS, ValidationError, hasSectionAccess, type Section, type ShareDestination, type ShareOpenTarget, type ShareSubjectKind } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { writeEventRow } from "./events";
import type { WindowLimit } from "./rate-limit";

/** The section each kind of shared thing belongs to: Plan › Milestones reads Distribution's journey, the page is Product's, a drafted post is Distribution's. */
export const SHARE_SECTIONS: Readonly<Record<ShareSubjectKind, Section>> = { milestone: "distribution", page: "product", draft: "distribution" };

/** Thirty presses a minute for one person, across every business: far more than a person shares, far fewer than a held key sends. */
export const SHARE_OPENED_LIMIT = { limit: 30, windowMs: 60_000 } as const satisfies WindowLimit;

export const shareOpenedLimitKey = (userId: string): string => `share-opened:user:${userId}`;

export interface ShareOpenedInput {
  kind: ShareSubjectKind;
  /** The milestone's id for `milestone`; ignored for the others (the page's id is read here, a draft has none). */
  refId?: string | null;
  network: ShareDestination | null;
  target: ShareOpenTarget;
}

const isPostNetwork = (n: string | null): boolean => n !== null && (POST_NETWORKS as readonly string[]).includes(n);
const isMessageApp = (n: string | null): boolean => n !== null && (MESSAGE_APPS as readonly string[]).includes(n);

/** Whether a control with this target can be on this destination: a network's window is a network's, a message is a message app's, the device's sheet is nobody's. */
export function shareControlProblem(input: Pick<ShareOpenedInput, "network" | "target">): string | null {
  const { network, target } = input;
  if ((target === "tap" || target === "link_only") && !isPostNetwork(network)) return "A share window belongs to a network.";
  if (target === "message" && !isMessageApp(network)) return "A message goes through a messaging app.";
  if (target === "device" && network !== null) return "The device's own share sheet has no network.";
  if (target === "copy" && network !== null && !isPostNetwork(network)) return "A copy is for a network or for none.";
  return null;
}

export async function recordShareOpened(ctx: BusinessContext, input: ShareOpenedInput): Promise<{ recorded: boolean }> {
  if (!hasSectionAccess(ctx.membership, SHARE_SECTIONS[input.kind], "read")) throw new ForbiddenError("You cannot see this part of the project, so there is nothing of it to share.");
  const problem = shareControlProblem(input);
  if (problem) throw new ValidationError(problem);
  if (ctx.business.isDemo || (ctx.membership as { source?: string }).source === "example") return { recorded: false };
  const taken = await ctx.limits.take([{ key: shareOpenedLimitKey(ctx.userId), rule: SHARE_OPENED_LIMIT }]);
  if (!taken.ok) return { recorded: false };

  let refId: string | null = null;
  if (input.kind === "milestone") {
    const milestone = input.refId ? await ctx.rls((tx) => repos.journeys.getMilestone(tx, ctx.businessId, input.refId!)) : null;
    // Not one of this business's milestones: nothing to record (and nothing said about whose it is).
    if (!milestone) return { recorded: false };
    refId = milestone.id;
  } else if (input.kind === "page") {
    const page = await ctx.rls((tx) => repos.pages.get(tx, ctx.businessId));
    if (!page) return { recorded: false };
    refId = page.id;
  }
  await writeEventRow(ctx.db, { businessId: ctx.businessId, type: "share.opened", actor: { kind: "user", id: ctx.userId }, payload: { network: input.network, kind: input.kind, refId, target: input.target } });
  return { recorded: true };
}
