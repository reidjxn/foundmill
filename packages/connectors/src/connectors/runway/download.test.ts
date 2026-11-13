/**
 * `download_video`: the platform's copy of a finished clip into a post draft's media. Route-only, spends nothing, sends
 * no key to the clip's address, never past the size cap; the mock makes nothing and says so.
 */
import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch, type FetchLike } from "../../http";
import type { HostLookup } from "../web/reader";
import { isUntrusted } from "../../quarantine";
import { isRouteOnlyTool, isServiceMediaTool, resolveGrants } from "../../grants";
import { makeToolContext } from "../../testing/contract-suite";
import { OUTPUT_URL, TASK_ID, TASK_RUNNING, TASK_SUCCEEDED } from "./fixtures/responses";
import { createRunwayConnector, fetchClip, runwayMock } from "./index";
import { DOWNLOAD_VIDEO_TOOL, DownloadVideoOut, RUNWAY_OUTPUT_HOSTS } from "./tools";

const KEY = "key_test_secret_0123456789abcdef";
const BASE = "https://api.dev.runwayml.com";
const CLIP_ORIGIN = new URL(OUTPUT_URL).origin;
const CLIP_PATH = new URL(OUTPUT_URL).pathname;
const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);

type Seen = { url: string; authorization: string | null; redirect?: RequestRedirect | undefined };
const okClip = () => new Response(bytes, { status: 200, headers: { "content-type": "video/mp4", "content-length": String(bytes.byteLength) } });

/** The API over one fake fetch; the clip over its own transport (as the connector does: never the API's fetch). */
function connector(opts: { task?: unknown; clip?: () => Response; clipFetch?: FetchLike; lookup?: HostLookup } = {}, seen: Seen[] = []) {
  const clipFetch: FetchLike =
    opts.clipFetch ??
    (async (input, init) => {
      const req = new Request(input, init);
      seen.push({ url: req.url, authorization: req.headers.get("authorization"), redirect: init?.redirect });
      return opts.clip?.() ?? okClip();
    });
  return createRunwayConnector({
    now: () => new Date("2026-11-13T12:00:00.000Z"),
    fetch: routedFetch({
      [`GET ${BASE}/v1/tasks/${TASK_ID}`]: (req) => (seen.push({ url: req.url, authorization: req.headers.get("authorization") }), jsonResponse(opts.task ?? TASK_SUCCEEDED)),
      // The API's fetch must never be asked for the clip.
      [`GET ${CLIP_ORIGIN}${CLIP_PATH}`]: () => {
        throw new Error("the clip went over the API's fetch");
      },
    }),
    clip: opts.lookup ? { lookup: opts.lookup } : { fetch: clipFetch },
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
    const seen: Seen[] = [];
    const c = connector({}, seen);
    const r = await c.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(c));
    expect(r.error).toBeUndefined();
    expect(isUntrusted(r.data)).toBe(false);
    const out = DownloadVideoOut.parse(r.data);
    expect(out).toMatchObject({ taskId: TASK_ID, status: "SUCCEEDED", ready: true, mime: "video/mp4", bytes: bytes.byteLength });
    expect(new Uint8Array(Buffer.from(out.base64!, "base64"))).toEqual(bytes);
    expect(seen.map((s) => s.authorization)).toEqual([`Bearer ${KEY}`, null]);
    // The clip request never follows a redirect.
    expect(seen[1]!.redirect).toBe("error");
    expect(r.costMinor ?? 0).toBe(0);
  });

  it("answers not ready, with no bytes, while the task runs", async () => {
    const seen: Seen[] = [];
    const c = connector({ task: TASK_RUNNING }, seen);
    const out = DownloadVideoOut.parse((await c.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(c))).data);
    expect(out).toMatchObject({ ready: false, base64: null, bytes: 0, status: "RUNNING" });
    expect(seen).toHaveLength(1);
  });

  it("refuses a clip over the cap, by its header or by its body, and anything that is not a video", async () => {
    const big = () => new Response(bytes, { headers: { "content-type": "video/mp4", "content-length": String(64 * 1024 * 1024) } });
    const c = connector({ clip: big });
    expect((await c.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(c))).error).toMatchObject({ code: "clip_too_large", status: 413 });
    await expect(fetchClip(async () => new Response(new Uint8Array(20), { headers: { "content-type": "video/mp4" } }), OUTPUT_URL, 10)).rejects.toMatchObject({ code: "clip_too_large" });
    const html = connector({ clip: () => new Response("<html>", { headers: { "content-type": "text/html" } }) });
    expect((await html.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(html))).error).toMatchObject({ code: "clip_not_video", status: 415 });
    await expect(fetchClip(async () => new Response(bytes), "https://127.0.0.1/clip.mp4")).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("copies only an MP4 by its content: an answer labeled video/mp4 that is not one is refused", async () => {
    for (const body of [new TextEncoder().encode("<html><body>not a video</body></html>"), new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]), new Uint8Array([1, 2, 3])]) {
      const c = connector({ clip: () => new Response(body, { headers: { "content-type": "video/mp4", "content-length": String(body.byteLength) } }) });
      const r = await c.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(c));
      expect(r.error).toMatchObject({ code: "clip_not_video", status: 415 });
    }
    expect(await fetchClip(async () => new Response(bytes, { headers: { "content-type": "application/octet-stream" } }), OUTPUT_URL)).toEqual(bytes);
  });

  it("fetches only from Runway's own storage: an address off the allow-list is refused before any request", async () => {
    expect(RUNWAY_OUTPUT_HOSTS).toContain(new URL(OUTPUT_URL).hostname);
    const asked: string[] = [];
    const spy: FetchLike = async (input) => (asked.push(String(input)), okClip());
    for (const off of ["https://metadata.example.com/clip.mp4", "https://internal.corp.example/clip.mp4", "https://dnznrvs05pmza.cloudfront.net.evil.example/clip.mp4", "https://other.cloudfront.net/clip.mp4"])
      await expect(fetchClip(spy, off), off).rejects.toMatchObject({ code: "clip_host_not_allowed" });
    expect(asked).toEqual([]);
    // Through the tool: a task whose output is elsewhere is not fetched, and the refusal is permanent (not retryable).
    const seen: Seen[] = [];
    const c = connector({ task: { ...TASK_SUCCEEDED, output: ["https://attacker.example/clip.mp4"] } }, seen);
    const r = await c.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(c));
    expect(r.error).toMatchObject({ code: "clip_host_not_allowed" });
    expect(r.error?.retryable).toBeFalsy();
    expect(seen).toHaveLength(1);
  });

  it("never follows a redirect: a 3xx answer is refused, and a transport that would follow is told not to", async () => {
    for (const location of ["http://169.254.169.254/latest/meta-data/", "https://internal.corp.example/"]) {
      const seen: Seen[] = [];
      const c = connector({ clip: () => new Response(null, { status: 302, headers: { location } }) }, seen);
      const r = await c.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(c));
      expect(r.error, location).toMatchObject({ code: "clip_redirected" });
      expect(seen.map((s) => s.url)).toEqual([`${BASE}/v1/tasks/${TASK_ID}`, OUTPUT_URL]);
      expect(seen[1]!.redirect).toBe("error");
    }
    // A transport that refuses the redirect itself (fetch with redirect: "error" throws): refused, never retried.
    const throwing = connector({ clipFetch: async () => Promise.reject(new TypeError("fetch failed: redirect mode is set to error")) });
    expect((await throwing.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(throwing))).error).toMatchObject({ code: "clip_unreachable" });
  });

  it("refuses Runway's own host when it resolves to a private or link-local address, before connecting", async () => {
    for (const ip of ["10.0.0.5", "169.254.169.254", "127.0.0.1", "192.168.1.20", "fd00::1"]) {
      const lookups: string[] = [];
      const c = connector({ lookup: async (host) => (lookups.push(host), [ip]) });
      const r = await c.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, live(c));
      expect(r.error, ip).toMatchObject({ code: "blocked_address" });
      expect(lookups, ip).toEqual([new URL(OUTPUT_URL).hostname]);
    }
  });

  it("the mock makes nothing: no bytes, never ready, and says so", async () => {
    const r = await runwayMock.callTool(DOWNLOAD_VIDEO_TOOL, { taskId: TASK_ID }, makeToolContext(runwayMock));
    const out = DownloadVideoOut.parse(r.data);
    expect(out).toMatchObject({ ready: false, base64: null, bytes: 0, simulated: true });
    expect(out.notice).toMatch(/^Simulated: no video was made/);
  });
});
