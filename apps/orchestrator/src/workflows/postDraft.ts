/**
 * postDraft (docs/NETWORK.md F3, F7): the social agent drafts one post for the founder to share by tap. Started as
 * `post-draft:{businessId}:{trigger}` by whoever wrote the event that calls for it: apps/api after `page.published`
 * (the page went live), after `milestone.shown` and when the social channel is put on the Channel Board while the page
 * is live; apps/ingest after the `page.followed` that was the project's first. Nothing is polled.
 *
 * One activity. A trigger delivered twice finds its draft and writes nothing; a call that fails is retried a few times
 * and then left (no draft is not a failure anyone has to see). Nothing is launched, scheduled, published or measured.
 *
 * Once a draft is written, its optional media (a short video and a voiceover on the founder's own accounts,
 * ./postDraftMedia) is started as `post-media:{assetId}` and left to run on its own: it may wait days for the founder's
 * OK, and it does nothing at all unless Runway is connected. Histories recorded before it (`POST_DRAFT_MEDIA_PATCH`)
 * end after the draft, as they did.
 */
import { ParentClosePolicy, patched, proxyActivities, startChild } from "@temporalio/workflow";
import type { Activities, PostDraftInput, PostDraftResult } from "../activities";
import { postDraftMedia } from "./postDraftMedia";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "3 minutes", retry: { maximumAttempts: 3, initialInterval: "5 seconds", backoffCoefficient: 2 } });

export const POST_DRAFT_MEDIA_PATCH = "post-draft-media";

export async function postDraft(input: PostDraftInput): Promise<PostDraftResult> {
  const result = await acts.draftSharePost(input);
  if (result.outcome === "written" && patched(POST_DRAFT_MEDIA_PATCH)) {
    await startChild(postDraftMedia, { workflowId: `post-media:${result.assetId}`, args: [{ businessId: input.businessId, assetId: result.assetId }], parentClosePolicy: ParentClosePolicy.ABANDON });
  }
  return result;
}
