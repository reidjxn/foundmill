/**
 * The live page reader behind `web.fetch`: address checks (no private, loopback, link-local or reserved targets, on
 * every redirect hop), robots.txt (RFC 9309: the most specific group for our token or `*`, longest match wins, an
 * unreachable robots.txt means "do not read"), a size and time cap, and HTML → readable text. Pure helpers are exported
 * for tests; nothing here logs page content.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@foundmill/shared";
import type { FetchLike } from "../../http";
import { WEB_ROBOTS_TOKEN, WEB_USER_AGENT, type WebPage } from "./tools";

export type HostLookup = (hostname: string) => Promise<string[]>;

export const defaultLookup: HostLookup = async (hostname) => (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

const MAX_REDIRECTS = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const ROBOTS_MAX_BYTES = 256 * 1024;
const READABLE_TYPES = /^(text\/(html|plain|markdown|csv|xml)|application\/(xhtml\+xml|xml|json|ld\+json))\b/i;

// ---------------------------------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------------------------------

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255) ? parts : null;
}

/** True only for globally routable unicast addresses (what a public web page can live on). */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = ipv4Parts(ip) ?? [];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this-network, private, loopback, multicast/reserved
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false; // benchmarking, documentation
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (lower === "::" || lower === "::1") return false;
    const first = Number.parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (lower.startsWith("2001:db8:") || lower.startsWith("64:ff9b:") || lower.startsWith("100::")) return false;
    // Transition prefixes that carry an IPv4 address inside (6to4 2002::/16, Teredo 2001:0::/32): never a public page's home.
    if (first === 0x2002 || /^2001:0{0,4}:/.test(lower)) return false;
    return (first & 0xe000) === 0x2000; // global unicast 2000::/3
  }
  return false;
}

/** Refuses anything but a public http(s) URL on a standard port whose host resolves only to public addresses. */
export async function assertPublicUrl(raw: string, lookup: HostLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("invalid_url", "That is not a link", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AppError("blocked_url", "Only http and https pages are read", 400);
  if (url.username || url.password) throw new AppError("blocked_url", "Links with credentials are never followed", 400);
  if (url.port && url.port !== "80" && url.port !== "443") throw new AppError("blocked_url", "Only the standard web ports are read", 400);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new AppError("blocked_address", "Local addresses are never read", 400);
  const addresses = isIP(host) ? [host] : await lookup(host).catch(() => [] as string[]);
  if (addresses.length === 0) throw new AppError("not_found", `${host} does not resolve`, 404);
  if (!addresses.every(isPublicAddress)) throw new AppError("blocked_address", "Private or local addresses are never read", 400);
  return url;
}

// ---------------------------------------------------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------------------------------------------------

interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value || field === "allow") current.rules.push({ allow: field === "allow", path: value });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  return groups;
}

function ruleMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/** Whether `token` may read `pathWithQuery` under these rules (RFC 9309 §2.2: longest match wins; allow wins a tie). */
export function robotsAllows(txt: string, token: string, pathWithQuery: string): boolean {
  const groups = parseRobots(txt);
  const t = token.toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && t.includes(a)));
  const applicable = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (!ruleMatches(rule.path, pathWithQuery)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", euro: "€", pound: "£", copy: "©", reg: "®", trade: "™" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Title, description and readable text of an HTML document (no DOM; scripts, styles and hidden templates dropped). */
export function htmlToText(html: string): { title: string | null; description: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const description = /<meta\s[^>]*name=["']description["'][^>]*>/i.exec(html)?.[0].match(/content=["']([^"']*)["']/i)?.[1];
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|head|nav|footer|form)\b[\s\S]*?<\/\1\s*>/gi, " ");
  body = body.replace(/<(br|hr)\b[^>]*>/gi, "\n").replace(/<\/?(p|div|section|article|main|header|aside|li|ul|ol|tr|table|h[1-6]|blockquote|pre|dd|dt|figure|figcaption)\b[^>]*>/gi, "\n\n");
  const text = decodeEntities(body.replace(/<[^>]*>/g, " "))
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  return { title: title ? clean(title) || null : null, description: description ? clean(description) || null : null, text };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------------------------------------------------

export interface PageReaderOptions {
  fetch: FetchLike;
  lookup: HostLookup;
  now: () => Date;
  timeoutMs?: number;
}

async function readCapped(res: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  if (!res.body) return { body: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.slice(0, maxBytes - size));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  return { body: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)), truncated };
}

export function createPageReader(options: PageReaderOptions) {
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function get(url: URL, accept: string, signal: AbortSignal): Promise<Response> {
    try {
      return await options.fetch(url.toString(), { method: "GET", redirect: "manual", signal, headers: { "user-agent": WEB_USER_AGENT, accept } });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new AppError("timeout", `${url.host} did not answer in time`, 504);
      throw new AppError("unreachable", `${url.host} could not be reached`, 502);
    }
  }

  /** robots.txt for one origin: rules text, `null` when there is none, or a refusal when it cannot be read. */
  async function robotsFor(origin: URL, signal: AbortSignal): Promise<string | null> {
    const robotsUrl = new URL("/robots.txt", origin);
    let res: Response;
    try {
      res = await get(robotsUrl, "text/plain", signal);
    } catch {
      throw new AppError("robots_unreachable", `${origin.host}'s robots.txt could not be read, so the page is not read`, 503);
    }
    if (res.status >= 300 && res.status < 400) {
      // One redirect is followed (http → https, a canonical host), on public addresses only.
      const location = res.headers.get("location");
      if (!location) return null;
      const next = await assertPublicUrl(new URL(location, robotsUrl).toString(), options.lookup);
      res = await get(next, "text/plain", signal);
    }
    if (res.status >= 400 && res.status < 500) return null; // RFC 9309 §2.3.1.3: unavailable means no restrictions
    if (!res.ok) throw new AppError("robots_unreachable", `${origin.host}'s robots.txt could not be read, so the page is not read`, 503);
    return (await readCapped(res, ROBOTS_MAX_BYTES)).body;
  }

  return async function read(rawUrl: string, maxChars: number): Promise<WebPage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const robotsByOrigin = new Map<string, string | null>();
      let url = await assertPublicUrl(rawUrl, options.lookup);
      let robots: WebPage["robots"] = "no_robots_txt";
      for (let hop = 0; ; hop++) {
        if (!robotsByOrigin.has(url.origin)) robotsByOrigin.set(url.origin, await robotsFor(url, controller.signal));
        const rules = robotsByOrigin.get(url.origin);
        if (rules !== null && rules !== undefined) {
          if (!robotsAllows(rules, WEB_ROBOTS_TOKEN, `${url.pathname}${url.search}`)) throw new AppError("robots_disallowed", `${url.host}'s robots.txt does not allow reading this page`, 403);
          robots = "allowed";
        }
        const res = await get(url, "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", controller.signal);
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location || hop >= MAX_REDIRECTS) throw new AppError("too_many_redirects", "The page redirects too many times", 508);
          url = await assertPublicUrl(new URL(location, url).toString(), options.lookup);
          continue;
        }
        if (res.status === 401 || res.status === 403) throw new AppError("login_required", "The page needs a login; it is never bypassed", 403);
        if (!res.ok) throw Object.assign(new Error(`${url.host} answered ${res.status}`), { status: res.status });
        const contentType = res.headers.get("content-type");
        if (contentType && !READABLE_TYPES.test(contentType)) throw new AppError("unsupported_content", `The page is ${contentType.split(";")[0]}, not readable text`, 415);
        const { body, truncated: cut } = await readCapped(res, MAX_BYTES);
        const isHtml = !contentType || /html|xml/i.test(contentType) || /<html[\s>]/i.test(body.slice(0, 2000));
        const page = isHtml ? htmlToText(body) : { title: null, description: null, text: body.replace(/\r\n/g, "\n").trim() };
        const truncated = cut || page.text.length > maxChars;
        return { url: rawUrl, finalUrl: url.toString(), status: res.status, contentType, title: page.title, description: page.description, text: page.text.slice(0, maxChars), truncated, fetchedAt: options.now().toISOString(), robots };
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
