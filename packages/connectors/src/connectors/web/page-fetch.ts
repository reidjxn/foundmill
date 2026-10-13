/**
 * The transport of `fetch_page` (what agents read pages with): `publicOnlyLookup` runs the address check again inside the
 * connection's own DNS lookup, so a name cannot answer public to the check and private to the socket (DNS rebinding),
 * and `lookupGuardedFetch` is a GET over node:http(s) that dials through it. The Source Watcher's `fetch` has its own
 * pinned transport (./reader.ts).
 */
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { APP_NAME, APP_ORIGIN } from "@foundmill/config";
import { isPrivateAddress } from "./tools";

export type ResolveHost = (host: string) => Promise<string[]>;

/** How the gateway names itself to the sites agents read. */
export const WEB_PAGE_USER_AGENT = `${APP_NAME}Agent/1.0 (+${APP_ORIGIN}/agents)`;

export const refused = (message: string) => Object.assign(new Error(message), { status: 400 });
export const systemResolveHost: ResolveHost = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

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

