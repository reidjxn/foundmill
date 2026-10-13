/**
 * Attribution (BUILD §11.4).
 *
 * - `parseTouchSource` turns a landing URL / referrer / UTM / click ids / promo, affiliate and offline codes
 *   (QR, vanity URLs, tracking numbers) into a normalised `TouchSource` with a channel key.
 * - `positionBased4020` is the 40 (first) / 20 (middle, shared) / 40 (last) model used until 200 conversions.
 * - `buildMarkovModel` + `dataDriven` implement the Markov removal-effect model used from 200 conversions
 *   (docs/DECISIONS.md "Data-driven attribution: Markov removal effect").
 * - `filterTouchesForConsent` keeps first-party touches only without consent and flags a partial journey.
 */
import { CHANNEL_KEYS, CHANNEL_META, type ChannelKey } from "@foundmill/shared/constants";
import { LIMITS } from "@foundmill/config";
import {
  ClickIds, CLICK_ID_KEYS, TouchSource, Utm,
  type AttributionModel, type ClickIdKey, type CodeKind, type ConsentState, type JourneyChannel, type Touch, type TouchKind,
} from "./types";
import { compareByTimeThenId } from "./time";

// ---------------------------------------------------------------------------------------------------
// Registry (business-configured codes, vanity URLs and tracking numbers)
// ---------------------------------------------------------------------------------------------------

export interface CodeRegistryEntry {
  channelKey: ChannelKey;
  campaignId?: string | null;
  kind: CodeKind;
  label?: string | null;
}

export interface AttributionRegistry {
  /** Promo / affiliate / influencer / offline codes (matched case-insensitively, trimmed). */
  codes?: Record<string, CodeRegistryEntry>;
  /** Vanity URLs: a path ("/tv"), a host ("go.example.com") or host+path ("go.example.com/radio"). */
  vanityUrls?: Record<string, CodeRegistryEntry>;
  /** Tracking phone numbers (compared on digits only). */
  trackingNumbers?: Record<string, CodeRegistryEntry>;
  /** The business's own hosts; a referrer from these is a self-referral and ignored. */
  ownHosts?: readonly string[];
}

export const OFFLINE_CHANNELS: ReadonlySet<ChannelKey> = new Set(CHANNEL_KEYS.filter((k) => CHANNEL_META[k].line === "wings"));

export type TouchMedium =
  | "paid" | "organic_search" | "ai_search" | "social" | "email" | "referral" | "affiliate" | "influencer"
  | "offline" | "direct" | "outbound" | "event" | "content" | "pr" | "unknown";

export interface ParseTouchSourceInput {
  /** Landing URL including the query string. */
  url?: string | null;
  referrer?: string | null;
  utm?: Partial<Record<keyof Utm, string | null | undefined>> | null;
  clickIds?: Partial<Record<ClickIdKey, string | null | undefined>> | null;
  /** A promo / affiliate / influencer / offline code redeemed by the visitor. */
  code?: string | null;
  /** A tracking phone number that was dialled. */
  trackingNumber?: string | null;
  /** Connector that reported the touch (sendgrid, meta_capi, shopify, site ...). */
  provider?: string | null;
  /** Provider event (delivered, open, click, reply, scan, call ...). */
  eventName?: string | null;
  agentId?: string | null;
  label?: string | null;
  registry?: AttributionRegistry;
}

export interface ParsedTouchSource {
  channelKey: ChannelKey | null;
  campaignId: string | null;
  kind: TouchKind;
  medium: TouchMedium;
  source: TouchSource;
  offline: boolean;
  firstParty: boolean;
  /** 0–1: how sure the rule is. */
  confidence: number;
  /** Which rule decided (for the Attribution tab and debugging). */
  rule: string;
}

// ---------------------------------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------------------------------

const norm = (s: string | null | undefined): string | null => {
  if (s == null) return null;
  const t = s.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return t.length ? t : null;
};

/**
 * A table's own entry for an untrusted key: UTM values, providers and event names come from the public internet, and a
 * plain object also answers "constructor", "toString" or "__proto__" with an Object.prototype member.
 */
const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

const UTM_MEDIUM_TO_CHANNEL: Record<string, ChannelKey> = {
  cpc: "paid_ads", ppc: "paid_ads", paid: "paid_ads", paid_search: "paid_ads", paidsearch: "paid_ads", paid_social: "paid_ads",
  paidsocial: "paid_ads", display: "paid_ads", retargeting: "paid_ads", remarketing: "paid_ads", banner: "paid_ads", cpm: "paid_ads",
  cpv: "paid_ads", sem: "paid_ads", ads: "paid_ads", ad: "paid_ads", shopping: "paid_ads", pmax: "paid_ads",
  email: "email_automation", e_mail: "email_automation", newsletter: "email_automation", lifecycle: "email_automation", drip: "email_automation",
  social: "social", organic_social: "social", social_organic: "social",
  affiliate: "affiliate", affiliates: "affiliate", partner: "affiliate", partners: "affiliate", referral_program: "affiliate",
  influencer: "influencer", creator: "influencer", ambassador: "influencer", seeding: "influencer",
  pr: "pr", press: "pr", media: "pr", earned: "pr", review: "pr",
  event: "events", events: "events", conference: "events", webinar: "events", meetup: "events", booth: "events", popup: "events",
  qr: "outdoor", qr_code: "outdoor", qrcode: "outdoor", outdoor: "outdoor", ooh: "outdoor", dooh: "outdoor", billboard: "outdoor",
  print: "print", magazine: "print", newspaper: "print", flyer: "print", leaflet: "print", brochure: "print", insert: "print",
  tv: "broadcast", radio: "broadcast", podcast: "broadcast", ctv: "broadcast", audio: "broadcast", broadcast: "broadcast", streaming_audio: "broadcast",
  direct_mail: "direct_mail", directmail: "direct_mail", mail: "direct_mail", postcard: "direct_mail", letter: "direct_mail", post: "direct_mail",
  content: "content", blog: "content", guide: "content", ebook: "content", whitepaper: "content", video: "content", organic_video: "content",
  organic: "seo", organic_search: "seo", seo: "seo",
  ai: "geo", llm: "geo", geo: "geo", ai_search: "geo", chatgpt: "geo", perplexity: "geo",
  outbound: "lead_generation", sequence: "lead_generation", cold_email: "lead_generation", coldemail: "lead_generation", sdr: "lead_generation",
  lead_gen: "lead_generation", leadgen: "lead_generation", prospecting: "lead_generation",
};

const UTM_SOURCE_TO_CHANNEL: Record<string, ChannelKey> = {
  sendgrid: "email_automation", mailchimp: "email_automation", klaviyo: "email_automation", hubspot: "email_automation", customerio: "email_automation",
  chatgpt: "geo", openai: "geo", perplexity: "geo", claude: "geo", gemini: "geo", copilot: "geo",
  facebook: "social", instagram: "social", linkedin: "social", tiktok: "social", twitter: "social", x: "social", reddit: "social",
  youtube: "social", threads: "social", pinterest: "social",
  partnerstack: "affiliate", rewardful: "affiliate", impact: "affiliate", awin: "affiliate",
  lob: "direct_mail", stannp: "direct_mail", postgrid: "direct_mail",
  spotify: "broadcast", vistar: "outdoor", adquick: "outdoor",
  luma: "events", eventbrite: "events",
  prnewswire: "pr", einpresswire: "pr", qwoted: "pr",
};

const PAID_MEDIA: ReadonlySet<string> = new Set(Object.keys(UTM_MEDIUM_TO_CHANNEL).filter((k) => UTM_MEDIUM_TO_CHANNEL[k] === "paid_ads"));
const ORGANIC_SOCIAL_MEDIA: ReadonlySet<string> = new Set(["social", "organic_social", "social_organic", "organic"]);

const SEARCH_HOSTS = ["google.", "bing.com", "duckduckgo.com", "yahoo.", "ecosia.org", "baidu.com", "yandex.", "qwant.com", "startpage.com", "search.brave.com"];
const AI_HOSTS = ["chatgpt.com", "chat.openai.com", "openai.com", "perplexity.ai", "claude.ai", "gemini.google.com", "bard.google.com", "copilot.microsoft.com", "you.com", "phind.com"];
const SOCIAL_HOSTS = [
  "facebook.com", "fb.com", "instagram.com", "t.co", "twitter.com", "x.com", "linkedin.com", "lnkd.in", "tiktok.com", "youtube.com", "youtu.be",
  "reddit.com", "threads.net", "pinterest.", "snapchat.com", "mastodon.", "bsky.app",
  // Communities count as social: the social agent posts there and the referral is organic.
  "news.ycombinator.com", "producthunt.com", "indiehackers.com", "lobste.rs", "dev.to",
];

/** Providers that name the channel they report for (CRM / event-tool / outbound-tool webhooks without a URL). */
const PROVIDER_TO_CHANNEL: Record<string, ChannelKey> = {
  outbound: "lead_generation", sdr: "lead_generation", sequence: "lead_generation", lead_generation: "lead_generation", leadgen: "lead_generation",
  events: "events", event: "events", luma: "events", eventbrite: "events",
  direct_mail: "direct_mail", lob: "direct_mail", print: "print", broadcast: "broadcast", outdoor: "outdoor",
  affiliate: "affiliate", influencer: "influencer", pr: "pr", social: "social",
};

/** Provider event names for non-email channels. */
const PROVIDER_EVENT_KIND: Record<string, TouchKind> = {
  form_submit: "form_submit", form: "form_submit", lead: "form_submit", badge_scan: "form_submit", registered: "form_submit", attended: "meeting",
  meeting: "meeting", meeting_booked: "meeting", call: "call", called: "call", message: "message", dm: "message", reply: "email_reply", replied: "email_reply",
  scan: "qr_scan", engagement: "social_engagement", like: "social_engagement", comment: "social_engagement", share: "social_engagement", visit: "visit", click: "visit",
};
const WEBMAIL_HOSTS = ["mail.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com", "mail.yahoo.com", "mail.proton.me", "icloud.com"];

/** Prefix heuristics for codes that are not in the registry (the registry is the real path; these are a fallback). */
const CODE_PREFIXES: ReadonlyArray<[prefixes: readonly string[], channel: ChannelKey, kind: CodeKind]> = [
  [["QR"], "outdoor", "qr"],
  [["OOH", "BILLBOARD", "OUTDOOR", "POSTER"], "outdoor", "promo"],
  [["TV", "RADIO", "POD", "PODCAST", "AUDIO", "CTV", "SPOT"], "broadcast", "promo"],
  [["MAIL", "DM", "POSTCARD", "LETTER"], "direct_mail", "promo"],
  [["PRINT", "MAG", "NEWS", "PAPER", "FLYER", "LEAFLET"], "print", "promo"],
  [["AFF", "PARTNER", "REF"], "affiliate", "affiliate"],
  [["INF", "CREATOR", "AMB"], "influencer", "influencer"],
  [["EVENT", "EXPO", "CONF", "BOOTH"], "events", "promo"],
];

/**
 * A host is a pattern's own or a subdomain of it ("t.co" is t.co and l.t.co, never "washingtonpost.com"); a pattern with a
 * trailing dot ("google.") names a brand across its country domains and matches at a label boundary ("google.co.uk",
 * "news.google.com", never "notgoogle.com").
 */
const hostMatches = (host: string, patterns: readonly string[]): boolean =>
  patterns.some((p) => (p.endsWith(".") ? host.startsWith(p) || host.includes(`.${p}`) : host === p || host.endsWith(`.${p}`)));

function parseUrl(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`);
  } catch {
    return null;
  }
}

const stripWww = (host: string): string => host.toLowerCase().replace(/^www\./, "");
const digitsOnly = (s: string): string => s.replace(/\D+/g, "");
const normCode = (s: string): string => s.trim().toUpperCase().replace(/\s+/g, "");

function lookupCode(code: string, registry?: AttributionRegistry): CodeRegistryEntry | null {
  if (!registry?.codes) return null;
  const wanted = normCode(code);
  for (const [k, v] of Object.entries(registry.codes)) if (normCode(k) === wanted) return v;
  return null;
}

/** Digits of a phone number that survive country-code and trunk-prefix differences ("+44 20 …" vs "020 …"). */
const NATIONAL_DIGITS = 9;

/** Same number when the digits are equal, or both are long enough and share their last nine digits. */
function sameNumber(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= NATIONAL_DIGITS && b.length >= NATIONAL_DIGITS && a.slice(-NATIONAL_DIGITS) === b.slice(-NATIONAL_DIGITS);
}

function lookupTrackingNumber(num: string, registry?: AttributionRegistry): CodeRegistryEntry | null {
  if (!registry?.trackingNumbers) return null;
  const wanted = digitsOnly(num);
  if (!wanted) return null;
  for (const [k, v] of Object.entries(registry.trackingNumbers)) if (sameNumber(digitsOnly(k), wanted)) return v;
  return null;
}

function lookupVanity(u: URL | null, registry?: AttributionRegistry): { entry: CodeRegistryEntry; key: string } | null {
  if (!u || !registry?.vanityUrls) return null;
  const host = stripWww(u.hostname);
  const path = u.pathname.replace(/\/+$/, "").toLowerCase() || "/";
  for (const [k, entry] of Object.entries(registry.vanityUrls)) {
    const key = k.trim().toLowerCase();
    if (key.startsWith("/")) {
      if (path === key.replace(/\/+$/, "")) return { entry, key: k };
    } else {
      const slash = key.indexOf("/");
      const kHost = stripWww(slash === -1 ? key : key.slice(0, slash));
      const kPath = slash === -1 ? null : key.slice(slash).replace(/\/+$/, "") || "/";
      if (host === kHost && (kPath === null || kPath === path)) return { entry, key: k };
    }
  }
  return null;
}

function heuristicCode(code: string): { channelKey: ChannelKey; kind: CodeKind } | null {
  const c = normCode(code);
  for (const [prefixes, channelKey, kind] of CODE_PREFIXES) {
    for (const p of prefixes) {
      if (c === p || (c.startsWith(p) && /^[\d_-]/.test(c.slice(p.length)))) return { channelKey, kind };
    }
  }
  return null;
}

const EMAIL_EVENT_KIND: Record<string, TouchKind> = {
  delivered: "email_delivered", processed: "email_delivered", open: "email_open", opened: "email_open", click: "email_click",
  clicked: "email_click", reply: "email_reply", replied: "email_reply", inbound: "email_reply",
};

// ---------------------------------------------------------------------------------------------------
// parseTouchSource
// ---------------------------------------------------------------------------------------------------

export function parseTouchSource(input: ParseTouchSourceInput): ParsedTouchSource {
  const u = parseUrl(input.url);
  const q = u?.searchParams ?? null;

  // UTM: explicit values win over the URL's.
  const utm: Utm = Utm.parse({
    source: input.utm?.source ?? q?.get("utm_source") ?? null,
    medium: input.utm?.medium ?? q?.get("utm_medium") ?? null,
    campaign: input.utm?.campaign ?? q?.get("utm_campaign") ?? null,
    term: input.utm?.term ?? q?.get("utm_term") ?? null,
    content: input.utm?.content ?? q?.get("utm_content") ?? null,
  });
  const clickIdsRaw: Partial<Record<ClickIdKey, string | null>> = {};
  for (const k of CLICK_ID_KEYS) clickIdsRaw[k] = input.clickIds?.[k] ?? q?.get(k) ?? null;
  const clickIds = ClickIds.parse(clickIdsRaw);
  const presentClickIds = CLICK_ID_KEYS.filter((k) => clickIds[k]);

  // Codes carried on the URL when none was passed explicitly.
  let code = input.code ?? null;
  let codeKindHint: CodeKind | null = null;
  if (!code && q) {
    const promo = q.get("code") ?? q.get("promo") ?? q.get("coupon") ?? q.get("discount");
    const aff = q.get("ref") ?? q.get("via") ?? q.get("aff") ?? q.get("affiliate");
    if (promo) code = promo;
    else if (aff) {
      code = aff;
      codeKindHint = "affiliate";
    }
  }

  const referrerUrl = parseUrl(input.referrer);
  let referrerHost = referrerUrl ? stripWww(referrerUrl.hostname) : null;
  const ownHosts = (input.registry?.ownHosts ?? []).map(stripWww);
  if (u) ownHosts.push(stripWww(u.hostname));
  const selfReferral = referrerHost !== null && ownHosts.some((h) => referrerHost === h || referrerHost!.endsWith(`.${h}`));
  if (selfReferral) referrerHost = null;

  const base = {
    utm, referrer: input.referrer ?? null, referrerHost, landingUrl: input.url ?? null, clickIds, code, codeKind: null as CodeKind | null,
    offlineKey: null as string | null, provider: input.provider ?? null, agentId: input.agentId ?? null, label: input.label ?? null,
  };

  const finish = (
    channelKey: ChannelKey | null, kind: TouchKind, medium: TouchMedium, confidence: number, rule: string,
    extra: Partial<typeof base> & { campaignId?: string | null; firstParty?: boolean } = {},
  ): ParsedTouchSource => {
    const { campaignId = null, firstParty, ...sourceExtra } = extra;
    const source = TouchSource.parse({ ...base, ...sourceExtra });
    const offline = channelKey !== null && OFFLINE_CHANNELS.has(channelKey);
    return {
      channelKey, campaignId, kind, medium, source, offline, confidence, rule,
      firstParty: firstParty ?? presentClickIds.length === 0,
    };
  };

  const provider = norm(input.provider);
  const eventName = norm(input.eventName);

  // 1. Email provider events (SendGrid Event Webhook and friends) are unambiguous.
  if (provider && (Object.hasOwn(UTM_SOURCE_TO_CHANNEL, provider) ? UTM_SOURCE_TO_CHANNEL[provider] === "email_automation" : /mail|email/.test(provider))) {
    const kind = (eventName && own(EMAIL_EVENT_KIND, eventName)) || "email_click";
    return finish("email_automation", kind, "email", 0.95, "provider:email", { firstParty: true });
  }

  // 2. Codes: registry first, prefix heuristics second.
  if (code) {
    const entry = lookupCode(code, input.registry);
    if (entry) {
      const kind: TouchKind = entry.kind === "qr" ? "qr_scan" : "code_redeemed";
      return finish(entry.channelKey, kind, OFFLINE_CHANNELS.has(entry.channelKey) ? "offline" : mediumForChannel(entry.channelKey), 0.95, "code:registry", {
        codeKind: entry.kind, campaignId: entry.campaignId ?? null, label: input.label ?? entry.label ?? null, firstParty: true,
      });
    }
    const h = heuristicCode(code);
    if (h) {
      return finish(h.channelKey, h.kind === "qr" ? "qr_scan" : "code_redeemed", OFFLINE_CHANNELS.has(h.channelKey) ? "offline" : mediumForChannel(h.channelKey), 0.6, "code:prefix", {
        codeKind: h.kind, firstParty: true,
      });
    }
    if (codeKindHint === "affiliate") return finish("affiliate", "code_redeemed", "affiliate", 0.7, "code:url_ref_param", { codeKind: "affiliate", firstParty: true });
    // A promo code of unknown origin is still a first-party touch; the channel stays unknown unless UTM/referrer say otherwise.
    const viaUtm = channelFromUtm(utm, presentClickIds);
    if (viaUtm) return finish(viaUtm.channelKey, "code_redeemed", viaUtm.medium, viaUtm.confidence, `code:promo+${viaUtm.rule}`, { codeKind: "promo", firstParty: true });
    return finish(null, "code_redeemed", "unknown", 0.3, "code:unknown", { codeKind: "promo", firstParty: true });
  }

  // 3. Tracking phone numbers (print / broadcast / direct mail response lines).
  if (input.trackingNumber) {
    const entry = lookupTrackingNumber(input.trackingNumber, input.registry);
    if (entry) {
      return finish(entry.channelKey, "call", "offline", 0.95, "tracking_number:registry", {
        codeKind: "tracking_number", offlineKey: input.trackingNumber, campaignId: entry.campaignId ?? null, label: input.label ?? entry.label ?? null, firstParty: true,
      });
    }
    return finish(null, "call", "offline", 0.3, "tracking_number:unknown", { codeKind: "tracking_number", offlineKey: input.trackingNumber, firstParty: true });
  }

  // 4. Vanity URLs ("example.com/tv", "go.example.com").
  const vanity = lookupVanity(u, input.registry);
  if (vanity) {
    return finish(vanity.entry.channelKey, "visit", OFFLINE_CHANNELS.has(vanity.entry.channelKey) ? "offline" : mediumForChannel(vanity.entry.channelKey), 0.9, "vanity_url:registry", {
      codeKind: "vanity_url", offlineKey: vanity.key, campaignId: vanity.entry.campaignId ?? null, label: input.label ?? vanity.entry.label ?? null, firstParty: true,
    });
  }

  // 4b. Providers that name their channel (an events tool, an outbound tool) when nothing on the URL says otherwise.
  const providerChannel = provider ? own(PROVIDER_TO_CHANNEL, provider) : undefined;
  if (providerChannel && presentClickIds.length === 0 && !channelFromUtm(utm, presentClickIds)) {
    const kind: TouchKind = (eventName && own(PROVIDER_EVENT_KIND, eventName)) || (u ? "visit" : "form_submit");
    return finish(providerChannel, kind, OFFLINE_CHANNELS.has(providerChannel) ? "offline" : mediumForChannel(providerChannel), 0.8, `provider:${provider}`, { firstParty: true });
  }

  // 5. QR scans without a code (qr=1, utm_medium=qr, /qr/... paths).
  const isQr = (q?.has("qr") ?? false) || norm(utm.medium) === "qr" || norm(utm.medium) === "qr_code" || (u?.pathname.toLowerCase().startsWith("/qr/") ?? false) || eventName === "scan";
  if (isQr) {
    const viaUtm = channelFromUtm(utm, presentClickIds);
    const channel = viaUtm && OFFLINE_CHANNELS.has(viaUtm.channelKey) ? viaUtm.channelKey : "outdoor";
    return finish(channel, "qr_scan", "offline", viaUtm ? 0.85 : 0.7, "qr", { codeKind: "qr", offlineKey: u?.pathname ?? null, firstParty: true });
  }

  // 6. Ad-platform click ids.
  if (presentClickIds.length) {
    const medium = norm(utm.medium);
    const onlyFb = presentClickIds.length === 1 && presentClickIds[0] === "fbclid";
    if (onlyFb && medium && ORGANIC_SOCIAL_MEDIA.has(medium)) {
      return finish("social", "visit", "social", 0.8, "click_id:fbclid+organic_utm", { firstParty: false });
    }
    const confidence = onlyFb && !(medium && PAID_MEDIA.has(medium)) ? 0.6 : 0.95;
    return finish("paid_ads", "ad_click", "paid", confidence, `click_id:${presentClickIds.join("+")}`, { firstParty: false });
  }

  // 7. UTM.
  const viaUtm = channelFromUtm(utm, presentClickIds);
  if (viaUtm) {
    const kind: TouchKind = viaUtm.channelKey === "email_automation" ? "email_click" : viaUtm.channelKey === "paid_ads" ? "ad_click" : "visit";
    return finish(viaUtm.channelKey, kind, viaUtm.medium, viaUtm.confidence, viaUtm.rule, { firstParty: true });
  }

  // 8. Referrer.
  if (referrerHost) {
    // Webmail and AI assistants first: mail.google.com and gemini.google.com would otherwise match the search pattern.
    if (hostMatches(referrerHost, WEBMAIL_HOSTS)) return finish("email_automation", "email_click", "email", 0.6, "referrer:webmail", { firstParty: true });
    if (hostMatches(referrerHost, AI_HOSTS)) return finish("geo", "visit", "ai_search", 0.9, "referrer:ai", { firstParty: true });
    if (hostMatches(referrerHost, SEARCH_HOSTS)) return finish("seo", "visit", "organic_search", 0.9, "referrer:search", { firstParty: true });
    if (hostMatches(referrerHost, SOCIAL_HOSTS)) return finish("social", "visit", "social", 0.85, "referrer:social", { firstParty: true });
    // Any other site linking to us is coverage: PR owns "referral visits" (CHANNEL_META.pr.coreMetric).
    return finish("pr", "visit", "referral", 0.4, "referrer:other", { firstParty: true });
  }

  // 9. Direct.
  return finish(null, "visit", "direct", 1, "direct", { firstParty: true });
}

function mediumForChannel(channel: ChannelKey): TouchMedium {
  switch (channel) {
    case "paid_ads": return "paid";
    case "seo": return "organic_search";
    case "geo": return "ai_search";
    case "social": return "social";
    case "email_automation": return "email";
    case "affiliate": return "affiliate";
    case "influencer": return "influencer";
    case "lead_generation": return "outbound";
    case "events": return "event";
    case "content": return "content";
    case "pr": return "pr";
    default: return OFFLINE_CHANNELS.has(channel) ? "offline" : "unknown";
  }
}

function channelFromUtm(utm: Utm, presentClickIds: readonly ClickIdKey[]): { channelKey: ChannelKey; medium: TouchMedium; confidence: number; rule: string } | null {
  const medium = norm(utm.medium);
  const source = norm(utm.source);
  if (medium && medium !== "referral") {
    const ch = own(UTM_MEDIUM_TO_CHANNEL, medium);
    if (ch) {
      // utm_medium=social on an ad platform with a click id is paid social; handled by the click-id rule first.
      if (ch === "social" && presentClickIds.length) return { channelKey: "paid_ads", medium: "paid", confidence: 0.8, rule: "utm_medium:social+click_id" };
      return { channelKey: ch, medium: mediumForChannel(ch), confidence: 0.9, rule: `utm_medium:${medium}` };
    }
  }
  if (source) {
    const bySource = own(UTM_SOURCE_TO_CHANNEL, source);
    if (bySource) return { channelKey: bySource, medium: mediumForChannel(bySource), confidence: 0.7, rule: `utm_source:${source}` };
    if (medium === "referral") return { channelKey: "pr", medium: "referral", confidence: 0.5, rule: "utm_medium:referral" };
  }
  if (medium) return { channelKey: "content", medium: "unknown", confidence: 0.3, rule: `utm_medium:unmapped:${medium}` };
  return null;
}

export const hasClickIds = (source: TouchSource): boolean => CLICK_ID_KEYS.some((k) => source.clickIds[k]);

// ---------------------------------------------------------------------------------------------------
// Journey touch selection and consent
// ---------------------------------------------------------------------------------------------------

export interface SelectJourneyTouchesInput {
  touches: readonly Touch[];
  /** The converting entity (person / organisation). */
  entityId: string | null;
  /** Anonymous visitors stitched to that entity at signup / checkout (first-party cookie). */
  visitorIds?: readonly string[];
  /** Conversion time: touches after this instant are not part of the journey. */
  before: string | Date;
  /** Look-back window in days (default 90). */
  lookbackDays?: number;
}

/** Stitches anonymous → identified: every touch of the entity or of its visitors, in the window, sorted. */
export function selectJourneyTouches(input: SelectJourneyTouchesInput): Touch[] {
  const end = typeof input.before === "string" ? Date.parse(input.before) : input.before.getTime();
  const start = end - (input.lookbackDays ?? 90) * 86_400_000;
  const visitors = new Set(input.visitorIds ?? []);
  const seen = new Set<string>();
  const out: Touch[] = [];
  for (const t of input.touches) {
    const ts = Date.parse(t.occurredAt);
    if (ts > end || ts < start) continue;
    const mine = (input.entityId !== null && t.entityId === input.entityId) || (t.visitorId !== null && visitors.has(t.visitorId));
    if (!mine || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out.sort(compareByTimeThenId);
}

export interface ConsentFilterResult {
  touches: Touch[];
  removed: Touch[];
  /** True whenever consent is not granted: the journey shows first-party events only. */
  partialJourney: boolean;
}

/** Without consent, keep first-party touches only (no third-party click ids, no ad-platform reports) and flag the journey partial. */
export function filterTouchesForConsent(touches: readonly Touch[], consent: ConsentState): ConsentFilterResult {
  if (consent === "granted") return { touches: [...touches], removed: [], partialJourney: false };
  const kept: Touch[] = [];
  const removed: Touch[] = [];
  for (const t of touches) (t.firstParty && !hasClickIds(t.source) ? kept : removed).push(t);
  return { touches: kept, removed, partialJourney: true };
}

// ---------------------------------------------------------------------------------------------------
// Position-based 40 / 20 / 40
// ---------------------------------------------------------------------------------------------------

/** 40 % first touch, 40 % last touch, 20 % shared equally by the middle touches. 1 touch → 1; 2 touches → 0.5 each. */
export function positionBased4020(touches: ReadonlyArray<Pick<Touch, "id" | "occurredAt">>): Record<string, number> {
  const sorted = [...touches].sort(compareByTimeThenId);
  const n = sorted.length;
  const weights: Record<string, number> = {};
  if (n === 0) return weights;
  if (n === 1) {
    weights[sorted[0]!.id] = 1;
    return weights;
  }
  if (n === 2) {
    weights[sorted[0]!.id] = 0.5;
    weights[sorted[1]!.id] = 0.5;
    return weights;
  }
  const middle = 0.2 / (n - 2);
  sorted.forEach((t, i) => {
    weights[t.id] = i === 0 || i === n - 1 ? 0.4 : middle;
  });
  return weights;
}

// ---------------------------------------------------------------------------------------------------
// Data-driven: Markov removal effect
// ---------------------------------------------------------------------------------------------------

export type MarkovState = ChannelKey | "direct";
export const MARKOV_STATES: readonly MarkovState[] = [...CHANNEL_KEYS, "direct"];

export interface ConversionPath {
  states: MarkovState[];
  converted: boolean;
}

export interface MarkovModel {
  pathCount: number;
  convertedCount: number;
  /** P(conversion) from the start state with every channel present. */
  baseConversionProbability: number;
  /** Row-stochastic transition probabilities: from → to (to includes "conversion" and "null"). */
  transitions: Record<string, Record<string, number>>;
  /** 1 − P(conversion without the channel) / P(conversion); 0 for channels never observed. */
  removalEffects: Record<MarkovState, number>;
  /** Removal effects normalised to sum to 1 (all zero when no path converts). */
  attribution: Record<MarkovState, number>;
}

export const touchState = (t: Pick<Touch, "channelKey">): MarkovState => t.channelKey ?? "direct";

/** Groups of touches (one group per visitor / entity) → ordered channel paths. */
export function conversionPathsFromTouches(groups: ReadonlyArray<{ touches: ReadonlyArray<Pick<Touch, "id" | "occurredAt" | "channelKey">>; converted: boolean }>): ConversionPath[] {
  return groups.map((g) => ({ states: [...g.touches].sort(compareByTimeThenId).map(touchState), converted: g.converted }));
}

const START = "start";
const CONV = "conversion";
const NULL = "null";

function countTransitions(paths: readonly ConversionPath[]): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  const bump = (from: string, to: string) => {
    let row = counts.get(from);
    if (!row) counts.set(from, (row = new Map()));
    row.set(to, (row.get(to) ?? 0) + 1);
  };
  for (const p of paths) {
    let prev = START;
    for (const s of p.states) {
      bump(prev, s);
      prev = s;
    }
    bump(prev, p.converted ? CONV : NULL);
  }
  return counts;
}

function toProbabilities(counts: Map<string, Map<string, number>>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [from, row] of counts) {
    let total = 0;
    for (const c of row.values()) total += c;
    const probs: Record<string, number> = {};
    for (const [to, c] of row) probs[to] = c / total;
    out[from] = probs;
  }
  return out;
}

/**
 * Absorption probability of reaching `conversion` from `start` in the chain, optionally with one state removed
 * (its inbound transitions redirected to `null`). Solves (I − Q) x = r by Gaussian elimination; ≤ 17 states.
 */
function conversionProbability(transitions: Record<string, Record<string, number>>, removed: string | null): number {
  const transient = Object.keys(transitions).filter((s) => s !== removed);
  if (!transient.includes(START)) return 0;
  const index = new Map(transient.map((s, i) => [s, i] as const));
  const n = transient.length;
  const a: number[][] = transient.map(() => new Array<number>(n + 1).fill(0));
  transient.forEach((from, i) => {
    const row = a[i]!;
    row[i] = 1;
    for (const [to, p] of Object.entries(transitions[from] ?? {})) {
      if (to === removed || to === NULL) continue;
      if (to === CONV) row[n] = (row[n] ?? 0) + p;
      else {
        const j = index.get(to);
        if (j === undefined) continue; // a state with no outgoing row is absorbing into null
        row[j] = (row[j] ?? 0) - p;
      }
    }
  });
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-12) continue;
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const prow = a[col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r]![col]! / prow[col]!;
      if (f === 0) continue;
      const row = a[r]!;
      for (let c = col; c <= n; c++) row[c] = row[c]! - f * prow[c]!;
    }
  }
  const i = index.get(START)!;
  const diag = a[i]![i]!;
  if (Math.abs(diag) < 1e-12) return 0;
  const x = a[i]![n]! / diag;
  return Math.min(1, Math.max(0, x));
}

/** Fit the removal-effect model on the business's conversion paths (converting and non-converting). */
export function buildMarkovModel(paths: readonly ConversionPath[]): MarkovModel {
  const transitions = toProbabilities(countTransitions(paths));
  const base = conversionProbability(transitions, null);
  const removalEffects = Object.fromEntries(MARKOV_STATES.map((s) => [s, 0])) as Record<MarkovState, number>;
  if (base > 0) {
    for (const s of MARKOV_STATES) {
      if (!(s in transitions)) continue;
      const without = conversionProbability(transitions, s);
      removalEffects[s] = Math.max(0, 1 - without / base);
    }
  }
  let total = 0;
  for (const s of MARKOV_STATES) total += removalEffects[s];
  const attribution = Object.fromEntries(MARKOV_STATES.map((s) => [s, total > 0 ? removalEffects[s] / total : 0])) as Record<MarkovState, number>;
  return {
    pathCount: paths.length,
    convertedCount: paths.filter((p) => p.converted).length,
    baseConversionProbability: base,
    transitions,
    removalEffects,
    attribution,
  };
}

/**
 * Data-driven weights for one journey: each channel's removal-effect share is split equally across that channel's
 * touches on the path, then normalised. Returns null when the model has no effect for any channel on the path.
 */
export function dataDrivenWeights(touches: ReadonlyArray<Pick<Touch, "id" | "occurredAt" | "channelKey">>, model: MarkovModel): Record<string, number> | null {
  const sorted = [...touches].sort(compareByTimeThenId);
  if (sorted.length === 0) return {};
  const counts = new Map<MarkovState, number>();
  for (const t of sorted) counts.set(touchState(t), (counts.get(touchState(t)) ?? 0) + 1);
  const raw = sorted.map((t) => (model.attribution[touchState(t)] ?? 0) / counts.get(touchState(t))!);
  let sum = 0;
  for (const r of raw) sum += r;
  if (sum <= 0) return null;
  const weights: Record<string, number> = {};
  sorted.forEach((t, i) => {
    weights[t.id] = raw[i]! / sum;
  });
  return weights;
}

/** Position-based until 200 labelled conversions, data-driven from the 200th (LIMITS.attributionPositionBasedUntilConversions). */
export function chooseModel(conversionCount: number): AttributionModel {
  return conversionCount < LIMITS.attributionPositionBasedUntilConversions ? "position_based_40_20_40" : "data_driven_markov";
}

export interface AttributeOptions {
  /** Preferred model; defaults to chooseModel(conversionCount). */
  model?: AttributionModel;
  conversionCount?: number;
  markov?: MarkovModel | null;
}

export interface AttributionResult {
  weights: Record<string, number>;
  /** The model actually used (data-driven falls back to position-based without a usable Markov model). */
  model: AttributionModel;
  reason: string;
}

export function attribute(touches: ReadonlyArray<Pick<Touch, "id" | "occurredAt" | "channelKey">>, opts: AttributeOptions = {}): AttributionResult {
  const wanted = opts.model ?? chooseModel(opts.conversionCount ?? 0);
  if (wanted === "data_driven_markov") {
    if (!opts.markov) return { weights: positionBased4020(touches), model: "position_based_40_20_40", reason: "no Markov model supplied" };
    const w = dataDrivenWeights(touches, opts.markov);
    if (w) return { weights: w, model: "data_driven_markov", reason: `Markov removal effect over ${opts.markov.pathCount} paths` };
    return { weights: positionBased4020(touches), model: "position_based_40_20_40", reason: "Markov model has no effect for the channels on this path" };
  }
  return { weights: positionBased4020(touches), model: "position_based_40_20_40", reason: `${opts.conversionCount ?? 0} conversions < ${LIMITS.attributionPositionBasedUntilConversions}` };
}

/** Per-channel totals of the touch weights, highest first (the team sheet). */
export function channelWeights(touches: ReadonlyArray<Pick<Touch, "id" | "channelKey">>, weights: Record<string, number>): JourneyChannel[] {
  const acc = new Map<ChannelKey | null, { weight: number; touchCount: number }>();
  for (const t of touches) {
    const cur = acc.get(t.channelKey) ?? { weight: 0, touchCount: 0 };
    cur.weight += weights[t.id] ?? 0;
    cur.touchCount += 1;
    acc.set(t.channelKey, cur);
  }
  return [...acc.entries()]
    .map(([channelKey, v]) => ({ channelKey, weight: v.weight, touchCount: v.touchCount }))
    .sort((a, b) => b.weight - a.weight || (a.channelKey ?? "").localeCompare(b.channelKey ?? ""));
}
