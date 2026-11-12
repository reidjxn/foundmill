/**
 * IndexNow: tell search engines that a URL of the project's own site changed (docs: https://www.indexnow.org/documentation,
 * read Nov 12, 2026). There is no vendor account. The "key" is one the founder generates; it is public by design because
 * it is served as a text file on the site (`https://<host>/<key>.txt`, or the `keyLocation` the request names), and that
 * file is how the search engine checks the submitter owns the site.
 */
import { isIP } from "node:net";
import { z } from "zod";
import { AppError } from "@foundmill/shared";
import type { ConnectField } from "../../contract";
import { defineTool } from "../../define";

export const INDEXNOW_KEY = "indexnow";
export const INDEXNOW_BASE_URL = "https://api.indexnow.org";
export const INDEXNOW_PATH = "/indexnow";

/** The protocol allows 10,000 URLs per request; one agent call sends at most 100. */
export const INDEXNOW_MAX_URLS = 100;
/** The key file is a few dozen bytes; the guarded fetch reads at most this much of it. */
export const INDEXNOW_KEY_FILE_MAX_BYTES = 1024;
export const INDEXNOW_KEY_FILE_TIMEOUT_MS = 5_000;
export const INDEXNOW_KEY_FILE_MAX_REDIRECTS = 2;

/** 8 to 128 characters of a-z, A-Z, 0-9 and dashes (the protocol's rule). */
export const INDEXNOW_KEY_RE = /^[a-zA-Z0-9-]{8,128}$/;
export const isIndexNowKey = (value: unknown): value is string => typeof value === "string" && INDEXNOW_KEY_RE.test(value);

/** Where the key file lives when `keyLocation` is not given. */
export const indexNowKeyFileUrl = (host: string, key: string): string => `https://${host}/${key}.txt`;

/**
 * Is `url` within what the key file at `keyLocation` covers? Same origin, and under the key file's directory (a key file
 * at the root covers the whole host). A value that is not an address is never covered.
 */
export function urlCoveredByKeyLocation(url: string, keyLocation: string): boolean {
  let target: URL;
  let key: URL;
  try {
    target = new URL(url);
    key = new URL(keyLocation);
  } catch {
    return false;
  }
  if (target.origin !== key.origin || target.protocol !== "https:") return false;
  const directory = key.pathname.slice(0, key.pathname.lastIndexOf("/") + 1);
  return target.pathname.startsWith(directory);
}

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const NOT_PUBLIC_SUFFIX_RE = /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|corp|test|invalid|example)$/;

/**
 * The host name of a site, from a host name or a pasted address: lowercase, no scheme, path, port or credentials. A public
 * multi-label DNS name only (no IP address, no `localhost`). Returns null when it is not one.
 */
export function normalizeIndexNowHost(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || isIP(host) || host.startsWith("[")) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1]!) || NOT_PUBLIC_SUFFIX_RE.test(host)) return null;
  return host;
}

/** What the founder enters in Settings › Integrations to connect IndexNow: the site's host and a key file they publish. */
export const INDEXNOW_CONNECT_FIELDS: ConnectField[] = [
  { name: "host", label: "Site address", secret: false, required: true, placeholder: "northwindskincare.com", hint: "The host name of your site. You can paste a full address; only the host is kept." },
  { name: "key", label: "IndexNow key", secret: false, required: true, placeholder: "a1b2c3d4e5f6a7b8", hint: "Any 8 to 128 letters, numbers and dashes that you choose. It is public by design: publish it as a text file at https://<your site>/<key>.txt containing just the key." },
  { name: "keyLocation", label: "Key file address (optional)", secret: false, required: false, placeholder: "https://northwindskincare.com/indexnow/a1b2c3d4e5f6a7b8.txt", hint: "Only if the key file is not at the top of your site. Search engines then accept only addresses under that file's folder." },
];

/** Plain sentence for a founder whose key file is not there yet. */
export const keyFileProblem = (keyLocation: string): string => `We could not find your key file. Publish a plain text file at ${keyLocation} that contains only your IndexNow key, then try again.`;

export const IndexNowUrl = z.url({ protocol: /^https$/ }).max(2048);

export const indexNowTools = [
  defineTool({
    name: "submit_urls",
    title: "Tell search engines a page changed",
    description:
      "Tell search engines that these pages of the project's own site are new or changed (IndexNow). Every address must be https and on the connected site's host (and under the key file's folder when the key file is not at the top). Search engines may then fetch the pages sooner; it is not a ranking promise.",
    input: z.object({ urls: z.array(IndexNowUrl).min(1).max(INDEXNOW_MAX_URLS) }),
    output: z.object({ submitted: z.number().int(), host: z.string(), status: z.enum(["received", "pending_key_validation"]), urls: z.array(z.string()) }),
    // It contacts search engines, not a person, costs nothing and is harmless to repeat.
    hints: {},
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    // IndexNow is free (no account, no charge): https://www.indexnow.org/faq, read Nov 12, 2026.
    costMinor: () => 0,
  }),
] as const;

/** IndexNow publishes no numeric limit; it answers 429 for suspected spam, so stay well under what one project needs. */
export const INDEXNOW_RATE_LIMITS = { perMinute: 5, perDay: 200 };

/**
 * The host and key file address a connected integration holds (`config`), or null when it holds none, for the tool and the
 * health check. The key file defaults to `https://<host>/<key>.txt`.
 */
export function indexNowTarget(config: Record<string, unknown>, key: string): { host: string; keyLocation: string } | null {
  const host = normalizeIndexNowHost(config.host);
  if (!host) return null;
  const keyLocation = typeof config.keyLocation === "string" && config.keyLocation ? config.keyLocation : indexNowKeyFileUrl(host, key);
  return { host, keyLocation };
}

/** Every address must be https, on exactly the connected host and under the key file's folder; else `invalid_args` naming it. Before any network call. */
export function assertUrlsOnSite(urls: readonly string[], host: string, keyLocation: string): void {
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AppError("invalid_args", `${url} is not a web address`, 400);
    }
    if (parsed.protocol !== "https:") throw new AppError("invalid_args", `${url} must be an https address`, 400);
    if (parsed.hostname.toLowerCase() !== host || parsed.port || parsed.username || parsed.password) throw new AppError("invalid_args", `${url} is not on ${host}, the site connected to IndexNow`, 400);
    if (!urlCoveredByKeyLocation(url, keyLocation)) throw new AppError("invalid_args", `${url} is outside the folder of the key file (${keyLocation}), so search engines would not accept it`, 400);
  }
}

/** Replace the key wherever text echoes it. */
export const redactKey = (text: string, key?: string): string => (key ? text.split(key).join("…") : text);
