/**
 * Live Perplexity connector for the AI visibility panel: `POST https://api.perplexity.ai/v1/agent` (the Agent API,
 * which replaced Sonar Chat Completions on Sep 27, 2026) with the `web_search` tool, over the injected fetch (no SDK).
 * The founder's own key only: it is read from the call credential or the connect input, never from platform secrets,
 * and travels in the Authorization header and nowhere else (not in a URL, a log line, an error message or a result).
 *
 * Key check: `GET /v1/models` answers 401 to a missing or wrong key (checked 2026-11-12) and is a plain list, with no
 * model run and no search, so connect and healthcheck cost the founder nothing.
 */
import { PANEL_MODELS } from "@foundmill/models/routing";
import { uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { bearer, createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { perplexityMock } from "./mock";
import { ANSWER_MAX_CHARS, CITATIONS_MAX, PANEL_MAX_OUTPUT_TOKENS, PANEL_MAX_SEARCH_RESULTS, PERPLEXITY_BASE_URL, PERPLEXITY_CONNECT_FIELDS, PERPLEXITY_KEY, PERPLEXITY_RATE_LIMITS, perplexityTools } from "./tools";

/** A search-backed answer takes a while (the model searches, then writes). */
const PANEL_TIMEOUT_MS = 90_000;

interface AgentBody {
  model?: string;
  status?: string;
  output?: {
    type?: string;
    results?: { url?: unknown; title?: unknown; source?: unknown }[];
    content?: { type?: string; text?: unknown }[];
  }[];
}
interface PerplexityErrorBody {
  error?: { message?: string; type?: string; code?: string | number | null };
}

/** Perplexity keys start `pplx-`; anything key-shaped is masked, and so is the key itself wherever it is quoted. */
export const redactKeys = (text: string): string => text.replace(/\bpplx-[A-Za-z0-9_*.-]+/g, "pplx-…");

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/** The text of the answer, and the distinct http(s) pages the search returned, in order. */
export function readResponse(body: AgentBody): { answer: string; citations: { url: string; title: string | null }[] } {
  const output = body.output ?? [];
  const answer = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((c) => c.type === "output_text")
    .flatMap((c) => (typeof c.text === "string" ? [c.text] : []))
    .join("\n")
    .trim();
  const seen = new Set<string>();
  const citations: { url: string; title: string | null }[] = [];
  for (const r of output.filter((item) => item.type === "search_results").flatMap((item) => item.results ?? [])) {
    if (!isHttpUrl(r.url) || seen.has(r.url)) continue;
    seen.add(r.url);
    citations.push({ url: r.url, title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 300) : null });
    if (citations.length >= CITATIONS_MAX) break;
  }
  return { answer: answer.length > ANSWER_MAX_CHARS ? `${answer.slice(0, ANSWER_MAX_CHARS)}…` : answer, citations };
}

export function createPerplexityConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);

  const missingKey = () => new ConfigError(PERPLEXITY_KEY, "the business's own Perplexity API key", "connect Perplexity in Settings › Integrations");
  const http = (key: string, timeoutMs?: number) => createHttp({ connectorKey: PERPLEXITY_KEY, baseUrl: PERPLEXITY_BASE_URL, fetch, headers: { authorization: bearer(key) }, ...(timeoutMs ? { timeoutMs } : {}) });

  /** The vendor's words minus anything key-shaped, and never the raw body (a bad-key answer may quote the key). */
  const sanitize = (label: string, key: string) => (e: unknown): never => {
    const clean = (s: string) => redactKeys(s.split(key).join("…"));
    if (e instanceof VendorError) {
      const err = (e.body as PerplexityErrorBody | undefined)?.error;
      const detail = [err?.type, err?.message && clean(err.message).slice(0, 200)].filter(Boolean).join(": ");
      throw new VendorError(PERPLEXITY_KEY, e.httpStatus, `${label} → ${e.httpStatus}${detail ? ` (${detail})` : ""}`, err ? { type: err.type ?? null } : undefined);
    }
    throw new Error(clean(e instanceof Error ? e.message : String(e)));
  };

  /** Listing models is authenticated and runs nothing, so it costs nothing. */
  const checkKey = (key: string) => http(key).json("GET", "/v1/models").catch(sanitize("GET /v1/models", key));

  return buildLiveConnector(
    {
      key: PERPLEXITY_KEY,
      displayName: "Perplexity",
      phase: 3,
      auth: { kind: "api_key" },
      tools: perplexityTools,
      rateLimits: PERPLEXITY_RATE_LIMITS,
      now,
      handlers: {
        ask_panel: async ({ question }, ctx) => {
          const key = ctx.credential?.secret;
          if (!key) throw missingKey();
          const model = PANEL_MODELS.perplexity;
          const res = await http(key, PANEL_TIMEOUT_MS)
            .json<AgentBody>("POST", "/v1/agent", {
              body: { model, input: question, tools: [{ type: "web_search", max_results: PANEL_MAX_SEARCH_RESULTS }], max_output_tokens: PANEL_MAX_OUTPUT_TOKENS, store: false },
            })
            .catch(sanitize("POST /v1/agent", key));
          const { answer, citations } = readResponse(res ?? {});
          return { question, answer: answer || "(no answer)", citations, model: typeof res?.model === "string" && res.model ? res.model : model };
        },
      },
      connectFields: PERPLEXITY_CONNECT_FIELDS,
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(PERPLEXITY_KEY, "apiKey", "Enter your Perplexity API key to connect Perplexity");
        await checkKey(apiKey);
        const createdAt = now().toISOString();
        return {
          id: uuid(), businessId, connectorKey: PERPLEXITY_KEY, status: "connected", scopes: ["agent:write"], accountLabel: "Perplexity (your own key)", externalAccountId: null,
          config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt,
          credentialToStore: { kind: "api_key" as const, secret: apiKey },
        };
      },
      healthcheck: async (_integration, credential?: DecryptedCredential) => {
        const startedAt = now().getTime();
        if (!credential?.secret) return healthResult("disconnected", startedAt, { now, message: "No Perplexity key connected" });
        try {
          await checkKey(credential.secret);
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          const status = e instanceof VendorError ? e.httpStatus : undefined;
          return healthResult(status === 401 || status === 403 ? "expired" : "degraded", startedAt, { now, message: e instanceof Error ? redactKeys(e.message) : "Perplexity check failed" });
        }
      },
    },
    perplexityMock,
  );
}

export { perplexityMock } from "./mock";
export { perplexityTools, PERPLEXITY_KEY } from "./tools";
