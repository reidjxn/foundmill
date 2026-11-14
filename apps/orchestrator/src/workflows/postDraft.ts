/**
 * postDraft (docs/NETWORK.md F3, F7): the social agent drafts one post for the founder to share by tap. Started as
 * `post-draft:{businessId}:{trigger}` by whoever wrote the event that calls for it: apps/api after `page.published`
 * (the page went live), after `milestone.shown` and when the social channel is put on the Channel Board while the page
 * is live; apps/ingest after the `page.followed` that was the project's first. Nothing is polled.
 *
 * One activity. A trigger delivered twice finds its draft and writes nothing; a call that fails is retried a few times
 * and then left (no draft is not a failure anyone has to see). Nothing is launched, scheduled, published or measured.
 */
import { proxyActivities } from "@temporalio/workflow";
import type { Activities, PostDraftInput, PostDraftResult } from "../activities";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "3 minutes", retry: { maximumAttempts: 3, initialInterval: "5 seconds", backoffCoefficient: 2 } });

export async function postDraft(input: PostDraftInput): Promise<PostDraftResult> {
  return acts.draftSharePost(input);
}
