/**
 * Post media eval (evals/src/post-media.ts): the social agent never claims a video exists when none was made. Offline by
 * construction, so it runs here and in `pnpm evals` alike.
 */
import { postMediaLine } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { POST_MEDIA_CLAIM_CASES, POST_MEDIA_OUTCOMES, VIDEO_EXISTS_RE, postMediaOutcomeProblems, runPostMediaClaimCase } from "../post-media";

describe("post media eval", () => {
  it("(a) a post that claims a video is refused, and the retry stores words only", async () => {
    for (const c of POST_MEDIA_CLAIM_CASES) {
      const r = await runPostMediaClaimCase(c);
      expect(r.problems, c.id).toEqual([]);
      expect(r.refusals, c.id).toEqual(["media_claim"]);
      expect(r.text, c.id).toBe(c.clean);
    }
  });

  it("(b) no outcome but a ready, real video is ever called a video that exists; simulated says so", () => {
    for (const o of POST_MEDIA_OUTCOMES) expect(postMediaOutcomeProblems(o), o.id).toEqual([]);
  });

  it("the rubric does catch a line that says a video exists", () => {
    expect(VIDEO_EXISTS_RE.test(postMediaLine({ kind: "video", state: "ready", mediaId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", simulated: false, durationSeconds: 5, url: "/api/post-media/abcdefghijklmnopqrstuvwxyz" }))).toBe(true);
    expect(VIDEO_EXISTS_RE.test("Watch the video to see the bake.")).toBe(true);
  });
});
