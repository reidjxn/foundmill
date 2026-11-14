/**
 * Live Runway connector over the injected fetch (no SDK). The founder's own Runway developer account only: the key comes
 * from the connect form and then from `ctx.credential`; there is no platform key and `secrets` is never read. The key
 * travels in the Authorization header and nowhere else, and is masked out of anything vendor-side before it reaches an
 * error. NO WEBHOOKS: Runway reports a task only by polling `GET /v1/tasks/{id}`, so there is nothing to verify or
 * normalise; the agent looks the task up with `get_video_task`.
 */
import { uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { bearer, createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { runwayMock } from "./mock";
import { assertImageUrl, mapStart, mapTask, RUNWAY_API_VERSION, RUNWAY_BASE_URL, RUNWAY_CONNECT_FIELDS, RUNWAY_KEY, RUNWAY_RATE_LIMITS, runwayTools, type RunwayOrganizationResponse, type RunwayStartResponse, type RunwayTaskResponse } from "./tools";

/** Starting a task answers at once; a slow answer is a failure, not a wait. */
const CALL_TIMEOUT_MS = 30_000;

/** Runway keys start `key_`. Anything key-shaped, and the key in hand, is masked out of vendor text. */
export const redactKeys = (text: string, secret?: string): string => {
  const masked = secret && secret.length >= 8 ? text.split(secret).join("key_…") : text;
  return masked.replace(/\bkey_[A-Za-z0-9_*.-]+/g, "key_…");
};

export function createRunwayConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);

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
