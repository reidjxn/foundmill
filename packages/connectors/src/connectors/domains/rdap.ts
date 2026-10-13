/**
 * The live lookup behind `domains.check_domains`. The registry decides: RDAP (RFC 9082/9083), found through IANA's
 * bootstrap file (RFC 9224). A 200 for `domain/<name>` is a registered name, a 404 is a free one. Anything else (a busy
 * registry, a timeout, an unexpected answer, a registry that sent us to another host) is `unknown` with a reason: the
 * connector never guesses. A TLD with no RDAP server in the bootstrap (.io and .co today) is answered from DNS and said
 * to be an estimate.
 *
 * Nothing but a validated `label.tld` is ever put in a URL, the base URL comes from the bootstrap (https, a host name,
 * no credentials), redirects are not followed except within the registry's own hosts, and each request has a short timeout.
 */
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { parseDomain, type ParsedDomain } from "@foundmill/shared";
import { DEFAULT_USER_AGENT, type FetchLike } from "../../http";
import type { DomainAnswer } from "./tools";

export const IANA_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
/** The bootstrap changes rarely; it is read once a day. */
export const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
export const LOOKUP_TIMEOUT_MS = 3_000;
const MAX_REDIRECTS = 2;
const MAX_BODY_BYTES = 1024 * 1024;
const POOL = 4;

/** The DNS calls the fallback uses (injected in tests). Errors carry node's `code`: ENOTFOUND is NXDOMAIN. */
export interface DnsLike {
  resolveNs(name: string): Promise<string[]>;
  resolveSoa(name: string): Promise<unknown>;
}

export function nodeDns(timeoutMs = LOOKUP_TIMEOUT_MS): DnsLike {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  return { resolveNs: (name) => resolver.resolveNs(name), resolveSoa: (name) => resolver.resolveSoa(name) };
}

interface Bootstrap {
  at: number;
  /** TLD → the registry's RDAP base URLs (https only, with a trailing slash), in the order IANA lists them. */
  byTld: Map<string, URL[]>;
}

/** The base URLs the bootstrap lists for each TLD; entries that are not plain https host names are dropped. */
export function parseBootstrap(json: unknown): Map<string, URL[]> {
  const byTld = new Map<string, URL[]>();
  const services = (json as { services?: unknown })?.services;
  if (!Array.isArray(services)) throw new Error("RDAP bootstrap: no services");
  for (const service of services) {
    if (!Array.isArray(service) || !Array.isArray(service[0]) || !Array.isArray(service[1])) continue;
    const bases: URL[] = [];
    for (const raw of service[1]) {
      const base = registryBase(raw);
      if (base) bases.push(base);
    }
    if (bases.length === 0) continue;
    for (const tld of service[0]) if (typeof tld === "string") byTld.set(tld.toLowerCase(), bases);
  }
  return byTld;
}

function registryBase(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
  if (isIP(url.hostname) || url.hostname.startsWith("[") || !url.hostname.includes(".") || url.hostname === "localhost") return null;
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export interface DomainLookupOptions {
  fetch: FetchLike;
  now: () => Date;
  dns?: DnsLike;
  timeoutMs?: number;
}

export interface DomainLookup {
  /** One answer per domain, in order. Never throws for a single name: a failure is an `unknown` answer. */
  check(domains: readonly string[]): Promise<DomainAnswer[]>;
  /** Warms (or refreshes) the bootstrap; rejects when IANA cannot be read and nothing is cached. */
  ready(): Promise<void>;
}

export function createDomainLookup(options: DomainLookupOptions): DomainLookup {
  const { fetch, now } = options;
  const dns = options.dns ?? nodeDns(options.timeoutMs);
  const timeoutMs = options.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  let bootstrap: Bootstrap | null = null;
  let loading: Promise<Bootstrap> | null = null;

  async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { method: "GET", headers: { accept: "application/rdap+json, application/json", "user-agent": DEFAULT_USER_AGENT }, redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadBootstrap(): Promise<Bootstrap> {
    if (bootstrap && now().getTime() - bootstrap.at < BOOTSTRAP_TTL_MS) return bootstrap;
    loading ??= (async () => {
      try {
        const res = await fetchWithTimeout(IANA_BOOTSTRAP_URL);
        if (!res.ok) throw new Error(`IANA bootstrap answered ${res.status}`);
        bootstrap = { at: now().getTime(), byTld: parseBootstrap(JSON.parse(await readCapped(res))) };
        return bootstrap;
      } catch (e) {
        // A day-old directory is better than none: registries rarely move.
        if (bootstrap) return bootstrap;
        throw e;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  const answer = (domain: string, status: DomainAnswer["status"], extra: Partial<DomainAnswer> & Pick<DomainAnswer, "provenance">): DomainAnswer => ({
    domain,
    status,
    estimate: extra.provenance === "DNS",
    checkedAt: now().toISOString(),
    ...extra,
  });
  const unknown = (domain: string, reason: string, provenance: DomainAnswer["provenance"] = "Registry"): DomainAnswer => answer(domain, "unknown", { provenance, reason });

  async function viaDns(domain: string): Promise<DomainAnswer> {
    const [ns, soa] = await Promise.allSettled([dns.resolveNs(domain), dns.resolveSoa(domain)]);
    if ((ns.status === "fulfilled" && ns.value.length > 0) || soa.status === "fulfilled") {
      return answer(domain, "taken", { provenance: "DNS", reason: "It has DNS records. This TLD has no public registry lookup, so this is an estimate." });
    }
    const code = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason as { code?: string } | undefined)?.code : undefined);
    if (code(ns) === "ENOTFOUND") {
      return answer(domain, "available", { provenance: "DNS", reason: "It has no DNS records. This TLD has no public registry lookup, so this is an estimate; a registrar gives the final answer." });
    }
    return unknown(domain, "This TLD has no public registry lookup and DNS did not give a clear answer.", "DNS");
  }

  async function viaRegistry(parsed: ParsedDomain, bases: URL[]): Promise<DomainAnswer> {
    const { domain } = parsed;
    const hosts = new Set(bases.map((b) => b.host));
    let url = new URL(`domain/${domain}`, bases[0]);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res: Response;
      try {
        res = await fetchWithTimeout(url.toString());
      } catch (e) {
        return unknown(domain, e instanceof Error && e.name === "AbortError" ? "The registry did not answer in time." : "The registry could not be reached.");
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        let next: URL | null;
        try {
          next = location ? new URL(location, url) : null;
        } catch {
          next = null;
        }
        // Only to another URL of the same registry; anything else is not followed (and the body is never read).
        if (!next || next.protocol !== "https:" || next.username || next.password || !hosts.has(next.host)) return unknown(domain, "The registry sent us to another site, which we do not follow.");
        await res.body?.cancel().catch(() => undefined);
        url = next;
        continue;
      }
      return fromStatus(domain, res);
    }
    return unknown(domain, "The registry redirected too many times.");
  }

  async function fromStatus(domain: string, res: Response): Promise<DomainAnswer> {
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return answer(domain, "available", { provenance: "Registry" });
    }
    if (res.status === 200) {
      let body: unknown;
      try {
        body = JSON.parse(await readCapped(res));
      } catch {
        return unknown(domain, "The registry's answer could not be read.");
      }
      if ((body as { objectClassName?: unknown } | null)?.objectClassName !== "domain") return unknown(domain, "The registry's answer was not a domain record.");
      const { registrar, expires } = registrationDetails(body as RdapDomain);
      return answer(domain, "taken", { provenance: "Registry", ...(registrar ? { registrar } : {}), ...(expires ? { expires } : {}) });
    }
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 429) return unknown(domain, "The registry is busy. Try again in a minute.");
    if (res.status >= 500) return unknown(domain, "The registry had an error. Try again in a minute.");
    return unknown(domain, "The registry would not answer for this name.");
  }

  async function checkOne(domain: string, table: Map<string, URL[]> | null): Promise<DomainAnswer> {
    const parsed = parseDomain(domain);
    // The tool's input is validated before it gets here; this keeps the URL builders safe on their own.
    if (!parsed) return unknown(domain, "That is not a domain name we look up.");
    if (!table) return unknown(parsed.domain, "The registry directory (IANA) could not be reached.");
    const bases = table.get(parsed.tld);
    return bases ? viaRegistry(parsed, bases) : viaDns(parsed.domain);
  }

  return {
    async ready() {
      await loadBootstrap();
    },
    async check(domains) {
      const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()))];
      let table: Map<string, URL[]> | null = null;
      try {
        table = (await loadBootstrap()).byTld;
      } catch {
        table = null;
      }
      const results = new Map<string, DomainAnswer>();
      // A few at a time: one request per name, never a burst against one registry.
      for (let i = 0; i < unique.length; i += POOL) {
        await Promise.all(
          unique.slice(i, i + POOL).map(async (d) => {
            try {
              results.set(d, await checkOne(d, table));
            } catch {
              results.set(d, unknown(d, "The lookup failed. Try again."));
            }
          }),
        );
      }
      return domains.map((d) => results.get(d.trim().toLowerCase())!);
    },
  };
}

interface RdapDomain {
  entities?: { roles?: string[]; vcardArray?: unknown }[];
  events?: { eventAction?: string; eventDate?: string }[];
}

/** The registrar's name and the expiry date, when the registry shares them. */
export function registrationDetails(body: RdapDomain): { registrar?: string; expires?: string } {
  const out: { registrar?: string; expires?: string } = {};
  const expiry = body.events?.find((e) => e.eventAction === "expiration")?.eventDate;
  if (typeof expiry === "string" && !Number.isNaN(Date.parse(expiry))) out.expires = new Date(expiry).toISOString().slice(0, 10);
  const registrar = body.entities?.find((e) => Array.isArray(e.roles) && e.roles.includes("registrar"));
  const card = Array.isArray(registrar?.vcardArray) ? (registrar.vcardArray as unknown[])[1] : undefined;
  if (Array.isArray(card)) {
    const fn = card.find((p): p is unknown[] => Array.isArray(p) && p[0] === "fn");
    const name = fn?.[3];
    if (typeof name === "string" && name.trim()) out.registrar = name.trim().slice(0, 120);
  }
  return out;
}

/** The body as text, refusing (and cancelling) an answer larger than a domain record or the bootstrap can be. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("answer too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
