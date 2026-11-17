/**
 * Live Google Gemini connector over the injected fetch (no SDK). The founder's own AI Studio key only, sent in the
 * `x-goog-api-key` header and nowhere else (never a URL, log line, error message or result). Uses the Interactions API
 * (`POST /v1beta/interactions`, `tools: [{ type: "google_search" }]`), which is what Google's grounding docs show on
 * 2026-11-12; citations are `url_citation` annotations on the `model_output` step's text blocks.
 */
import { PANEL_MODELS } from "@foundmill/models/routing";
import { uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { geminiMock } from "./mock";
import { GEMINI_API_REVISION, GEMINI_BASE_URL, GEMINI_CONNECT_FIELDS, GEMINI_KEY, GEMINI_RATE_LIMITS, geminiTools, MAX_ANSWER_CHARS, MAX_CITATIONS } from "./tools";

/** A grounded answer runs searches first; the shared client's default 20 s is too short. */
const PANEL_TIMEOUT_MS = 90_000;

interface Annotation { type?: string; url?: string; title?: string | null }
interface Block { type?: string; text?: string; annotations?: Annotation[] }
interface Step { type?: string; content?: Block[] }
interface Interaction { model?: string; steps?: Step[] }
interface GoogleErrorBody { error?: { message?: string; status?: string } }

/** Masks the key itself and anything shaped like a Google API key (`AIza...`) in text that may reach an error or log. */
export const redactKeys = (text: string, secret?: string): string => {
  const masked = text.replace(/AIza[0-9A-Za-z_-]{10,}/g, "AIza…");
  return secret ? masked.split(secret).join("…") : masked;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const p = new URL(value).protocol;
    return p === "https:" || p === "http:";
  } catch {
    return false;
  }
};

/** Reads the answer text and its distinct http(s) citations from an Interactions response. */
export function parseInteraction(res: Interaction): { answer: string; citations: { url: string; title: string | null }[] } {
  const blocks = (res.steps ?? []).filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []).filter((b) => b.type === "text");
  const answer = blocks.map((b) => b.text ?? "").join("\n").trim().slice(0, MAX_ANSWER_CHARS);
  const seen = new Set<string>();
  const citations: { url: string; title: string | null }[] = [];
  for (const a of blocks.flatMap((b) => b.annotations ?? [])) {
    if (a.type !== "url_citation" || typeof a.url !== "string" || !isHttpUrl(a.url) || seen.has(a.url)) continue;
    seen.add(a.url);
    citations.push({ url: a.url, title: typeof a.title === "string" && a.title.trim() ? a.title.trim().slice(0, 300) : null });
    if (citations.length >= MAX_CITATIONS) break;
  }
  return { answer, citations };
}

export function createGeminiConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);

  const http = (apiKey: string, timeoutMs?: number): HttpClient =>
    createHttp({ connectorKey: GEMINI_KEY, baseUrl: GEMINI_BASE_URL, fetch, headers: { "x-goog-api-key": apiKey, "api-revision": GEMINI_API_REVISION }, ...(timeoutMs ? { timeoutMs } : {}) });

  /** Runs a call; a vendor failure is rethrown with only the status and a key-masked, truncated message (no raw body). */
  const guarded = async <T>(apiKey: string, what: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      if (!(e instanceof VendorError)) throw e;
      const err = (e.body as GoogleErrorBody | undefined)?.error;
      const detail = [err?.status, err?.message && redactKeys(err.message, apiKey).slice(0, 200)].filter(Boolean).join(": ");
      throw new VendorError(GEMINI_KEY, e.httpStatus, `${what} → ${e.httpStatus}${detail ? ` (${detail})` : ""}`);
    }
  };
  const getModel = (apiKey: string) => guarded(apiKey, "GET /models", () => http(apiKey).json("GET", `/models/${PANEL_MODELS.gemini}`));
  const missingKey = () => new ConfigError(GEMINI_KEY, "the business's own Gemini API key", "connect Google Gemini in Settings › Integrations");

  return buildLiveConnector(
    {
      key: GEMINI_KEY,
      displayName: "Google Gemini",
      phase: 3,
      auth: { kind: "api_key" },
      connectFields: GEMINI_CONNECT_FIELDS,
      tools: geminiTools,
      rateLimits: GEMINI_RATE_LIMITS,
      now,
      handlers: {
        ask_panel: async ({ question }, ctx) => {
          const apiKey = ctx.credential?.secret;
          if (!apiKey) throw missingKey();
          const res = await guarded(apiKey, "POST /interactions", () =>
            http(apiKey, PANEL_TIMEOUT_MS).json<Interaction>("POST", "/interactions", { body: { model: PANEL_MODELS.gemini, input: question, tools: [{ type: "google_search" }] } }),
          );
          const { answer, citations } = parseInteraction(res);
          return { question, answer: answer || "(no answer)", citations, model: typeof res.model === "string" && res.model ? res.model : PANEL_MODELS.gemini };
        },
      },
      // The founder's own key only; the check is a free model lookup.
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(GEMINI_KEY, "apiKey", "Enter your Gemini API key to connect Google Gemini");
        await getModel(apiKey);
        const createdAt = now().toISOString();
        return {
          id: uuid(), businessId, connectorKey: GEMINI_KEY, status: "connected", scopes: ["generate"], accountLabel: "Google Gemini (your own key)", externalAccountId: null,
          config: { billing: "byok" }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt,
          credentialToStore: { kind: "api_key" as const, secret: apiKey },
        };
      },
      healthcheck: async (_integration, credential) => {
        const startedAt = now().getTime();
        const apiKey = credential?.secret;
        if (!apiKey) return healthResult("disconnected", startedAt, { now, message: missingKey().message });
        try {
          await getModel(apiKey);
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: redactKeys(e instanceof Error ? e.message : String(e), apiKey) });
        }
      },
    },
    geminiMock,
  );
}

export { geminiMock } from "./mock";
export { geminiTools, GEMINI_KEY } from "./tools";
