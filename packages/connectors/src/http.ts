/**
 * Small fetch wrapper shared by the live connectors that have no SDK in the catalog (Companies House,
 * OpenCorporates, Bolagsverket, ECB, E2B, Google, Notion, Cloudflare, Dropbox Sign, Shopify, Tink, Plaid).
 * Every call has a timeout, a User-Agent, JSON handling and maps non-2xx answers to `VendorError`.
 * `fetch` is injectable so contract tests can run the live code paths against canned responses.
 */
import { VendorError } from "./contract";

export type FetchLike = typeof fetch;

export interface HttpClientOptions {
  connectorKey: string;
  baseUrl: string;
  fetch?: FetchLike;
  headers?: Record<string, string>;
  timeoutMs?: number;
  userAgent?: string;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  body?: unknown;
  /** `application/x-www-form-urlencoded` body (OAuth token endpoints, Dropbox Sign). */
  form?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  /** Accept these non-2xx statuses and return the parsed body instead of throwing. */
  okStatuses?: number[];
}

export interface HttpClient {
  readonly baseUrl: string;
  json<T = unknown>(method: string, path: string, opts?: RequestOptions): Promise<T>;
  text(method: string, path: string, opts?: RequestOptions): Promise<string>;
  /** Raw response for callers that need headers/status (pagination cursors, 204s). */
  raw(method: string, path: string, opts?: RequestOptions): Promise<Response>;
}

export const DEFAULT_USER_AGENT = "founder-manager-connectors/0.1 (+https://github.com/reidjxn/founder-manager)";

export function buildUrl(baseUrl: string, path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path.startsWith("http") ? path : `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item);
      else url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export function createHttp(options: HttpClientOptions): HttpClient {
  const fetchImpl: FetchLike = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  async function raw(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    const url = buildUrl(options.baseUrl, path, opts.query);
    const headers: Record<string, string> = { accept: "application/json", "user-agent": options.userAgent ?? DEFAULT_USER_AGENT, ...options.headers, ...opts.headers };
    let body: string | undefined;
    if (opts.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.form)) if (v !== undefined) params.set(k, v);
      body = params.toString();
    } else if (opts.body !== undefined) {
      headers["content-type"] ??= "application/json";
      body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method, headers, body, signal: controller.signal });
      if (!res.ok && !(opts.okStatuses ?? []).includes(res.status)) {
        const text = await safeText(res);
        throw new VendorError(options.connectorKey, res.status, `${method} ${redactUrl(url)} → ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`, tryJson(text));
      }
      return res;
    } catch (e) {
      if (e instanceof VendorError) throw e;
      if (e instanceof Error && e.name === "AbortError") throw new VendorError(options.connectorKey, 504, `${method} ${redactUrl(url)} timed out after ${timeoutMs} ms`);
      throw new VendorError(options.connectorKey, 502, `${method} ${redactUrl(url)} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    baseUrl: options.baseUrl,
    raw,
    async text(method, path, opts) {
      const res = await raw(method, path, opts);
      return res.text();
    },
    async json<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
      const res = await raw(method, path, opts);
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new VendorError(options.connectorKey, 502, `${method} ${path} returned non-JSON body`);
      }
    },
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function tryJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return text || undefined;
  }
}

/** Strip query strings (api tokens travel there for OpenCorporates) before an URL reaches a log or error. */
export function redactUrl(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : `${url.slice(0, i)}?…`;
}

export const basicAuth = (username: string, password = ""): string => `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
export const bearer = (token: string): string => `Bearer ${token}`;

/** Build a `Response` for tests and mocks of the live code paths. */
export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...init.headers } });
}

/**
 * A `fetch` that answers from a routing table: `"GET https://api.example.com/path"` → handler. Used by the
 * contract tests to exercise live connectors without network. Unmatched requests throw loudly.
 */
export function routedFetch(routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>): FetchLike {
  return async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const key = `${req.method} ${url.origin}${url.pathname}`;
    const handler = routes[key] ?? routes[`${req.method} ${url.pathname}`] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
    if (!handler) throw new Error(`routedFetch: no route for ${key}`);
    return handler(req, url);
  };
}
