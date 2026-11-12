/**
 * Live IndexNow connector: no vendor account. The founder publishes a key file on their own site and enters the host and
 * the key. `connect()` and the health check fetch that file (a host the founder typed, so over the gateway's guarded
 * transport: public addresses only, https, no hop to another host, 1 KB, 5 s); `submit_urls` POSTs to api.indexnow.org.
 * The key is public by protocol, but it still travels as the sealed credential so the gateway treats the integration as
 * the founder's own, and it is kept out of logs and errors.
 */
import { AppError, uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { lookupGuardedFetch, publicOnlyLookup, systemResolveHost, WEB_PAGE_USER_AGENT, type PageFetch, type ResolveHost } from "../web/page-fetch";
import { indexNowMock } from "./mock";
import {
  assertUrlsOnSite,
  INDEXNOW_BASE_URL,
  INDEXNOW_CONNECT_FIELDS,
  INDEXNOW_KEY,
  INDEXNOW_KEY_FILE_MAX_BYTES,
  INDEXNOW_KEY_FILE_MAX_REDIRECTS,
  INDEXNOW_KEY_FILE_TIMEOUT_MS,
  INDEXNOW_PATH,
  INDEXNOW_RATE_LIMITS,
  indexNowKeyFileUrl,
  indexNowTarget,
  indexNowTools,
  isIndexNowKey,
  keyFileProblem,
  normalizeIndexNowHost,
  redactKey,
} from "./tools";

export interface IndexNowConnectorOptions extends LiveConnectorOptions {
  /** Resolves a host name for the key-file fetch (tests); defaults to the system resolver. */
  resolveHost?: ResolveHost;
}

type KeyFileCheck = { ok: true } | { ok: false; reason: "unreachable" | "status" | "mismatch" };

export function createIndexNowConnector(options: IndexNowConnectorOptions = {}): Connector {
  // `secrets` is never read: IndexNow has no platform key, and the key is the founder's own.
  const { fetch, now } = resolveLiveOptions(options);
  const resolveHost = options.resolveHost ?? systemResolveHost;
  // Tests hand in `fetch`; the gateway does not, so its key-file reads dial only what publicOnlyLookup let through.
  const pageFetch: PageFetch = options.fetch ? (url, init) => fetch(url, { ...init, redirect: "manual" }) : lookupGuardedFetch(publicOnlyLookup(resolveHost));

  /** Does the key file at `keyLocation` serve exactly `key`? */
  const checkKeyFile = async (keyLocation: string, key: string): Promise<KeyFileCheck> => {
    try {
      const first = new URL(keyLocation);
      let current = first;
      for (let hop = 0; ; hop++) {
        if (current.protocol !== "https:" || current.hostname !== first.hostname || current.port || current.username || current.password) return { ok: false, reason: "unreachable" };
        const res = await pageFetch(current.toString(), { signal: AbortSignal.timeout(INDEXNOW_KEY_FILE_TIMEOUT_MS), headers: { accept: "text/plain, */*;q=0.1", "user-agent": WEB_PAGE_USER_AGENT } });
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel().catch(() => undefined);
          if (hop >= INDEXNOW_KEY_FILE_MAX_REDIRECTS) return { ok: false, reason: "unreachable" };
          current = new URL(location, current);
          continue;
        }
        if (res.status !== 200) {
          await res.body?.cancel().catch(() => undefined);
          return { ok: false, reason: "status" };
        }
        const body = await readCapped(res, INDEXNOW_KEY_FILE_MAX_BYTES);
        return body !== null && body.trim() === key ? { ok: true } : { ok: false, reason: "mismatch" };
      }
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  };

  return buildLiveConnector(
    {
      key: INDEXNOW_KEY,
      displayName: "IndexNow",
      phase: 3,
      // The founder's own site and key; no platform key.
      auth: { kind: "api_key" },
      tools: indexNowTools,
      rateLimits: INDEXNOW_RATE_LIMITS,
      connectFields: INDEXNOW_CONNECT_FIELDS,
      now,
      handlers: {
        submit_urls: async ({ urls }, ctx) => {
          const key = ctx.credential?.secret;
          if (!key) throw new ConfigError(INDEXNOW_KEY, "the business's own IndexNow key", "connect IndexNow in Settings › Integrations");
          const target = indexNowTarget(ctx.integration.config, key);
          if (!target) throw new ConfigError(INDEXNOW_KEY, "the site address of the IndexNow connection", "connect IndexNow in Settings › Integrations");
          // Before any network call.
          assertUrlsOnSite(urls, target.host, target.keyLocation);
          const http = createHttp({ connectorKey: INDEXNOW_KEY, baseUrl: INDEXNOW_BASE_URL, fetch, headers: { "content-type": "application/json; charset=utf-8" } });
          const keyLocation = target.keyLocation === indexNowKeyFileUrl(target.host, key) ? undefined : target.keyLocation;
          const okStatuses = [200, 202, 400, 403, 422, 429];
          let status: number;
          try {
            status = (await http.raw("POST", INDEXNOW_PATH, { okStatuses, body: { host: target.host, key, ...(keyLocation ? { keyLocation } : {}), urlList: urls } })).status;
          } catch (e) {
            // Never forward the vendor's text: it could echo the request.
            const code = e instanceof VendorError ? e.httpStatus : 502;
            throw new VendorError(INDEXNOW_KEY, code, redactKey(code === 504 ? "IndexNow timed out" : `IndexNow could not take the request (${code})`, key));
          }
          if (status === 200 || status === 202) return { submitted: urls.length, host: target.host, status: status === 200 ? ("received" as const) : ("pending_key_validation" as const), urls };
          if (status === 403) throw new AppError("key_not_valid", `IndexNow could not validate the key: the key file at ${target.keyLocation} must be reachable and contain exactly the key`, 403);
          if (status === 422) throw new AppError("url_not_on_host", `IndexNow says these addresses do not belong to ${target.host}, or the key does not match its rules`, 422);
          if (status === 429) throw new VendorError(INDEXNOW_KEY, 429, "IndexNow is limiting requests; try again later");
          throw new VendorError(INDEXNOW_KEY, status, "IndexNow rejected the request as badly formed");
        },
      },
      connect: async (businessId, input) => {
        const hostInput = connectInputValue(input, "host");
        if (!hostInput) throw new ConnectInputError(INDEXNOW_KEY, "host", "Enter your site's host name, for example northwindskincare.com");
        const host = normalizeIndexNowHost(hostInput);
        if (!host) throw new ConnectInputError(INDEXNOW_KEY, "host", "That is not a public site address. Enter the host name of your live site, for example northwindskincare.com (not an IP address or localhost).");
        const key = connectInputValue(input, "key");
        if (!key) throw new ConnectInputError(INDEXNOW_KEY, "key", "Enter your IndexNow key. Choose 8 to 128 letters, numbers or dashes and publish it as a text file on your site.");
        if (!isIndexNowKey(key)) throw new ConnectInputError(INDEXNOW_KEY, "key", "The IndexNow key must be 8 to 128 characters, using only letters, numbers and dashes.");
        const locationInput = connectInputValue(input, "keyLocation");
        let keyLocation = indexNowKeyFileUrl(host, key);
        if (locationInput) {
          let u: URL | null = null;
          try {
            u = new URL(locationInput);
          } catch {
            u = null;
          }
          if (!u || u.protocol !== "https:" || u.hostname.toLowerCase() !== host || u.port || u.username || u.password || u.search || u.hash) {
            throw new ConnectInputError(INDEXNOW_KEY, "keyLocation", `The key file address must be an https address on ${host}.`);
          }
          keyLocation = u.toString();
        }
        const check = await checkKeyFile(keyLocation, key);
        if (!check.ok) throw new ConnectInputError(INDEXNOW_KEY, "key", keyFileProblem(keyLocation));
        const createdAt = now().toISOString();
        return {
          id: uuid(), businessId, connectorKey: INDEXNOW_KEY, status: "connected", scopes: [], accountLabel: host, externalAccountId: host,
          config: { host, keyLocation, key }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt,
          // The key is public by protocol; the gateway still needs a stored credential to treat this as the founder's own.
          credentialToStore: { kind: "api_key" as const, secret: key },
        };
      },
      healthcheck: async (integration, credential) => {
        const startedAt = now().getTime();
        if (!credential?.secret) return healthResult("disconnected", startedAt, { now, message: "No IndexNow key is connected" });
        const target = indexNowTarget(integration.config, credential.secret);
        if (!target) return healthResult("degraded", startedAt, { now, message: "The connection has no site address; connect IndexNow again" });
        const check = await checkKeyFile(target.keyLocation, credential.secret);
        return check.ok
          ? healthResult("connected", startedAt, { now, details: { host: target.host } })
          : healthResult("degraded", startedAt, { now, message: keyFileProblem(target.keyLocation) });
      },
    },
    indexNowMock,
  );
}

/** At most `max` bytes of the body as text; null when the body is longer. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export { indexNowMock } from "./mock";
export { indexNowTools, INDEXNOW_KEY, INDEXNOW_KEY_RE, isIndexNowKey, indexNowKeyFileUrl, urlCoveredByKeyLocation, normalizeIndexNowHost } from "./tools";
