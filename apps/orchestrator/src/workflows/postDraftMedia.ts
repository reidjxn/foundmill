/**
 * postDraftMedia (the "ready-to-post kit"; activities/post-media.ts): after the social agent drafted a post, a short
 * vertical video and a voiceover for it, on the founder's own Runway and ElevenLabs accounts. Started by `postDraft`
 * as `post-media:{assetId}` (abandoned by its parent, so a wait of days for the founder's OK does not hold the draft's
 * own workflow open).
 *
 * For each kind the plan names (nothing when Runway is not connected): start it; while the gateway asks the founder,
 * wait in `approval:<id>` (at most `APPROVAL_TIMEOUT_MS`, then the media is set aside and the post stays text only);
 * once they said yes, start it again (the same call runs once under that approval). A clip is then looked up every
 * `POLL_SECONDS` until it is finished and copied into the project's storage, or until `POLL_ATTEMPTS` lookups passed.
 * The video and the voiceover run side by side, and each is two separate files.
 */
import { executeChild, proxyActivities, sleep } from "@temporalio/workflow";
import type { Activities, PostMediaInput } from "../activities";
import { approvalWait } from "./approvalWait";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "3 minutes", retry: { maximumAttempts: 3, initialInterval: "10 seconds", backoffCoefficient: 2 } });

/** The same numbers as packages/agents `POST_VIDEO_POLL` and `POST_MEDIA_APPROVAL_TIMEOUT_MS` (workflow code imports no package). */
export const POLL_SECONDS = 10;
export const POLL_ATTEMPTS = 60;
export const APPROVAL_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

export interface PostDraftMediaResult {
  /** How each kind ended (`ready`, `simulated`, `declined`, `failed`), or why it never started. */
  outcomes: Record<string, string>;
}

async function one(input: PostMediaInput, kind: "video" | "voiceover"): Promise<string> {
  let step = await acts.startPostMedia({ ...input, kind });
  if (step.status === "asking") {
    const decision = await executeChild(approvalWait, { workflowId: `approval:${step.approvalId}`, args: [{ businessId: input.businessId, approvalId: step.approvalId, timeoutMs: APPROVAL_TIMEOUT_MS }] });
    if (decision.outcome !== "approved") {
      await acts.setAsidePostMedia({ businessId: input.businessId, mediaId: step.mediaId, outcome: decision.outcome });
      return "declined";
    }
    step = await acts.startPostMedia({ ...input, kind, args: step.args });
    // Asked once more after the founder's yes: the gateway would only ask again; the activity recorded why.
    if (step.status === "asking") return "failed";
  }
  if (step.status === "skipped") return step.reason;
  if (step.status === "done") return step.state;
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await sleep(POLL_SECONDS * 1000);
    const check = await acts.checkPostVideo({ businessId: input.businessId, mediaId: step.mediaId });
    if (check.status === "done") return check.state;
  }
  await acts.giveUpPostVideo({ businessId: input.businessId, mediaId: step.mediaId });
  return "failed";
}

export async function postDraftMedia(input: PostMediaInput): Promise<PostDraftMediaResult> {
  const plan = await acts.planPostMedia(input);
  const outcomes: Record<string, string> = {};
  await Promise.all(
    plan.kinds.map(async (kind) => {
      outcomes[kind] = await one(input, kind);
    }),
  );
  return { outcomes };
}
