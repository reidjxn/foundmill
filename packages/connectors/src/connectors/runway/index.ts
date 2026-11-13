/**
 * Live Runway connector over the injected fetch (no SDK). The founder's own Runway developer account only: the key comes
 * from the connect form and then from `ctx.credential`; there is no platform key and `secrets` is never read. The key
 * travels in the Authorization header and nowhere else, and is masked out of anything vendor-side before it reaches an
 * error. NO WEBHOOKS: Runway reports a task only by polling `GET /v1/tasks/{id}`, so there is nothing to verify or
 * normalise; the agent looks the task up with `get_video_task`.
 */
import { AppError, uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { bearer, createHttp, type FetchLike } from "../../http";
import { createPinnedFetch, defaultLookup, type HostLookup } from "../web/reader";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { runwayMock } from "./mock";
import { assertClipUrl, assertImageUrl, isRunwayOutputHost, mapStart, mapTask, RUNWAY_API_VERSION, RUNWAY_BASE_URL, RUNWAY_CONNECT_FIELDS, RUNWAY_KEY, RUNWAY_RATE_LIMITS, runwayTools, VIDEO_DOWNLOAD_MAX_BYTES, type RunwayOrganizationResponse, type RunwayStartResponse, type RunwayTaskResponse } from "./tools";

/** Starting a task answers at once; a slow answer is a failure, not a wait. */
const CALL_TIMEOUT_MS = 30_000;
/** Fetching a finished clip of a few MB from Runway's storage. */
const DOWNLOAD_TIMEOUT_MS = 90_000;

/** What the clip copy may be asked for on a test stack: a transport and a lookup in place of the real ones. */
export interface ClipTransport {
  /** The transport the clip is fetched over. Default: `createPinnedFetch(lookup)`, connected only to public addresses. */
  fetch?: FetchLike;
  /** The DNS lookup the default transport resolves and checks with. */
  lookup?: HostLookup;
}

const clipRefused = (code: string, why: string, status = 502): never => {
  throw new AppError(code, `Runway's clip was not copied: ${why}`, status);
};

/**
 * The clip at `address`, read whole but never past `max` bytes. The gateway fetches it from Runway's storage, so it is
 * the fetcher, and every step is held to what that storage is:
 * - the address must be https on one of `RUNWAY_OUTPUT_HOSTS` (an allow-list, not a hostname heuristic);
 * - the request goes over `fetchImpl`, in production the DNS-pinned transport of the web reader (`createPinnedFetch`):
 *   the name is resolved once, every address it resolves to must be public, and the socket connects only to it;
 * - no redirect is followed (`redirect: "error"`, and a 3xx answer from a transport that does not follow is refused);
 * - a Content-Length over `max` is refused before the body is read, and a body that grows past it is cut off;
 * - no key is sent: the address is a signed link.
 * Refusals are permanent (an `AppError` with its own code); a timeout or a 5xx from the storage may be retried.
 */
export async function fetchClip(fetchImpl: FetchLike, address: string, max: number = VIDEO_DOWNLOAD_MAX_BYTES): Promise<Uint8Array> {
  const url = assertClipUrl(address);
  if (!isRunwayOutputHost(url.hostname)) clipRefused("clip_host_not_allowed", "its address is not on Runway's own storage");
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), { method: "GET", redirect: "error", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof AppError) throw e;
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new VendorError(RUNWAY_KEY, 504, "GET clip timed out");
    // A redirect under `redirect: "error"`, a name that does not resolve, a connection refused: nothing to retry.
    return clipRefused("clip_unreachable", "Runway's storage could not be reached safely");
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    clipRefused("clip_redirected", "Runway's storage answered with a redirect, which is never followed");
  }
  if (!res.ok) throw new VendorError(RUNWAY_KEY, res.status, `GET clip → ${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type && type !== "video/mp4" && type !== "application/octet-stream" && type !== "binary/octet-stream") clipRefused("clip_not_video", `the answer was ${type.slice(0, 40)}, not a video`, 415);
  const tooLarge = () => clipRefused("clip_too_large", `it is larger than ${Math.round(max / (1024 * 1024))} MB`, 413);
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) tooLarge();
  const reader = res.body?.getReader();
  if (!reader) {
    const whole = new Uint8Array(await res.arrayBuffer());
    if (whole.byteLength > max) tooLarge();
    return whole;
  }
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      tooLarge();
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Runway keys start `key_`. Anything key-shaped, and the key in hand, is masked out of vendor text. */
export const redactKeys = (text: string, secret?: string): string => {
  const masked = secret && secret.length >= 8 ? text.split(secret).join("key_…") : text;
  return masked.replace(/\bkey_[A-Za-z0-9_*.-]+/g, "key_…");
};

export function createRunwayConnector(options: LiveConnectorOptions & { clip?: ClipTransport } = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);
  // The clip is never fetched over the injected API fetch: only over a transport pinned to public addresses.
  const clipFetch: FetchLike = options.clip?.fetch ?? createPinnedFetch(options.clip?.lookup ?? defaultLookup);

  const missingKey = () => new ConfigError(RUNWAY_KEY, "the business's own Runway API key", "connect Runway in Settings › Integrations");

  /** One call with the given key. A vendor failure is rebuilt from its status alone: Runway's error text can quote the prompt or the picture's address. */
  const call = async <T>(secret: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T | undefined> => {
    const http = createHttp({ connectorKey: RUNWAY_KEY, baseUrl: RUNWAY_BASE_URL, fetch, timeoutMs: CALL_TIMEOUT_MS, headers: { authorization: bearer(secret), "x-runway-version": RUNWAY_API_VERSION } });
    try {
      return await http.json<T>(method, path, body === undefined ? {} : { body });
    } catch (e) {
      if (!(e instanceof VendorError)) throw e;
      throw new VendorError(RUNWAY_KEY, e.httpStatus, `${method} ${path.replace(/[0-9a-f-]{36}/gi, "{id}")} → ${e.httpStatus}`);
    }
  };

  /** Reading the account spends no credit and is the check used for connecting and for health. */
  const organization = async (secret: string) => (await call<RunwayOrganizationResponse>(secret, "GET", "/v1/organization")) ?? {};

  return buildLiveConnector(
    {
      key: RUNWAY_KEY,
      displayName: "Runway",
      phase: 3,
      auth: { kind: "api_key" },
      tools: runwayTools,
      rateLimits: RUNWAY_RATE_LIMITS,
      now,
      handlers: {
        generate_video_from_text: async ({ prompt, ratio, durationSeconds, model }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          const res = await call<RunwayStartResponse>(secret, "POST", "/v1/text_to_video", { model, promptText: prompt, ratio, duration: durationSeconds });
          const started = mapStart(res, { model, ratio, durationSeconds });
          if (!started) throw new VendorError(RUNWAY_KEY, 502, "POST /v1/text_to_video answered without a task id");
          return started;
        },
        generate_video_from_image: async ({ promptImageUrl, prompt, ratio, durationSeconds, model }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          assertImageUrl(promptImageUrl);
          const res = await call<RunwayStartResponse>(secret, "POST", "/v1/image_to_video", { model, promptImage: promptImageUrl, promptText: prompt, ratio, duration: durationSeconds });
          const started = mapStart(res, { model, ratio, durationSeconds });
          if (!started) throw new VendorError(RUNWAY_KEY, 502, "POST /v1/image_to_video answered without a task id");
          return started;
        },
        get_video_task: async ({ taskId }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          const res = await call<RunwayTaskResponse>(secret, "GET", `/v1/tasks/${taskId}`);
          const task = mapTask(res, now());
          if (!task) throw new VendorError(RUNWAY_KEY, 502, "GET /v1/tasks/{id} answered without a task");
          return task;
        },
        download_video: async ({ taskId }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          // A fresh lookup: the address it answers with is good for a day at least.
          const task = mapTask(await call<RunwayTaskResponse>(secret, "GET", `/v1/tasks/${taskId}`), now());
          if (!task) throw new VendorError(RUNWAY_KEY, 502, "GET /v1/tasks/{id} answered without a task");
          const address = task.outputUrls[0];
          if (task.status !== "SUCCEEDED" || !address) return { taskId: task.taskId, status: task.status, ready: false, mime: null, base64: null, bytes: 0 };
          const clip = await fetchClip(clipFetch, address);
          if (clip.byteLength === 0) throw new VendorError(RUNWAY_KEY, 502, "GET clip answered with no bytes");
          return { taskId: task.taskId, status: task.status, ready: true, mime: "video/mp4" as const, base64: Buffer.from(clip.buffer, clip.byteOffset, clip.byteLength).toString("base64"), bytes: clip.byteLength };
        },
      },
      connectFields: RUNWAY_CONNECT_FIELDS,
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(RUNWAY_KEY, "apiKey", "Enter your Runway API key to connect Runway");
        await organization(apiKey);
        const createdAt = now().toISOString();
        return {
          id: uuid(),
          businessId,
          connectorKey: RUNWAY_KEY,
          status: "connected",
          scopes: [],
          accountLabel: "Runway",
          externalAccountId: null,
          config: {},
          credentialRef: null,
          expiresAt: null,
          lastHealthAt: createdAt,
          createdAt,
          credentialToStore: { kind: "api_key" as const, secret: apiKey },
        };
      },
      healthcheck: async (_integration, credential?: DecryptedCredential) => {
        const startedAt = now().getTime();
        const secret = credential?.secret;
        if (!secret) return healthResult("disconnected", startedAt, { now, message: "No Runway API key is connected" });
        try {
          const { creditBalance } = await organization(secret);
          return healthResult("connected", startedAt, { now, ...(typeof creditBalance === "number" ? { details: { creditBalance } } : {}) });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: redactKeys(e instanceof Error ? e.message : String(e), secret) });
        }
      },
    },
    runwayMock,
  );
}

export { runwayMock } from "./mock";
export { runwayTools, RUNWAY_KEY, assertImageUrl, estimateClipCostMinor } from "./tools";
