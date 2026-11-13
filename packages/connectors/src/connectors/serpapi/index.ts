/**
 * Live SerpApi connector over the injected fetch (no SDK). The founder's own key only: it is read from `ctx.credential`
 * (or the credential passed to `healthcheck`), never from platform secrets. SerpApi accepts the key ONLY as the `api_key`
 * query parameter, so it travels in the URL; therefore no URL, no vendor body and no network error text is ever passed
 * on as it came: everything is rebuilt through `sanitized` / `scrub` before it can reach a log, an error or a result.
 */
import { uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { serpapiMock } from "./mock";
import { flattenAiOverview, mapOrganic, SERPAPI_BASE_URL, SERPAPI_CONNECT_FIELDS, SERPAPI_KEY, SERPAPI_RATE_LIMITS, serpapiTools, type SerpAccount, type SerpAiOverview, type SerpSearchResponse } from "./tools";

/** Masks the key (as is and URL-encoded) and any `api_key=` parameter in text that came from the network or the vendor. */
export function scrub(text: string, key?: string): string {
  let out = text;
  if (key) for (const form of new Set([key, encodeURIComponent(key)])) out = out.split(form).join("…");
  return out.replace(/api_key=[^&\s"'<>]*/gi, "api_key=…");
}

const MAX_DETAIL_CHARS = 200;

export function createSerpapiConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);
  const http = createHttp({ connectorKey: SERPAPI_KEY, baseUrl: SERPAPI_BASE_URL, fetch });

  /** The vendor's own one-line error (SerpApi answers `{ "error": "..." }`), scrubbed; network and timeout failures say only that. */
  const sanitized = (e: unknown, path: string, key: string): VendorError => {
    if (!(e instanceof VendorError)) return new VendorError(SERPAPI_KEY, 502, `GET ${path} failed`);
    const raw = e.body && typeof e.body === "object" ? (e.body as { error?: unknown }).error : e.body;
    const detail = typeof raw === "string" ? scrub(raw, key).replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL_CHARS) : "";
    const what = e.httpStatus === 504 ? "timed out" : e.httpStatus === 502 && detail === "" ? "failed (network error)" : String(e.httpStatus);
    return new VendorError(SERPAPI_KEY, e.httpStatus, `GET ${path} → ${what}${detail ? ` (${detail})` : ""}`, detail ? { error: detail } : undefined);
  };

  const get = async <T>(path: string, query: Record<string, string | undefined>, key: string): Promise<T> => {
    try {
      return await http.json<T>("GET", path, { query: { ...query, api_key: key } });
    } catch (e) {
      throw sanitized(e, path, key);
    }
  };

  const keyOf = (ctx: ToolContext): string => {
    const key = ctx.credential?.secret;
    if (!key) throw new ConfigError(SERPAPI_KEY, "the business's own SerpApi API key", "connect SerpApi in Settings › Integrations");
    return key;
  };
  const account = (key: string) => get<SerpAccount>("/account.json", {}, key);

  return buildLiveConnector(
    {
      key: SERPAPI_KEY,
      displayName: "SerpApi",
      phase: 3,
      auth: { kind: "api_key" },
      tools: serpapiTools,
      rateLimits: SERPAPI_RATE_LIMITS,
      now,
      handlers: {
        search_google: async ({ query, location, country, language, includeAiOverview }, ctx) => {
          const key = keyOf(ctx);
          const res = (await get<SerpSearchResponse>("/search", { engine: "google", q: query, location, gl: country?.toLowerCase(), hl: language }, key)) ?? {};
          // SerpApi answers 200 with an `error` when Google had nothing for the query; any other error is a failed call.
          if (res.error && !res.organic_results?.length && !/hasn't returned any results/i.test(res.error)) throw new VendorError(SERPAPI_KEY, 502, `GET /search → 200 (${scrub(res.error, key).slice(0, MAX_DETAIL_CHARS)})`);
          let aiOverview = null;
          if (includeAiOverview) {
            aiOverview = flattenAiOverview(res.ai_overview);
            const token = res.ai_overview?.page_token;
            // Only a token came back: the overview is fetched separately and the token expires within a minute, so do it now.
            // A failure here costs the overview, not the call.
            if (!aiOverview && token && !res.ai_overview?.error) {
              try {
                const follow = await get<SerpSearchResponse & SerpAiOverview>("/search", { engine: "google_ai_overview", page_token: token }, key);
                aiOverview = flattenAiOverview(follow?.ai_overview ?? follow);
              } catch {
                aiOverview = null;
              }
            }
          }
          return { query, organic: mapOrganic(res.organic_results), aiOverview, searchId: res.search_metadata?.id ?? null };
        },
      },
      connectFields: SERPAPI_CONNECT_FIELDS,
      // The Account API is free and not counted against searches. Its answer carries the key and the account email: neither is kept.
      connect: async (businessId, input) => {
        const key = connectInputValue(input, "apiKey");
        if (!key) throw new ConnectInputError(SERPAPI_KEY, "apiKey", "Enter your SerpApi API key to connect SerpApi");
        const acct = await account(key);
        const plan = typeof acct?.plan_name === "string" && acct.plan_name.trim() ? acct.plan_name.trim().slice(0, 60) : null;
        const createdAt = now().toISOString();
        return {
          id: uuid(), businessId, connectorKey: SERPAPI_KEY, status: "connected", scopes: [], accountLabel: plan ? `SerpApi (${plan})` : "SerpApi", externalAccountId: null,
          config: { plan, searchesPerHourLimit: typeof acct?.account_rate_limit_per_hour === "number" ? acct.account_rate_limit_per_hour : null }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt,
          credentialToStore: { kind: "api_key" as const, secret: key },
        };
      },
      healthcheck: async (_integration, credential?: DecryptedCredential) => {
        const startedAt = now().getTime();
        if (!credential?.secret) return healthResult("disconnected", startedAt, { now, message: "No SerpApi API key is connected" });
        try {
          const acct = await account(credential.secret);
          const details: Record<string, unknown> = {};
          if (typeof acct?.total_searches_left === "number") details.searchesLeft = acct.total_searches_left;
          if (typeof acct?.account_rate_limit_per_hour === "number") details.searchesPerHourLimit = acct.account_rate_limit_per_hour;
          return healthResult("connected", startedAt, { now, details });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: e instanceof Error ? scrub(e.message, credential.secret) : "SerpApi check failed" });
        }
      },
    },
    serpapiMock,
  );
}

export { serpapiMock, mockSearch } from "./mock";
export { serpapiTools, SERPAPI_KEY, flattenAiOverview } from "./tools";
