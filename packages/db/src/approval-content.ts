/**
 * What exactly an approval would run (first-time founder report, Nov 8, 2026, P0 "approvals must be decidable"): the
 * files of a code change, the copy and budget of a campaign, the recipient and message of outreach, the vendor and amount
 * of a spend, in rows a founder can read, built from the call's tool and arguments (and, for a campaign, the campaign and
 * its drafts the api loads). `empty` means the agent said nothing about what it would run: the note then asks the founder
 * to send it back for the details instead of asking for a yes.
 */
import { CHANNEL_META, designCheckRows, formatMoney, founderWords, type ChannelKey, type DesignCheckResult } from "@foundmill/shared";
import type { Approval } from "./schema";

export type ApprovalWhatKind = "code" | "release" | "campaign" | "message" | "spend" | "channel" | "other" | "none";

export interface ApprovalWhatRow {
  label: string;
  value: string;
  /** Code, paths, diffs: shown in the mono face. */
  mono?: boolean;
}

export interface ApprovalWhat {
  kind: ApprovalWhatKind;
  /** One line, the founder's words: "A change to how the business's data is stored: 0019_usage_events….sql". */
  headline: string | null;
  rows: ApprovalWhatRow[];
  /** The agent gave nothing that says what would run. */
  empty: boolean;
}

/** What the api loads for a campaign launch (the arguments only name ids). */
export interface ApprovalWhatContext {
  campaign?: { name: string; goal: string; budgetMinor: number | null; currency: string | null } | null;
  assets?: readonly { kind: string; title: string; body: string | null }[];
  /** The task's latest design check (item 13), for a code change or its release: its outcome, fixes and screenshots. */
  designCheck?: DesignCheckResult | null;
}

const CODE_TOOLS = new Set(["run_migration", "commit_files", "push", "push_branch", "open_pr", "open_pull_request", "create_pull_request", "create_branch", "write_file", "apply_patch", "delete_file", "deploy"]);
const RELEASE_TOOLS = new Set(["merge_pr", "merge_pull_request"]);
const CAMPAIGN_TOOLS = new Set(["launch_campaign", "schedule_post", "publish_post", "publish"]);
const MESSAGE_TOOLS = new Set(["send_email", "send_mail", "send_message", "send_sms", "reply", "send_envelope"]);
const SPEND_TOOLS = new Set(["set_budget", "approve_spend", "create_coupon", "create_invoice", "charge", "pay", "create_subscription", "refund"]);
const CHANNEL_TOOLS = new Set(["enable_channel", "disable_channel"]);

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const str = (args: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
};
const list = (args: Record<string, unknown>, ...keys: string[]): string[] => {
  for (const k of keys) {
    const v = args[k];
    if (Array.isArray(v)) {
      const out = v.map((x) => (typeof x === "string" ? x : x && typeof x === "object" && typeof (x as { path?: unknown }).path === "string" ? (x as { path: string }).path : null)).filter((x): x is string => Boolean(x && x.trim()));
      if (out.length) return out;
    }
  }
  return [];
};

/** "channel_key" → "Channel key", "campaignId" → "Campaign id": an argument's key as a label. */
export function argLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s.-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  const text = words.join(" ");
  return text ? text[0]!.toUpperCase() + text.slice(1) : key;
}

/** "paid_ads" → "Paid advertising" from the channel catalog, else the key in words. */
export function channelWords(key: string): string {
  return (CHANNEL_META as Record<string, { label: string }>)[key as ChannelKey]?.label ?? founderWords(key.replace(/[_.-]+/g, " "));
}

const money = (approval: Pick<Approval, "amountMinor" | "currency">, args: Record<string, unknown>): string => {
  if (approval.amountMinor && approval.amountMinor > 0 && approval.currency) return formatMoney({ amountMinor: approval.amountMinor, currency: approval.currency });
  const minor = args.amount_minor ?? args.amountMinor ?? args.budget_minor ?? args.budgetMinor;
  const currency = typeof args.currency === "string" ? args.currency : null;
  return typeof minor === "number" && minor > 0 && currency ? formatMoney({ amountMinor: minor, currency }) : "";
};

/** The arguments not already told, as rows: ids and the session's summary line are left out, long values clipped. */
function restRows(args: Record<string, unknown>, used: ReadonlySet<string>): ApprovalWhatRow[] {
  const rows: ApprovalWhatRow[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (used.has(k) || k === "summary" || /(^|_)id$|Id$|_ids$|Ids$/.test(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "string") rows.push({ label: argLabel(k), value: clip(v, 280) });
    else if (typeof v === "number" || typeof v === "boolean") rows.push({ label: argLabel(k), value: String(v) });
    else if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) rows.push({ label: argLabel(k), value: clip(v.join(", "), 280) });
    else rows.push({ label: argLabel(k), value: clip(JSON.stringify(v), 280), mono: true });
  }
  return rows;
}

export function approvalWhatExactly(approval: Pick<Approval, "connectorKey" | "tool" | "args" | "amountMinor" | "currency">, context: ApprovalWhatContext = {}): ApprovalWhat {
  const args = (approval.args ?? {}) as Record<string, unknown>;
  const tool = approval.tool ?? "";
  const summary = str(args, "summary");
  const amount = money(approval, args);
  const rows: ApprovalWhatRow[] = [];
  const used = new Set<string>();
  const take = (label: string, value: string, keys: string[], mono = false) => {
    keys.forEach((k) => used.add(k));
    if (value) rows.push({ label, value, mono });
  };
  const finish = (kind: ApprovalWhatKind, headline: string | null): ApprovalWhat => {
    rows.push(...restRows(args, used));
    const head = headline || summary || null;
    // The session's own line about the call, when the headline is the kind's sentence rather than that line.
    if (summary && head !== summary) rows.unshift({ label: "What exactly", value: clip(summary, 400), mono: false });
    return { kind: rows.length || head ? kind : "none", headline: head, rows, empty: rows.length === 0 && !head };
  };

  if (RELEASE_TOOLS.has(tool) || CODE_TOOLS.has(tool) || approval.connectorKey === "github" || approval.connectorKey === "e2b") {
    const files = list(args, "files", "paths", "changed_files", "changedFiles");
    const file = str(args, "file", "path", "migration", "filename");
    const title = str(args, "title", "message", "commit_message", "commitMessage", "description");
    take("Files", files.length ? clip(files.join(", "), 400) : file, ["files", "paths", "changed_files", "changedFiles", "file", "path", "migration", "filename"], true);
    take("Branch", str(args, "branch", "head", "ref"), ["branch", "head", "ref", "base"], true);
    take("Change", title, ["title", "message", "commit_message", "commitMessage", "description", "body"]);
    const additions = str(args, "additions");
    const deletions = str(args, "deletions");
    if (additions || deletions) take("Lines", `${additions || "0"} added, ${deletions || "0"} removed`, ["additions", "deletions"]);
    take("Diff", str(args, "diff", "patch") ? clip(str(args, "diff", "patch"), 600) : "", ["diff", "patch"], true);
    used.add("pr").add("pull_request").add("number");
    // The design check is attached to the change, never what makes a request decidable: an empty request stays empty.
    const withDesign = (what: ApprovalWhat): ApprovalWhat => (context.designCheck && !what.empty ? { ...what, rows: [...what.rows, ...designCheckRows(context.designCheck)] } : what);
    if (RELEASE_TOOLS.has(tool)) return withDesign(finish("release", title ? `A finished change goes live: “${clip(title, 120)}”` : "A finished change goes live"));
    // The tool's name alone is not content: a migration with no file and no summary is an empty request.
    if (tool === "run_migration") return finish("code", file || files[0] || summary ? `A change to how the business's data is stored${file || files[0] ? `: ${file || files[0]}` : ""}` : null);
    return withDesign(finish("code", title ? clip(title, 160) : files.length ? `${files.length} file${files.length === 1 ? "" : "s"} change` : null));
  }

  if (CAMPAIGN_TOOLS.has(tool)) {
    const channelKey = str(args, "channelKey", "channel_key", "channel");
    const channel = channelKey ? channelWords(channelKey) : "";
    const c = context.campaign ?? null;
    const name = c?.name || str(args, "name", "campaign", "title");
    take("Channel", channel, ["channelKey", "channel_key", "channel"]);
    take("Campaign", name, ["name", "campaign", "title"]);
    take("Goal", c?.goal || str(args, "goal"), ["goal"]);
    const budget = amount || (c && c.budgetMinor && c.budgetMinor > 0 && c.currency ? formatMoney({ amountMinor: c.budgetMinor, currency: c.currency }) : "");
    take("Budget", budget, ["budget", "budget_minor", "budgetMinor", "amount_minor", "amountMinor", "currency"]);
    used.add("assetIds").add("asset_ids").add("campaignId").add("campaign_id");
    for (const a of context.assets ?? []) rows.push({ label: `${argLabel(a.kind)} draft`, value: clip([a.title, a.body ?? ""].filter(Boolean).join(" — "), 320) });
    const copy = str(args, "copy", "text", "body", "post");
    take("Copy", copy ? clip(copy, 320) : "", ["copy", "text", "body", "post"]);
    const head = name ? `Launch “${clip(name, 80)}”${channel ? ` on ${channel}` : ""}${budget ? ` with ${budget}` : ""}` : channel ? `A campaign on ${channel}${budget ? ` with ${budget}` : ""}` : null;
    return finish("campaign", head);
  }

  if (MESSAGE_TOOLS.has(tool)) {
    const to = str(args, "to", "recipient", "recipient_name", "recipientName", "email", "name", "signer");
    const subject = str(args, "subject", "topic", "title");
    const body = str(args, "body", "text", "message", "content", "html");
    take("To", to, ["to", "recipient", "recipient_name", "recipientName", "email", "name", "signer"]);
    take("Subject", subject, ["subject", "topic", "title"]);
    take("Message", body ? clip(body, 400) : "", ["body", "text", "message", "content", "html"]);
    used.add("from").add("reply_to").add("replyTo");
    return finish("message", to || subject ? `A message${to ? ` to ${to}` : ""}${subject ? ` about “${clip(subject, 80)}”` : ""}` : null);
  }

  if (SPEND_TOOLS.has(tool)) {
    const what = str(args, "purpose", "what", "description", "vendor", "payee", "name", "code", "department");
    const channelKey = str(args, "channelKey", "channel_key", "channel");
    take("What", channelKey ? `${channelWords(channelKey)}${what ? `: ${what}` : ""}` : what, ["purpose", "what", "description", "vendor", "payee", "name", "code", "department", "channelKey", "channel_key", "channel"]);
    take("Amount", amount, ["amount_minor", "amountMinor", "budget_minor", "budgetMinor", "currency", "amount"]);
    take("Period", str(args, "period", "cadence", "per", "interval"), ["period", "cadence", "per", "interval"]);
    return finish("spend", amount ? `${amount}${what || channelKey ? ` for ${channelKey ? channelWords(channelKey) : what}` : ""}` : null);
  }

  if (CHANNEL_TOOLS.has(tool)) {
    const channelKey = str(args, "channelKey", "channel_key", "channel");
    take("Channel", channelKey ? channelWords(channelKey) : "", ["channelKey", "channel_key", "channel"]);
    return finish("channel", channelKey ? `${tool === "enable_channel" ? "Turn on" : "Turn off"} ${channelWords(channelKey)}` : null);
  }

  return finish("other", null);
}

/** The note a founder's "Ask for the details" sends when they typed nothing (the agent reads it as its reason). */
export const ASK_FOR_DETAILS_NOTE = "Describe exactly what you would run (the files, the recipients, the copy, the amounts), then ask again.";
