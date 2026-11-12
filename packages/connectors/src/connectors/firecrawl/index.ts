/**
 * Live Firecrawl connector over the injected fetch (no SDK). The founder's own account only: the key comes from the
 * connect form and then from `ctx.credential`; there is no platform key and `secrets` is never read. The key travels
 * in the Authorization header and nowhere else, and is masked out of anything vendor-side before it reaches an error.
 */
import { uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { bearer, createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { firecrawlMock } from "./mock";
import { assertPublicUrl, FIRECRAWL_BASE_URL, FIRECRAWL_CONNECT_FIELDS, FIRECRAWL_KEY, FIRECRAWL_RATE_LIMITS, firecrawlTools, mapScrape, type FcCreditUsageResponse, type FcScrapeResponse } from "./tools";

/** A rendered page can take a while; Firecrawl's own scrape timeout is 60 s by default. */
const SCRAPE_TIMEOUT_MS = 75_000;

/** Firecrawl keys start `fc-`. Anything key-shaped, and the key in hand, is masked out of vendor text. */
export const redactKeys = (text: string, secret?: string): string => {
  const masked = secret ? text.split(secret).join("fc-…") : text;
  return masked.replace(/\bfc-[A-Za-z0-9_*.-]+/g, "fc-…");
};

export function createFirecrawlConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);

  const missingKey = () => new ConfigError(FIRECRAWL_KEY, "the business's own Firecrawl API key", "connect Firecrawl in Settings › Integrations");

  /** One call with the given key. A vendor failure is rebuilt from its status and its masked error text; the raw body is dropped. */
  const call = async <T>(secret: string, method: "GET" | "POST", path: string, body?: unknown, timeoutMs?: number): Promise<T | undefined> => {
    const http = createHttp({ connectorKey: FIRECRAWL_KEY, baseUrl: FIRECRAWL_BASE_URL, fetch, headers: { authorization: bearer(secret) }, ...(timeoutMs ? { timeoutMs } : {}) });
    try {
      return await http.json<T>(method, path, body === undefined ? {} : { body });
    } catch (e) {
      if (!(e instanceof VendorError)) throw e;
      // Status only: Firecrawl's error text can quote the page it read, and an error message reaches the agent outside
      // the untrusted envelope (security review, Nov 12, 2026).
      throw new VendorError(FIRECRAWL_KEY, e.httpStatus, `${method} ${path} → ${e.httpStatus}`);
    }
  };

  /** Reading the balance spends no credit and is the check used for connecting and for health. */
  const creditUsage = async (secret: string) => {
    const res = await call<FcCreditUsageResponse>(secret, "GET", "/v2/team/credit-usage");
    if (!res?.success) throw new VendorError(FIRECRAWL_KEY, 502, "GET /v2/team/credit-usage answered without success");
    return res.data ?? {};
  };

  return buildLiveConnector(
    {
      key: FIRECRAWL_KEY,
      displayName: "Firecrawl",
      phase: 3,
      auth: { kind: "api_key" },
      tools: firecrawlTools,
      rateLimits: FIRECRAWL_RATE_LIMITS,
      now,
      handlers: {
        scrape_page: async ({ url }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          assertPublicUrl(url);
          // Markdown of the main content only: no actions, screenshots, JSON extraction, proxies or other paid add-ons.
          const res = await call<FcScrapeResponse>(secret, "POST", "/v2/scrape", { url, formats: ["markdown"], onlyMainContent: true }, SCRAPE_TIMEOUT_MS);
          const page = mapScrape(url, res);
          if (!page) {
            throw new VendorError(FIRECRAWL_KEY, 502, "POST /v2/scrape answered without page content");
          }
          return page;
        },
      },
      connectFields: FIRECRAWL_CONNECT_FIELDS,
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(FIRECRAWL_KEY, "apiKey", "Enter your Firecrawl API key to connect Firecrawl");
        await creditUsage(apiKey);
        const createdAt = now().toISOString();
        return {
          id: uuid(),
          businessId,
          connectorKey: FIRECRAWL_KEY,
          status: "connected",
          scopes: [],
          accountLabel: "Firecrawl",
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
        if (!secret) return healthResult("disconnected", startedAt, { now, message: "No Firecrawl API key is connected" });
        try {
          const { remainingCredits } = await creditUsage(secret);
          return healthResult("connected", startedAt, { now, ...(typeof remainingCredits === "number" ? { details: { remainingCredits } } : {}) });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: redactKeys(e instanceof Error ? e.message : String(e), secret) });
        }
      },
    },
    firecrawlMock,
  );
}

export { firecrawlMock } from "./mock";
export { firecrawlTools, FIRECRAWL_KEY, assertPublicUrl } from "./tools";
