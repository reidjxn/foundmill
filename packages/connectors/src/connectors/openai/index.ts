/**
 * Live OpenAI connector for the AI visibility panel: `POST https://api.openai.com/v1/responses` with the `web_search`
 * tool, over the injected fetch (no SDK). The founder's own key only: it is read from the call credential or the
 * connect input, never from platform secrets, and travels in the Authorization header and nowhere else (not in a URL,
 * a log line, an error message or a tool result).
 */
import { PANEL_MODELS } from "@foundmill/models/routing";
import { uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { bearer, createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { openaiMock } from "./mock";
import { ANSWER_MAX_CHARS, CITATIONS_MAX, OPENAI_BASE_URL, OPENAI_CONNECT_FIELDS, OPENAI_KEY, OPENAI_RATE_LIMITS, openaiTools, PANEL_MAX_OUTPUT_TOKENS } from "./tools";

/** A search-backed answer takes a while (the model searches, opens pages, then writes). */
const PANEL_TIMEOUT_MS = 90_000;

interface Annotation {
  type?: string;
  url?: unknown;
  title?: unknown;
}
interface ResponsesBody {
  model?: string;
  status?: string;
  output?: { type?: string; content?: { type?: string; text?: unknown; annotations?: Annotation[] }[] }[];
}
interface OpenAiErrorBody {
  error?: { message?: string; type?: string; code?: string | null };
}

/** Anything shaped like a key is masked, a partly masked one too (`sk-proj-****abcd`: the visible tail is still secret). */
export const redactKeys = (text: string): string => text.replace(/\bsk-[A-Za-z0-9_*.-]+/g, "sk-…");

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/** The text of the answer, and the distinct http(s) pages it cited, in order of first citation. */
export function readResponse(body: ResponsesBody): { answer: string; citations: { url: string; title: string | null }[] } {
  const parts = (body.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []).filter((c) => c.type === "output_text");
  const answer = parts.flatMap((p) => (typeof p.text === "string" ? [p.text] : [])).join("\n").trim();
  const seen = new Set<string>();
  const citations: { url: string; title: string | null }[] = [];
  for (const a of parts.flatMap((p) => p.annotations ?? [])) {
    if (a.type !== "url_citation" || !isHttpUrl(a.url) || seen.has(a.url)) continue;
    seen.add(a.url);
    citations.push({ url: a.url, title: typeof a.title === "string" && a.title.trim() ? a.title.trim().slice(0, 300) : null });
    if (citations.length >= CITATIONS_MAX) break;
  }
  return { answer: answer.length > ANSWER_MAX_CHARS ? `${answer.slice(0, ANSWER_MAX_CHARS)}…` : answer, citations };
}

export function createOpenaiConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);

  const missingKey = () => new ConfigError(OPENAI_KEY, "the business's own OpenAI API key", "connect OpenAI in Settings › Integrations");
  const http = (key: string, timeoutMs?: number) => createHttp({ connectorKey: OPENAI_KEY, baseUrl: OPENAI_BASE_URL, fetch, headers: { authorization: bearer(key) }, ...(timeoutMs ? { timeoutMs } : {}) });

  /** The vendor's words minus anything key-shaped, and never the raw body (a bad-key answer quotes the key). */
  const sanitize = (label: string, key: string) => (e: unknown): never => {
    const clean = (s: string) => redactKeys(s.split(key).join("…"));
    if (e instanceof VendorError) {
      const err = (e.body as OpenAiErrorBody | undefined)?.error;
      const detail = [err?.code ?? err?.type, err?.message && clean(err.message).slice(0, 200)].filter(Boolean).join(": ");
      throw new VendorError(OPENAI_KEY, e.httpStatus, `${label} → ${e.httpStatus}${detail ? ` (${detail})` : ""}`, err ? { code: err.code ?? null, type: err.type ?? null } : undefined);
    }
    throw new Error(clean(e instanceof Error ? e.message : String(e)));
  };

  /** Reading the model record costs nothing. */
  const checkKey = (key: string) => http(key).json("GET", `/models/${encodeURIComponent(PANEL_MODELS.openai)}`).catch(sanitize(`GET /models/${PANEL_MODELS.openai}`, key));

  return buildLiveConnector(
    {
      key: OPENAI_KEY,
      displayName: "OpenAI",
      phase: 3,
      auth: { kind: "api_key" },
      tools: openaiTools,
      rateLimits: OPENAI_RATE_LIMITS,
      now,
      handlers: {
        ask_panel: async ({ question }, ctx) => {
          const key = ctx.credential?.secret;
          if (!key) throw missingKey();
          const model = PANEL_MODELS.openai;
          const res = await http(key, PANEL_TIMEOUT_MS)
            .json<ResponsesBody>("POST", "/responses", { body: { model, input: question, tools: [{ type: "web_search" }], max_output_tokens: PANEL_MAX_OUTPUT_TOKENS, store: false } })
            .catch(sanitize("POST /responses", key));
          const { answer, citations } = readResponse(res ?? {});
          return { question, answer: answer || "(no answer)", citations, model: typeof res?.model === "string" && res.model ? res.model : model };
        },
      },
      connectFields: OPENAI_CONNECT_FIELDS,
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(OPENAI_KEY, "apiKey", "Enter your OpenAI API key to connect OpenAI");
        await checkKey(apiKey);
        const createdAt = now().toISOString();
        return {
          id: uuid(), businessId, connectorKey: OPENAI_KEY, status: "connected", scopes: ["responses:write"], accountLabel: "OpenAI (your own key)", externalAccountId: null,
          config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt,
          credentialToStore: { kind: "api_key" as const, secret: apiKey },
        };
      },
      healthcheck: async (_integration, credential?: DecryptedCredential) => {
        const startedAt = now().getTime();
        if (!credential?.secret) return healthResult("disconnected", startedAt, { now, message: "No OpenAI key connected" });
        try {
          await checkKey(credential.secret);
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          const status = e instanceof VendorError ? e.httpStatus : undefined;
          return healthResult(status === 401 || status === 403 ? "expired" : "degraded", startedAt, { now, message: e instanceof Error ? redactKeys(e.message) : "OpenAI check failed" });
        }
      },
    },
    openaiMock,
  );
}

export { openaiMock } from "./mock";
export { openaiTools, OPENAI_KEY } from "./tools";
