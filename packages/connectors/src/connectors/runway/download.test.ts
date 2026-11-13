/**
 * `download_video`: the platform's copy of a finished clip into a post draft's media. Route-only, spends nothing, sends
 * no key to the clip's address, never past the size cap; the mock makes nothing and says so.
 */
import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { isUntrusted } from "../../quarantine";
import { isRouteOnlyTool, isServiceMediaTool, resolveGrants } from "../../grants";
import { makeToolContext } from "../../testing/contract-suite";
import { OUTPUT_URL, TASK_ID, TASK_RUNNING, TASK_SUCCEEDED } from "./fixtures/responses";
import { createRunwayConnector, fetchClip, runwayMock } from "./index";
import { DOWNLOAD_VIDEO_TOOL, DownloadVideoOut } from "./tools";

const KEY = "key_test_secret_0123456789abcdef";
const BASE = "https://api.dev.runwayml.com";
const CLIP_ORIGIN = new URL(OUTPUT_URL).origin;
const CLIP_PATH = new URL(OUTPUT_URL).pathname;
const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);

function connector(opts: { task?: unknown; clip?: () => Response } = {}, seen: { url: string; authorization: string | null }[] = []) {
  return createRunwayConnector({
    now: () => new Date("2026-11-13T12:00:00.000Z"),
    fetch: routedFetch({
      [`GET ${BASE}/v1/tasks/${TASK_ID}`]: (req) => (seen.push({ url: req.url, authorization: req.headers.get("authorization") }), jsonResponse(opts.task ?? TASK_SUCCEEDED)),
      [`GET ${CLIP_ORIGIN}${CLIP_PATH}`]: (req) => (seen.push({ url: req.url, authorization: req.headers.get("authorization") }), opts.clip?.() ?? new Response(bytes, { status: 200, headers: { "content-type": "video/mp4", "content-length": String(bytes.byteLength) } })),
    }),
  });
}
const live = (c: ReturnType<typeof createRunwayConnector>) => makeToolContext(c, { mode: "live", credential: { kind: "api_key", secret: KEY } });

describe("runway download_video", () => {
  it("is route-only, never an agent's, and its file goes to the platform caller whole", () => {
    expect(isRouteOnlyTool("runway", DOWNLOAD_VIDEO_TOOL)).toBe(true);
    expect(isServiceMediaTool("runway", DOWNLOAD_VIDEO_TOOL)).toBe(true);
    expect(isServiceMediaTool("elevenlabs_voice", "generate_voiceover")).toBe(true);
    expect(isServiceMediaTool("runway", "get_video_task")).toBe(false);
    // The social agent's grant gives it the three agent tools and never the copy.
    const grants = resolveGrants([{ connectorKey: "runway", tools: ["video.generate"] }]);
    expect(grants.toolRefs).toContain("runway:generate_video_from_text");
    expect(grants.toolRefs).not.toContain("runway:download_video");
    expect(resolveGrants([{ connectorKey: "runway", tools: ["*"] }]).toolRefs).not.toContain("runway:download_video");
    expect(runwayMock.policyHints[DOWNLOAD_VIDEO_TOOL]).toEqual({});
  });

  it("looks the task up again and copies the clip, sending the key to Runway and never to the clip's address", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    const c = connector({}, seen);
    const r = await c.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(c));
    expect(r.error).toBeUndefined();
    expect(isUntrusted(r.data)).toBe(false);
    const out = DownloadVideoOut.parse(r.data);
    expect(out).toMatchObject({ taskId: TASK_ID, status: "SUCCEEDED", ready: true, mime: "video/mp4", bytes: bytes.byteLength });
    expect(new Uint8Array(Buffer.from(out.base64!, "base64"))).toEqual(bytes);
    expect(seen.map((s) => s.authorization)).toEqual([`Bearer ${KEY}`, null]);
    expect(r.costMinor ?? 0).toBe(0);
  });

  it("answers not ready, with no bytes, while the task runs", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    const c = connector({ task: TASK_RUNNING }, seen);
    const out = DownloadVideoOut.parse((await c.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(c))).data);
    expect(out).toMatchObject({ ready: false, base64: null, bytes: 0, status: "RUNNING" });
    expect(seen).toHaveLength(1);
  });

  it("refuses a clip over the cap, by its header or by its body, and anything that is not a video", async () => {
    const big = () => new Response(bytes, { headers: { "content-type": "video/mp4", "content-length": String(64 * 1024 * 1024) } });
    const c = connector({ clip: big });
    expect((await c.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(c))).error).toMatchObject({ status: 413 });
    await expect(fetchClip(async () => new Response(new Uint8Array(20), { headers: { "content-type": "video/mp4" } }), OUTPUT_URL, 10)).rejects.toMatchObject({ httpStatus: 413 });
    const html = connector({ clip: () => new Response("<html>", { headers: { "content-type": "text/html" } }) });
    expect((await html.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(html))).error).toMatchObject({ status: 502 });
    await expect(fetchClip(async () => new Response(bytes), "https://127.0.0.1/clip.mp4")).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("the mock makes nothing: no bytes, never ready, and says so", async () => {
    const r = await runwayMock.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, makeToolContext(runwayMock));
    const out = DownloadVideoOut.parse(r.data);
    expect(out).toMatchObject({ ready: false, base64: null, bytes: 0, simulated: true });
    expect(out.notice).toMatch(/^Simulated: no video was made/);
  });
});
