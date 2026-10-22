/**
 * Mock moderation / pre-send checker (BUILD §2.3 honest-agent code): flags claims to be human, fabricated urgency,
 * fake testimonials, unsubstantiated claims, missing unsubscribe or sender identity on marketing email, PII exposure,
 * harassment and prohibited automation.
 */
import type { Severity } from "@foundmill/shared";
import type { ModerationOutput } from "../schemas";
import type { MockContext } from "./inputs";

type Category = ModerationOutput["flags"][number]["category"];

const RULES: Array<{ category: Category; severity: Severity; re: RegExp; unless?: RegExp }> = [
  { category: "claims_to_be_human", severity: "critical", re: /\b(?:i am|i'm|i’m)\s+(?:a\s+)?(?:real\s+)?(?:human|person)\b|\bnot\s+(?:a|an)\s+(?:bot|ai|robot|machine)\b|\bas\s+a\s+(?:fellow\s+)?human\b|\bwritten\s+by\s+a\s+human\b/i },
  { category: "fabricated_urgency", severity: "normal", re: /\bonly\s+\d+\s+(?:left|remaining|spots?|seats?|units?)\b|\bact\s+now\b|\blast\s+chance\b|\b(?:offer|sale|price)\s+(?:ends|expires)\s+(?:today|tonight|at\s+midnight|in\s+\d+\s+(?:hours?|minutes?))\b|\bhurry\b|\blimited\s+time\s+(?:only|offer)\b|\bdon'?t\s+miss\s+out\b/i, unless: /\(source:|\[source|\bref:|\bevidence:|\bsee\s+record\b/i },
  { category: "fake_testimonial", severity: "critical", re: /["“][^"”]{15,}["”]\s*[-—–]\s*(?:a\s+)?(?:happy|satisfied|delighted|loyal)?\s*(?:customer|user|client|founder)\b|\btestimonials?\b(?![^.\n]*\b(?:record|id|source|consent)\b)|\b(?:five|5)[- ]star\s+reviews?\s+from\s+(?:our\s+)?(?:happy\s+)?customers\b/i, unless: /\(source:|\[source|\bref:|\brecord\s+id\b|\bwith\s+permission\b/i },
  { category: "unsubstantiated_claim", severity: "normal", re: /\b(?:#1|number\s+one|best\s+in\s+the\s+world|world'?s\s+best|guaranteed\s+results?|clinically\s+proven|doctors?\s+recommend|cures?\b|100%\s+(?:safe|effective|natural|guaranteed)|no\s+side\s+effects|scientifically\s+proven)\b/i, unless: /\(source:|\[source|\bref:|\bevidence:|\bstudy\s+id\b/i },
  { category: "pii_exposure", severity: "critical", re: /\b(?:\d[ -]?){13,19}\b|\b\d{3}-\d{2}-\d{4}\b|\biban\s*[:#]?\s*[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}\b/i },
  { category: "harassment", severity: "normal", re: /\b(?:idiot|stupid|moron|loser|shut\s+up|i\s+hate\s+you|pathetic|worthless)\b/i },
  { category: "prohibited_automation", severity: "critical", re: /\b(?:solve\s+(?:the\s+)?captcha|bypass\s+(?:the\s+)?(?:login|paywall|captcha)|scrap(?:e|ing)\s+(?:against|despite)|evade\s+(?:the\s+)?(?:login|detection)|fake\s+reviews?|sock\s+puppets?|undisclosed\s+(?:paid\s+)?endorsement)\b/i },
];

const EMAIL_KIND = /^(?:email|newsletter|marketing_email|broadcast_email|sequence|mailer|cold_email)$/i;

export function generateModeration(ctx: MockContext): ModerationOutput {
  const text = ctx.getString("text", "content", "message", "draft", "body", "copy") ?? ctx.lastUser.replace(/```[\s\S]*?```/g, " ");
  const kind = ctx.getString("kind", "asset_kind", "channel", "type") ?? inferKind(text);
  const audience = ctx.getString("audience", "recipient_kind") ?? "";
  const flags: ModerationOutput["flags"] = [];

  for (const r of RULES) {
    const m = r.re.exec(text);
    if (!m) continue;
    if (r.unless && r.unless.test(text)) continue;
    flags.push({ category: r.category, severity: r.severity, excerpt: excerpt(text, m.index, m[0].length) });
  }

  const isEmail = EMAIL_KIND.test(kind) || /\bsubject:/i.test(text);
  const marketing = isEmail && !/\b(?:transactional|receipt|invoice|password reset|verification code)\b/i.test(`${kind} ${audience}`);
  if (marketing && !/unsubscribe|opt[- ]?out|manage (?:your )?preferences|stop receiving/i.test(text)) {
    flags.push({ category: "missing_unsubscribe", severity: "critical", excerpt: "No unsubscribe or opt-out line found in a marketing email." });
  }
  if (isEmail && !/\bon behalf of\b|\bsent by\b|\bfrom the team at\b|\bthe team at\b|\b(?:ltd|inc|gmbh|ab|llc|limited)\b|\bregistered (?:office|address)\b|\bthis (?:email|message) was (?:sent|drafted) by an (?:ai|agent)\b/i.test(text)) {
    flags.push({ category: "missing_sender_identity", severity: "normal", excerpt: "No sender identity or on-behalf-of line found." });
  }

  const order: Record<Severity, number> = { critical: 0, normal: 1, low: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  const critical = flags.filter((f) => f.severity === "critical").length;
  const allowed = critical === 0;
  const rationale = allowed
    ? flags.length === 0
      ? "No honest-agent or marketing-law issues found; safe to send once policy checks pass."
      : `Allowed with ${flags.length} advisory flag${flags.length === 1 ? "" : "s"} (${flags.map((f) => f.category).join(", ")}); fix before sending if you can.`
    : `Blocked: ${critical} critical flag${critical === 1 ? "" : "s"} (${flags.filter((f) => f.severity === "critical").map((f) => f.category).join(", ")}). The rules every agent follows forbid sending this as written.`;
  return { allowed, flags, rationale };
}

function inferKind(text: string): string {
  if (/^subject:/im.test(text) || /\bdear\b|\bhi\s+\w+,/i.test(text)) return "email";
  if (/#\w+/.test(text) && text.length < 600) return "post";
  return "text";
}

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}
