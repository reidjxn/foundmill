/**
 * Live web connector. `fetch_page` reads a public page from the gateway: http(s) only, every address the host resolves
 * to (and every redirect hop) must be public, bodies are capped and time-bounded. The address check runs again inside
 * the connection's own DNS lookup (`publicOnlyLookup`), so a name cannot answer public to the check and private to the
 * socket (DNS rebinding). `search_web` runs Anthropic's server web search on the platform key with the model the
 * `worker` route names (packages/models/src/routing.ts) and returns the result titles and addresses only. Not part of
 * CONNECTOR_FACTORIES: the gateway registers it with the built-ins.
 */
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import Anthropic from "@anthropic-ai/sdk";
import { resolveModel } from "@foundmill/models/routing";
import { ConfigError, VendorError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { mockIntegrationRecord } from "../../mock-utils";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { webMock } from "./mock";
import { htmlToText, isPrivateAddress, WEB_KEY, WEB_MAX_BYTES, WEB_MAX_REDIRECTS, WEB_RATE_LIMITS, WEB_TIMEOUT_MS, webTools } from "./tools";

export interface WebConnectorOptions extends LiveConnectorOptions {
  /** Resolves a host name to its addresses (tests); defaults to the system resolver. */
  resolveHost?: (host: string) => Promise<string[]>;
}

export type ResolveHost = (host: string) => Promise<string[]>;

const refused = (message: string) => Object.assign(new Error(message), { status: 400 });
const systemResolveHost: ResolveHost = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * The DNS lookup of the gateway's page-read sockets: the name must resolve to public addresses only, checked on the
 * answer the socket then dials, so nothing between the pre-check and the connection can swap in a private address.
 */
export function publicOnlyLookup(resolveHost: ResolveHost = systemResolveHost): LookupFunction {
  return (hostname, options, callback) => {
    resolveHost(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
          callback(Object.assign(new Error(`${hostname} is not a public address`), { code: "ENOTPUBLIC" }), "", 0);
          return;
        }
        if (options.all) callback(null, addresses.map((address) => ({ address, family: isIP(address) })));
        else callback(null, addresses[0]!, isIP(addresses[0]!));
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 0),
    );
  };
}

/** One page request: a GET that follows no redirect and sends no cookie. */
export type PageFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

/** A GET over node:http(s) whose sockets resolve through `lookup` (`publicOnlyLookup` in production). */
export function lookupGuardedFetch(lookupHost: LookupFunction): PageFetch {
  return (url, { headers, signal }) =>
    new Promise<Response>((resolve, reject) => {
      const target = new URL(url);
      const request = target.protocol === "https:" ? httpsRequest : httpRequest;
      const req = request(target, { method: "GET", headers, lookup: lookupHost, signal }, (res) => {
        const out = new Headers();
        for (const [name, value] of Object.entries(res.headers)) for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) out.append(name, v);
        const status = res.statusCode ?? 502;
        // A status that carries no body (204, 205, 304) cannot be given one.
        const noBody = status === 204 || status === 205 || status === 304;
        if (noBody) res.resume();
        resolve(new Response(noBody ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, headers: out }));
      });
      req.on("error", reject);
      req.end();
    });
}

export function createWebConnector(options: WebConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
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
        fetch_page: async ({ url, maxChars }) => {
          let current = new URL(url);
          for (let hop = 0; ; hop++) {
            await assertPublic(current);
            const res = await pageFetch(current.toString(), { signal: AbortSignal.timeout(WEB_TIMEOUT_MS), headers: { accept: "text/html, text/plain;q=0.9, */*;q=0.1", "user-agent": "FoundmillAgent/1.0 (+https://foundmill.com/agents)" } }).catch((e: unknown) => {
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
        search_web: async ({ query, limit }) => {
          if (!secrets.anthropicApiKey) throw new ConfigError(WEB_KEY, "ANTHROPIC_API_KEY", "web search runs on the platform's Anthropic key");
          const client = new Anthropic({ apiKey: secrets.anthropicApiKey, maxRetries: 1, timeout: 60_000, fetch });
          const response = await client.messages.create({
            model: resolveModel("worker").modelId,
            max_tokens: 2048,
            output_config: { effort: "low" },
            tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1 }],
            messages: [{ role: "user", content: `Search the web for: ${query}\nList what the search returns; do not add anything.` }],
          });
          const results: { url: string; title: string; pageAge: string | null }[] = [];
          for (const block of response.content) {
            if (block.type !== "web_search_tool_result") continue;
            // An error comes back as an object, results as a list (HTTP 200 either way).
            if (!Array.isArray(block.content)) throw new VendorError(WEB_KEY, 503, `web search failed: ${block.content.error_code}`);
            for (const r of block.content) results.push({ url: r.url, title: r.title, pageAge: r.page_age ?? null });
          }
          return { query, results: results.slice(0, limit) };
        },
      },
      connect: async (businessId) => mockIntegrationRecord(WEB_KEY, businessId, { status: "connected", accountLabel: "Built in" }),
      healthcheck: async () => healthResult(secrets.anthropicApiKey ? "connected" : "degraded", now().getTime(), { now, ...(secrets.anthropicApiKey ? {} : { message: "web search needs the platform's Anthropic key; page reads work" }) }),
    },
    webMock,
  );
}

export { webMock, createWebMock, mockPage } from "./mock";
export { webTools, WEB_KEY, WEB_MAX_BYTES, WEB_MAX_REDIRECTS, htmlToText, isPrivateAddress } from "./tools";
