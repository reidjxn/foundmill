/**
 * Settings › What the team can do (slug `mode`): the pure parts of the page. The spend line's draft (an amount, always
 * ask, or each agent's own limit) and its parsing into `business.setSpendCap`, who answers publishing and messaging
 * (`team.responsibilities.*`), and which agents have their own answer (`agents.autonomy`). The words come from
 * @foundmill/shared `team-can-do.ts`.
 */
import { LIMITS } from "@foundmill/config";
import { BUSINESS_MODES, type BusinessMode, type DecisionType } from "@foundmill/shared/constants";
import { majorToMinor, minorToMajor, minorUnitDigits } from "@foundmill/shared/money";
import { spendLineKind, type SpendLineKind } from "@foundmill/shared/team-can-do";

/** The default limit an agent asks above when the founder set none (LIMITS, the same number Cedar defaults to). */
export const AGENT_LIMIT_MINOR = LIMITS.approvalThresholdMinorDefault;

export interface SpendLineDraft {
  kind: SpendLineKind;
  /** The amount field, in major units as typed ("250"). Kept while another answer is picked, so it comes back. */
  amount: string;
}

/** "250" for 25000 minor GBP, "5000" for 5000 JPY: the field shows major units, without grouping. */
export function amountField(minor: number, currency: string): string {
  const major = minorToMajor(minor, currency);
  return Number.isInteger(major) ? String(major) : major.toFixed(minorUnitDigits(currency));
}

/** The draft the form starts from: the saved line, or the suggestion in the amount field when there is no amount yet. */
export function spendLineDraftOf(lineMinor: number | null, currency: string, suggestionMinor: number): SpendLineDraft {
  const kind = spendLineKind(lineMinor);
  return { kind, amount: kind === "amount" ? amountField(lineMinor as number, currency) : suggestionMinor > 0 ? amountField(suggestionMinor, currency) : "" };
}

export type ParsedSpendLine = { ok: true; minor: number | null } | { ok: false; error: string };

/** The draft as `business.setSpendCap` takes it: an amount in minor units, 0 (always ask) or null (each agent's own). */
export function parseSpendLineDraft(draft: SpendLineDraft, currency: string): ParsedSpendLine {
  if (draft.kind === "always") return { ok: true, minor: 0 };
  if (draft.kind === "agent") return { ok: true, minor: null };
  const s = draft.amount.trim().replace(/[\s,_]/g, "");
  if (!s) return { ok: false, error: "Enter an amount, like 250." };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: "Use a number, like 250." };
  const minor = majorToMinor(Number(s), currency);
  if (minor <= 0) return { ok: false, error: "Use an amount above 0, or choose Always ask." };
  if (!Number.isSafeInteger(minor)) return { ok: false, error: "Use a smaller amount." };
  return { ok: true, minor };
}

/** The toast after a save, in plain words. */
export function spendLineSavedTitle(minor: number | null): string {
  if (minor === null) return "Each agent's own limit applies";
  return minor === 0 ? "Every purchase asks you now" : "Amount saved";
}

/** Who answers when the team asks about publishing or messaging customers, as the page offers it. */
export const DELEGABLE: readonly { decisionType: DecisionType; label: string; hint: string }[] = [
  {
    decisionType: "publish_content",
    label: "Publishing posts, pages and ads",
    // A campaign launch is a publishing decision, budget included (apps/orchestrator channel.ts routes it as one).
    hint: "Includes launching an ad campaign with its budget.",
  },
  { decisionType: "message_customers", label: "Messaging customers and leads", hint: "Emails, replies and messages to people outside the business." },
];

export type AnswerValue = "founder" | "chief";
export type AnswerState =
  | { kind: "choice"; value: AnswerValue }
  /** Departments disagree, or someone other than the founder or the Chief of Staff answers: Team › Responsibilities owns it. */
  | { kind: "elsewhere"; reason: "differs" | "someone_else" };

interface MatrixRow {
  decisionType: DecisionType;
  handler: { kind: "founder" | "user" | "agent"; id: string | null };
  uniform: boolean;
}

/** What one row shows, from `team.responsibilities.get`. */
export function answerState(rows: readonly MatrixRow[] | undefined, decisionType: DecisionType, chiefOfStaffId: string | null | undefined): AnswerState {
  const row = rows?.find((r) => r.decisionType === decisionType);
  if (!row || row.handler.kind === "founder") return row && !row.uniform ? { kind: "elsewhere", reason: "differs" } : { kind: "choice", value: "founder" };
  if (!row.uniform) return { kind: "elsewhere", reason: "differs" };
  if (row.handler.kind === "agent" && chiefOfStaffId && row.handler.id === chiefOfStaffId) return { kind: "choice", value: "chief" };
  return { kind: "elsewhere", reason: "someone_else" };
}

/** The `team.responsibilities.set` handler for an answer (every department: no `departmentId`). */
export function answerHandler(value: AnswerValue, chiefOfStaffId: string): { kind: "founder"; id: null } | { kind: "agent"; id: string } {
  return value === "chief" ? { kind: "agent", id: chiefOfStaffId } : { kind: "founder", id: null };
}

const MODE_ORDER: readonly BusinessMode[] = BUSINESS_MODES;

/**
 * Whether an agent decides differently from the business's answer to question 1 (`agents.autonomy`, read as
 * packages/policy `agentAutonomy` reads it: a mode of its own, or one step lower or higher that moves it), or asks at a
 * limit of its own other than the default.
 */
export function hasOwnAnswer(autonomy: unknown, businessMode: BusinessMode): boolean {
  const raw = (autonomy && typeof autonomy === "object" ? autonomy : {}) as Record<string, unknown>;
  const mode = raw["mode"];
  if (typeof mode === "string" && (MODE_ORDER as readonly string[]).includes(mode) && mode !== businessMode) return true;
  if (mode === "lower" && businessMode !== "augmented") return true;
  if (mode === "higher" && businessMode !== "automated") return true;
  const own = raw["approvalThresholdMinor"];
  return typeof own === "number" && Number.isInteger(own) && own >= 0 && own !== AGENT_LIMIT_MINOR;
}
