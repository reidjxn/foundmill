/**
 * The tool scout's vocabulary (founder, Nov 22, 2026: "the most important skill the agents can have is finding the
 * right tool or connector for the founder at the right time"). A project needs a kind of tool (a category) at a moment
 * (a stage); the Chief of Staff answers with one recommendation the founder can act on in one press. The vetted vendors
 * per category are data in `@foundmill/connectors` (`TOOL_CATALOG`); what each kind of business needs and when is on
 * its archetype seed (`needsByStage`, `@foundmill/agents`); what was picked, and "not now", is the `tool_needs` table.
 */

/** The kinds of tool a project can need. New keys go at the end; a key is stored (`tool_needs.category`). */
export const TOOL_CATEGORIES = ["booking", "kyc_identity", "aml_screening", "payments", "subscriptions", "e_signature", "invoicing_accounting", "email", "sms", "forms", "help_desk", "analytics", "shipping", "inventory", "patents_ip"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** What a founder reads for a category, lower case, as it sits in a sentence ("a tool for booking"). */
export const TOOL_CATEGORY_LABELS: Readonly<Record<ToolCategory, string>> = Object.freeze({
  booking: "booking and scheduling",
  kyc_identity: "identity checks (KYC)",
  aml_screening: "money-laundering and sanctions screening (AML)",
  payments: "taking payments",
  subscriptions: "subscriptions",
  e_signature: "signing documents",
  invoicing_accounting: "invoices and accounting",
  email: "email",
  sms: "text messages",
  forms: "forms",
  help_desk: "customer support",
  analytics: "analytics",
  shipping: "shipping",
  inventory: "inventory",
  patents_ip: "patents and IP",
});

/**
 * The moments a need is raised. Timing matters more than completeness: a need is raised at the stage it is first
 * useful, never all at take charge.
 *
 * - `take_charge`: the project is committed (kept short: what the first chapter cannot do without).
 * - `page_drafted`: the project's page gets its first draft.
 * - `first_customers`: distribution starts, so the first outside people are about to arrive (first users, the first
 *   public demo, pre-orders).
 * - `first_payment`: the first real payment arrived.
 *
 * A first person joining and the first outside person's data name no kind of tool yet, so they are not stages here.
 */
export const TOOL_NEED_STAGES = ["take_charge", "page_drafted", "first_customers", "first_payment"] as const;
export type ToolNeedStage = (typeof TOOL_NEED_STAGES)[number];

/** `open`: the scout is on it. `recommended`: the founder has the note. `accepted`: the founder said yes. `not_now`: asked to wait until `ask_again_at`. */
export const TOOL_NEED_STATUSES = ["open", "recommended", "accepted", "not_now"] as const;
export type ToolNeedStatus = (typeof TOOL_NEED_STATUSES)[number];

/** How a tool comes into a project, in order of preference (the vendor's own MCP server, an API key, a link), or Foundmill's own feature. */
export const TOOL_ROUTES = ["foundmill", "remote_mcp", "api_key", "link"] as const;
export type ToolRoute = (typeof TOOL_ROUTES)[number];

/** Days a "Not now" keeps the question away, unless the founder's note names another time. */
export const TOOL_NEED_ASK_AGAIN_DAYS = 30;

/** The recommendation's note: one decision, two options, answered in-process (apps/api `decideToolPickNote`). */
export const TOOL_PICK_NOTE = {
  keyPrefix: "tool_pick:",
  options: { yes: "tool_yes", notNow: "tool_not_now" },
  notNowLabel: "Not now",
} as const;

/** The category of a tool recommendation's decision block (its `decision.key`), or null for any other note. */
export function toolPickCategory(decision: unknown): ToolCategory | null {
  const key = decision && typeof decision === "object" ? (decision as { key?: unknown }).key : null;
  if (typeof key !== "string" || !key.startsWith(TOOL_PICK_NOTE.keyPrefix)) return null;
  const category = key.slice(TOOL_PICK_NOTE.keyPrefix.length);
  return (TOOL_CATEGORIES as readonly string[]).includes(category) ? (category as ToolCategory) : null;
}

/** Money products a regulator licenses. A project with one gets the financial regulation specialist and the KYC and AML needs. */
export const REGULATED_AREAS = ["payments", "lending", "investing", "insurance", "crypto"] as const;
export type RegulatedArea = (typeof REGULATED_AREAS)[number];

// A project that only takes payments for its own product is not a money product: each pattern names moving, holding,
// lending, investing or insuring other people's money.
const REGULATED_PATTERNS: Readonly<Record<RegulatedArea, RegExp>> = {
  payments: /\b(fintech|neobank|money transfers?|remittances?|e-?money|digital wallet|payment (app|processor|platform|service provider)|peer[- ]to[- ]peer payments?|banking app)\b/i,
  lending: /\b(lending|lends? money|loans?|buy now,? pay later|bnpl|credit line|micro-?credit)\b/i,
  investing: /\b(brokerage|robo-?advis[eo]r|investment (app|platform)|stock trading|crowdfunding platform)\b/i,
  insurance: /\b(insurtech|insurance (app|platform|product)|underwrit(e|es|ing))\b/i,
  crypto: /\b(crypto(currency)? (exchange|wallet|custody)|stablecoin|token sale)\b/i,
};

/**
 * The regulated areas a founder's words describe, read at take charge.
 * shortcut: keyword patterns over the idea's text, so an unusual wording is missed (the Legal Lead's first task still
 * covers the rules that apply); upgrade to a classified field on the specification when a project is missed.
 */
export function regulatedAreasOf(text: string): RegulatedArea[] {
  return REGULATED_AREAS.filter((area) => REGULATED_PATTERNS[area].test(text));
}

const INVENTION_PATTERN = /\b(patents?|patentable|novel|invented|inventions?|new (method|process|mechanism|technique)|proprietary (device|formulation|algorithm|mechanism|process)|our own (sensor|formulation|compound|algorithm|mechanism))\b/i;

/**
 * Whether a founder's words describe an invention that could be patented, read at take charge so a patent step is offered
 * before the project is shown in public (showing an invention before filing can cost the right to patent it).
 * shortcut: keyword patterns over the idea's text, so an unusual wording is missed (the Legal Lead's skill still asks
 * about it); upgrade to a classified field on the specification when a project is missed.
 */
export const describesInvention = (text: string): boolean => INVENTION_PATTERN.test(text);
