/**
 * One plain sentence for an agent's request (UX plan B5, §5.2 "say the business thing, then the system thing"):
 * "Priya wants to set the LinkedIn Ads budget to £600 a week", composed here from the agent's name, the tool and its
 * arguments. The tool name and the raw arguments stay available behind "Details"; nothing here needs a model call.
 */
import { formatMoney } from "@foundmill/dugout";
import { founderWords, type Money } from "@foundmill/shared";

/** The slice of `inbox.get`'s `approval` the sentence reads. */
export interface RequestLike {
  agent: { name: string } | null;
  /** The tool's key ("set_budget", "merge_pull_request"); older approvals carry it only inside `action`. */
  tool?: string | null;
  connectorKey?: string | null;
  /** "GitHub › run migration": the call as the api names it. */
  action: string;
  /** What the call would send: the arguments as JSON text, a one-line summary, or null when hidden or empty. */
  args: string | null;
  argsHidden?: boolean;
  amount: Money | null;
  amountHidden?: boolean;
}

/** Calls the platform runs inside the business itself (budgets, channels, tasks): no outside service to name. */
const PLATFORM = "platform";

const BRANDS: Record<string, string> = {
  github: "GitHub",
  sendgrid: "SendGrid",
  opencorporates: "OpenCorporates",
  e2b: "E2B",
  ecb_rates: "ECB rates",
  cloudflare_dns: "Cloudflare DNS",
  openai: "OpenAI",
  gemini: "Google Gemini",
  serpapi: "SerpApi",
  indexnow: "IndexNow",
  posthog: "PostHog",
  runway: "Runway",
  elevenlabs_voice: "ElevenLabs",
  buffer: "Buffer",
  dropbox_sign: "Dropbox Sign",
  google_drive: "Google Drive",
  google_calendar: "Google Calendar",
  linkedin: "LinkedIn",
  seo: "SEO",
  tiktok: "TikTok",
  youtube: "YouTube",
  google: "Google",
  meta: "Meta",
  gmail: "Gmail",
  stripe: "Stripe",
  shopify: "Shopify",
  sem: "SEM",
  ppc: "PPC",
  api: "API",
  dns: "DNS",
  pr: "PR",
};

const titleCase = (w: string) => (w ? w[0]!.toUpperCase() + w.slice(1) : w);

/** "GitHub", "Google Calendar" from a connector key. */
export function connectorWords(key: string | null | undefined): string | null {
  if (!key || key === PLATFORM) return null;
  return BRANDS[key] ?? key.split(/[_\s]+/).filter(Boolean).map(titleCase).join(" ");
}

/** "linkedin_ads" → "LinkedIn Ads", "paid_ads" → "paid ads", "seo" → "SEO": a channel or a thing named by its key. */
export function keyWords(key: string): string {
  const words = key
    .trim()
    .split(/[_\s.-]+/)
    .filter(Boolean)
    .map((w) => BRANDS[w.toLowerCase()] ?? w.toLowerCase());
  // "LinkedIn ads" reads as a name: once a brand is in it, the generic word takes its cap too ("LinkedIn Ads").
  const branded = words.some((w) => BRANDS[w.toLowerCase()] !== undefined && /^[A-Z]/.test(w));
  return words.map((w) => (branded && w === "ads" ? "Ads" : w)).join(" ");
}

/** "run_migration" → "run a change to the data layout": the tool's words in the founder's (the shared map, as the api's subject). */
export const toolWords = (tool: string): string => founderWords(tool.replace(/[_.]+/g, " ").trim());

/** The arguments as an object when the api sent them as JSON text; an empty object for a summary line or nothing. */
export function parseArgs(args: string | null | undefined): Record<string, unknown> {
  const text = (args ?? "").trim();
  if (!text.startsWith("{")) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (p: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
};

/** An amount the arguments carry in minor units with a currency; null without both (the api's `amount` wins anyway). */
function argsMoney(p: Record<string, unknown>): Money | null {
  const minor = p.amount_minor ?? p.amountMinor ?? p.budget_minor ?? p.budgetMinor ?? p.cost_minor;
  const currency = typeof p.currency === "string" ? p.currency : null;
  return typeof minor === "number" && minor > 0 && currency ? { amountMinor: minor, currency } : null;
}

/** "a week" / "a month" / "a day" from a period argument, or "" when none. */
function periodWords(p: Record<string, unknown>): string {
  const raw = str(p, "period", "cadence", "per", "interval").toLowerCase();
  if (/^(week|weekly|per_week|per week)$/.test(raw)) return "a week";
  if (/^(month|monthly|per_month|per month)$/.test(raw)) return "a month";
  if (/^(day|daily|per_day|per day)$/.test(raw)) return "a day";
  if (/^(quarter|quarterly)$/.test(raw)) return "a quarter";
  if (/^(year|yearly|annual|annually)$/.test(raw)) return "a year";
  return "";
}

const quoted = (s: string) => `“${s.length > 80 ? `${s.slice(0, 77)}...` : s}”`;

/** The tool key: the approval's own, else read from "GitHub › run migration". */
export function toolKeyOf(r: Pick<RequestLike, "tool" | "action">): string | null {
  if (r.tool?.trim()) return r.tool.trim();
  const after = r.action.split("›")[1]?.trim();
  return after ? after.replace(/\s+/g, "_") : null;
}

/**
 * "Priya wants to set the LinkedIn Ads budget to £600 a week." Known tools get a sentence of their own; anything else
 * reads "<Agent> wants to <tool label>" (with the service it runs on, when there is one). An amount the reader's walls
 * hide is left out, never replaced by a placeholder.
 */
export function describeRequest(r: RequestLike): string {
  const who = r.agent?.name?.trim() || "The team";
  const tool = toolKeyOf(r);
  const p = r.argsHidden ? {} : parseArgs(r.args);
  const money = r.amount ?? (r.amountHidden ? null : argsMoney(p));
  const amount = money ? formatMoney(money) : "";
  const period = periodWords(p);
  const channelKey = str(p, "channel", "channel_key", "channelKey");
  const channel = channelKey ? keyWords(channelKey) : "";
  const service = connectorWords(r.connectorKey);
  switch (tool) {
    case "set_budget": {
      const what = channel ? `the ${channel} budget` : str(p, "department") ? `the ${str(p, "department")} budget` : "the budget";
      return `${who} wants to set ${what}${amount ? ` to ${amount}` : ""}${period ? ` ${period}` : ""}`;
    }
    case "approve_spend": {
      const purpose = str(p, "purpose", "what", "description");
      if (!amount) return `${who} wants to approve a spend${purpose ? ` on ${purpose}` : ""}`;
      return `${who} wants to spend ${amount}${purpose ? ` on ${purpose}` : ""}`;
    }
    case "send_message":
    case "send_email":
    case "send_sms": {
      const kind = tool === "send_email" ? "an email" : tool === "send_sms" ? "a text message" : "a message";
      const to = str(p, "to", "recipient", "recipient_name", "email", "name");
      const subject = str(p, "subject", "topic");
      return `${who} wants to send ${kind}${to ? ` to ${to}` : ""}${subject ? ` about ${quoted(subject)}` : ""}`;
    }
    case "create_task": {
      const title = str(p, "title", "goal", "name");
      return title ? `${who} wants to create the task ${quoted(title)}` : `${who} wants to create a task`;
    }
    case "launch_campaign": {
      // Offline tracking: nothing launches from here; the founder checks the materials and submits them (WP-02 T2).
      if (p.kitMode === true) return `${who} has materials ready for you to check and submit yourself`;
      const name = str(p, "name", "campaign", "title");
      return `${who} wants to launch ${name ? `the campaign ${quoted(name)}` : "a campaign"}${channel ? ` on ${channel}` : ""}${amount ? ` with ${amount}` : ""}`;
    }
    case "enable_channel":
      return `${who} wants to turn on ${channel || "a channel"}`;
    case "disable_channel":
      return `${who} wants to turn off ${channel || "a channel"}`;
    case "schedule_meeting": {
      const with_ = str(p, "with", "attendee", "attendees", "to", "name");
      return `${who} wants to schedule a meeting${with_ ? ` with ${with_}` : ""}`;
    }
    case "hire_agent": {
      const template = str(p, "template", "templateKey", "role");
      return `${who} wants to hire ${template ? `a ${keyWords(template)} agent` : "an agent"}`;
    }
    case "merge_pr":
    case "merge_pull_request":
      // A release, in the founder's words (decision 2026-11-01): the pull request's number is a developer detail.
      return `${who} wants to put a finished change live`;
    default: {
      if (!tool) return `${who} wants to run ${r.action}`;
      const label = toolWords(tool);
      const named = service && label.toLowerCase().includes(service.toLowerCase());
      return `${who} wants to ${label}${service && !named ? ` on ${service}` : ""}${amount ? ` (${amount})` : ""}`;
    }
  }
}
