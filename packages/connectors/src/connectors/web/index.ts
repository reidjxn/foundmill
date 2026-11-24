/**
 * Live web connector, key `web`, three read-only tools (no account):
 *  - `fetch` is the Source Watcher's reader (BUILD §11.5): public pages only, within robots.txt, size- and time-capped,
 *    over a transport pinned to the addresses it checked (./reader.ts).
 *  - `fetch_page` is the page read agents get under the web grants (audit GPC-03), run by the gateway: http(s) only, every
 *    address the host resolves to (and every redirect hop) must be public, bodies are capped and time-bounded. The
 *    address check runs again inside the connection's own DNS lookup (`publicOnlyLookup`, ./page-fetch.ts), so a name
 *    cannot answer public to the check and private to the socket (DNS rebinding).
 *  - `search_web` runs Anthropic's server web search through the injected `searchWeb` (WP-09 T3): the gateway's
 *    platform model client on the `webSearch` route (packages/models `LiveModelClient.searchWeb`), which asks the
 *    business's credits first and books the tokens and the search fee. It returns the result titles and addresses only.
 * Not part of CONNECTOR_FACTORIES: the gateway registers it with the built-ins.
 */
import { isIP } from "node:net";
import { uuid } from "@foundmill/shared";
import { ConfigError, VendorError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { webMock } from "./mock";
import { lookupGuardedFetch, publicOnlyLookup, refused, systemResolveHost, WEB_PAGE_USER_AGENT, type PageFetch, type ResolveHost } from "./page-fetch";
import { createPageReader, defaultLookup, type HostLookup } from "./reader";
import { htmlToText, isPrivateAddress, WEB_KEY, WEB_SEARCH_OFF, WEB_MAX_BYTES, WEB_MAX_REDIRECTS, WEB_RATE_LIMITS, WEB_TIMEOUT_MS, webTools } from "./tools";

export interface WebConnectorOptions extends LiveConnectorOptions {
  /** DNS lookup used for the Source Watcher reader's address checks (tests inject one). */
  lookup?: HostLookup;
  timeoutMs?: number;
  /** Resolves a host name to its addresses for `fetch_page` (tests); defaults to the system resolver. */
  resolveHost?: ResolveHost;
}

export function createWebConnector(options: WebConnectorOptions = {}): Connector {
  const { fetch, now, searchWeb } = resolveLiveOptions(options);
  const read = createPageReader({ fetch, now, lookup: options.lookup ?? defaultLookup, timeoutMs: options.timeoutMs });
  const resolveHost = options.resolveHost ?? systemResolveHost;
  // Tests hand in `fetch`; the gateway does not, so its page reads dial only what publicOnlyLookup let through.
  const pageFetch: PageFetch = options.fetch ? (url, init) => fetch(url, { ...init, redirect: "manual" }) : lookupGuardedFetch(publicOnlyLookup(resolveHost));

  /** Only public http(s) addresses: the gateway must never reach the private network or a metadata service. */
  const assertPublic = async (url: URL) => {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw refused(`only http and https pages can be read (${url.protocol})`);
    if (url.username || url.password) throw refused("addresses with credentials cannot be read");
    if (url.port && url.port !== "80" && url.port !== "443") throw refused(`port ${url.port} cannot be read`);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw refused(`${host} is not a public address`);
    const addresses = isIP(host) ? [host] : await resolveHost(host).catch(() => {
      throw refused(`${host} could not be resolved`);
    });
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw refused(`${host} is not a public address`);
  };

  const readBody = async (res: Response): Promise<{ body: string; truncated: boolean }> => {
    if (!res.body) return { body: "", truncated: false };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > WEB_MAX_BYTES) {
        truncated = true;
        chunks.push(value.subarray(0, value.byteLength - (size - WEB_MAX_BYTES)));
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
    }
    return { body: Buffer.concat(chunks).toString("utf8"), truncated };
  };

  return buildLiveConnector(
    {
      key: WEB_KEY,
      displayName: "Web search and pages",
      phase: 1,
      auth: { kind: "none" },
      tools: webTools,
      rateLimits: WEB_RATE_LIMITS,
      now,
      handlers: {
        fetch: async ({ url, maxChars }) => read(url, maxChars),
        fetch_page: async ({ url, maxChars }) => {
          let current = new URL(url);
          for (let hop = 0; ; hop++) {
            await assertPublic(current);
            const res = await pageFetch(current.toString(), { signal: AbortSignal.timeout(WEB_TIMEOUT_MS), headers: { accept: "text/html, text/plain;q=0.9, */*;q=0.1", "user-agent": WEB_PAGE_USER_AGENT } }).catch((e: unknown) => {
              // The connection's own lookup refused the address (the name changed its answer after the check).
              if ((e as { code?: unknown }).code === "ENOTPUBLIC") throw refused(`${current.hostname} is not a public address`);
              throw e;
            });
            const location = res.headers.get("location");
            if (res.status >= 300 && res.status < 400 && location) {
              await res.body?.cancel().catch(() => undefined);
              if (hop >= WEB_MAX_REDIRECTS) throw refused(`more than ${WEB_MAX_REDIRECTS} redirects`);
              current = new URL(location, current);
              continue;
            }
            const contentType = res.headers.get("content-type");
            const { body, truncated: cut } = await readBody(res);
            const { title, text } = htmlToText(body, contentType);
            return { url, finalUrl: current.toString(), status: res.status, contentType, title, text: text.slice(0, maxChars), truncated: cut || text.length > maxChars };
          }
        },
        search_web: async ({ query, limit }, ctx) => {
          // The deployment's own setting, said as it is (WP-05 T21): never a missing key the agent reports as an outage.
          if (!searchWeb) throw Object.assign(new ConfigError(WEB_KEY, "MODEL_MODE"), { message: WEB_SEARCH_OFF });
          const results = await searchWeb({ businessId: ctx.businessId, agentId: ctx.agentId, ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}), query, limit }).catch((e: unknown) => {
            // The search itself failed (an error result, or the API unavailable): a vendor failure the agent can read. A
            // refusal before the request (the credits gate) keeps its own code.
            if ((e as { code?: unknown }).code === "unavailable") throw new VendorError(WEB_KEY, 503, (e as Error).message);
            throw e;
          });
          return { query, results: results.slice(0, limit) };
        },
      },
      connect: async (businessId) => {
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: WEB_KEY, status: "connected", scopes: [], accountLabel: "Built in", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      // Page reads need no account and report their own failures; search needs the gateway's platform model client.
      healthcheck: async () => healthResult(searchWeb ? "connected" : "degraded", now().getTime(), { now, ...(searchWeb ? {} : { message: WEB_SEARCH_OFF }) }),
    },
    webMock,
  );
}

export { webMock, createWebMock, mockPage } from "./mock";
export { lookupGuardedFetch, publicOnlyLookup, WEB_PAGE_USER_AGENT, type PageFetch, type ResolveHost } from "./page-fetch";
export { webTools, WEB_KEY, WEB_SEARCH_OFF, WEB_MAX_BYTES, WEB_MAX_REDIRECTS, WEB_USER_AGENT, WEB_ROBOTS_TOKEN, isPrivateAddress } from "./tools";
export { htmlToText, isPublicAddress, robotsAllows } from "./reader";
