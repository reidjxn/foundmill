/**
 * "Add any website" on the api (founder, Nov 24, 2026). The api never reads the web: the gateway reads a site's terms
 * and caches the answer for the whole platform (`site_terms_checks`). This file turns that answer into what the founder
 * sees, and re-validates it on connect: the client names an address and says whether it accepts an unconfirmed site,
 * and nothing else. The site entry is rebuilt here from the cache with the same functions the connector uses, so a
 * forbidden, never or unchecked site is refused whatever the client sends.
 */
import { APP_NAME } from "@foundmill/config";
import { buildWebSite, browserConnectorKey, neverCategoryMessage, STATE_LINE, browserSite, browserSiteOfIntegration, neverMessage, parseSiteAddress, siteNameOf, STARTER_SITES, WEB_SLOT_KEYS, WebSiteRefused, webSlotOf, type BrowserSite, type SiteCheck } from "@foundmill/connectors";
import { repos, type Executor } from "@foundmill/db";
import { AppError, ForbiddenError } from "@foundmill/shared";
import type { ApiGatewayClient } from "./gateway";
import { browserControl } from "./browser";

export const NO_FREE_WEB_SLOT = "Five websites are added already. Disconnect one before adding another.";
export const CHECK_FIRST = "Check the website first, then connect it.";
export const UNCONFIRMED_NOT_ACCEPTED = `${APP_NAME} has not confirmed that this website allows this. Say you understand before connecting it.`;

/** The connected integration (not disconnected, not archived) of each place a typed website can take, with the site it holds. */
export interface WebSlot {
  key: string;
  host: string | null;
  connected: boolean;
}
export async function webSlots(db: Executor, businessId: string): Promise<WebSlot[]> {
  const rows = await repos.integrations.list(db, businessId);
  return WEB_SLOT_KEYS.map((key) => {
    const row = rows.find((r) => r.connectorKey === key);
    const connected = !!row && row.archivedAt === null && row.status !== "disconnected";
    const site = connected ? browserSiteOfIntegration(key, (row!.settings as { config?: unknown } | null)?.config) : null;
    return { key, host: site?.hosts[0] ?? null, connected };
  });
}

/** The place a site goes: the one already holding it (a sign-in again), else the first free one; null when all are used. */
export const slotFor = (slots: WebSlot[], host: string): string | null => slots.find((s) => s.host === host)?.key ?? slots.find((s) => !s.connected)?.key ?? null;

export type SiteAnswer =
  | { status: "refused"; name: string; message: string; quote: string | null; termsUrl: string | null }
  | { status: "ask_first" | "open"; name: string; address: string; line: string; quote: string | null; termsUrl: string | null; simulated: boolean; slotKey: string };

/** "Check this address": the gateway's answer, as the founder reads it. */
export async function checkTypedSite(gateway: ApiGatewayClient, businessId: string, url: string, slots: WebSlot[]): Promise<SiteAnswer> {
  const parsed = parseSiteAddress(url);
  if (!parsed.ok) return { status: "refused", name: url.slice(0, 80), message: parsed.message, quote: null, termsUrl: null };
  const never = neverMessage(parsed.host);
  if (never) return { status: "refused", name: siteNameOf(parsed.host), message: never, quote: null, termsUrl: null };
  const answer = await browserControl(gateway.browserCheckSite ? () => gateway.browserCheckSite!(businessId, url) : null);
  const name = siteNameOf(parsed.host);
  if (!answer.ok) return { status: "refused", name, message: answer.message, quote: null, termsUrl: null };
  const { check } = answer;
  if (check.verdict === "forbids") return { status: "refused", name, message: `${name}'s terms do not allow automated use of an account, so the team cannot work in it.`, quote: check.line, termsUrl: check.termsUrl };
  const slotKey = slotFor(slots, answer.host);
  if (!slotKey) return { status: "refused", name, message: NO_FREE_WEB_SLOT, quote: null, termsUrl: null };
  let site: BrowserSite;
  try {
    site = buildWebSite(webSlotOf(slotKey)!, { address: answer.host, check });
  } catch (e) {
    if (e instanceof WebSiteRefused) return { status: "refused", name, message: e.message, quote: null, termsUrl: null };
    throw e;
  }
  // `line` is always the product's own fixed sentence. What the site's terms say is a quote, shown as one.
  return { status: site.state === "open" ? "open" : "ask_first", name, address: answer.host, line: STATE_LINE[check.verdict === "allows" ? "allows" : "unclear"](name), quote: check.line, termsUrl: check.termsUrl, simulated: answer.simulated, slotKey };
}

/**
 * What the connector is given for a typed website: rebuilt from the cache, never from the client. `acceptUnconfirmed` is
 * the founder's own yes for a site whose terms do not say either way; a refusal here is final.
 */
export async function webConnectInput(db: Executor, slots: WebSlot[], connectorKey: string, input: Record<string, unknown>, simulated: boolean): Promise<{ address: string; check: SiteCheck; done?: true; cancel?: true }> {
  const slot = webSlotOf(connectorKey)!;
  const typed = typeof input.address === "string" ? parseSiteAddress(input.address) : null;
  if (!typed?.ok) throw new AppError("validation", typed?.message ?? "Type the website's address.", 400);
  const never = neverMessage(typed.host);
  if (never) throw new ForbiddenError(never);
  const row = await repos.siteTermsChecks.get(db, typed.host, { simulated });
  if (!row) throw new AppError("check_needed", CHECK_FIRST, 409);
  if (row.neverCategory) throw new ForbiddenError(neverCategoryMessage(typed.host, row.neverCategory) ?? "That site cannot be added.");
  const check: SiteCheck = { verdict: row.verdict, line: row.line, termsUrl: row.termsUrl, signInHosts: row.signInHosts, checkedOn: row.checkedAt.toISOString().slice(0, 10) };
  let site: BrowserSite;
  try {
    site = buildWebSite(slot, { address: typed.host, check });
  } catch (e) {
    if (e instanceof WebSiteRefused) throw new ForbiddenError(e.message);
    throw e;
  }
  const held = slots.find((s) => s.key === connectorKey);
  if (held?.connected && held.host !== typed.host) throw new AppError("slot_in_use", "That place already holds another website. Disconnect it first.", 409);
  if (site.state === "ask_first" && input.cancel !== true && input.acceptUnconfirmed !== true) throw new AppError("terms_unconfirmed", UNCONFIRMED_NOT_ACCEPTED, 409);
  return { address: typed.host, check, ...(input.done === true ? { done: true as const } : {}), ...(input.cancel === true ? { cancel: true as const } : {}) };
}

/** A site's name for a note: the list's, or the typed website's from its integration. */
export async function browserSiteName(db: Executor, businessId: string, siteKey: string): Promise<string> {
  const known = browserSite(siteKey)?.name;
  if (known) return known;
  const key = browserConnectorKey(siteKey);
  if (webSlotOf(key) === null) return siteKey;
  const row = await repos.integrations.getByKey(db, businessId, key);
  return browserSiteOfIntegration(key, (row?.settings as { config?: unknown } | null)?.config)?.name ?? "a website";
}

export interface Starters {
  sites: { name: string; address: string }[];
  /** Starter sites with no fresh check yet: not shown until checked. */
  pending: string[];
}

/** The starter list: only the sites whose fresh check is not "forbids" (founder, Nov 24, 2026). Reads the cache only. */
export async function starterSites(db: Executor, simulated: boolean): Promise<Starters> {
  const sites: Starters["sites"] = [];
  const pending: string[] = [];
  for (const s of STARTER_SITES) {
    const row = await repos.siteTermsChecks.get(db, s.host, { simulated });
    if (!row) pending.push(s.host);
    else if (row.verdict !== "forbids") sites.push({ name: s.name, address: s.host });
  }
  return { sites, pending };
}
