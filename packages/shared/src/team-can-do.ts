/**
 * "What the team can do" (Settings, slug `mode`; founder, 2026-11-07): the words for how much the team does before it
 * checks with the founder, shared by the Settings page, the top bar's chip and the tests that hold the words to what the
 * policies enforce (packages/policy `team-can-do.test.ts`). Nothing here decides anything: the business mode
 * (`businesses.business_mode`) and the spend line (`businesses.spend_cap_minor`) are the settings, and the gateway,
 * Inbox plans, the orchestrator and Cedar enforce them. These words only say, truthfully, what those settings do today.
 *
 * The spend line is an upper bound, not a promise to spend: each agent asks above its own limit too (Cedar
 * `principal.approvalThresholdMinor` is the smaller of the two; `effectiveApprovalThresholdMinor` in packages/config),
 * and an agent's own limit is the platform default unless the founder set one on its Autonomy tab. So the words say
 * "asks before spending over £50", which holds whatever the agent's own limit, and never "spends up to £1,000 alone",
 * which does not. The default limit comes in as `agentLimitMinor` (LIMITS.approvalThresholdMinorDefault: this package
 * does not read packages/config).
 *
 * US English, the business's own currency with its narrow symbol ("£50", "kr 50"), no "policy", "cap" or "hard gate".
 */
import type { BusinessMode } from "./constants";
import { formatMoney, minorUnitDigits } from "./money";

/** The tab's title, the breadcrumb and the chip's tooltip all name the page the same way. */
export const TEAM_CAN_DO_TITLE = "What the team can do";

/** Where the setting is changed; the chip's tooltip ends with it so the chip is never a dead end. */
export const TEAM_CAN_DO_SETTINGS_HINT = `Change it in Settings › ${TEAM_CAN_DO_TITLE}.`;

/** Said once, at the top of the page: what no answer on it can change (BUILD §2.2). */
export const TEAM_CAN_DO_ALWAYS_YOURS = "Moving money, signing, filing in your name, accepting terms, deleting for good and changing security settings always come to you. Nothing on this page changes that.";

/** The short form of the same, for the chip's tooltip. */
const ALWAYS_SHORT = "Moving money, signing and filings always come to you.";

/** What a business-mode option promises for each kind of step, checked against Cedar by packages/policy's tests. */
export type TeamCanDoOutcome = "ask" | "allow";
export interface TeamCanDoPromises {
  /** Contacting someone outside the business in a way that can be undone (a send that cannot be undone is `permanent`). */
  outside: TeamCanDoOutcome;
  /** A step that cannot be undone. Putting changes live always asks, whatever this says. */
  permanent: TeamCanDoOutcome;
  /** Spending at or under the line in force (the smaller of the business's line and the agent's own limit). */
  spendWithinLine: TeamCanDoOutcome;
  /** Spending over the business's line: asks in every option. */
  spendOverLine: "ask";
  /** Drafting or changing a contract. Null: the option makes no promise (signing is always the founder's). */
  contract: TeamCanDoOutcome | null;
}

export interface TeamCanDoOption {
  mode: BusinessMode;
  /** The answer as the founder reads it. */
  label: string;
  recommended: boolean;
  promises: TeamCanDoPromises;
}

/** Question 1: the business mode, in plain answers (the mode names stay in the data, not on the page). */
export const TEAM_CAN_DO_QUESTION = "How much should the team do before checking with you?";

export const TEAM_CAN_DO_OPTIONS: readonly TeamCanDoOption[] = [
  { mode: "augmented", label: "Ask me before anything outside the business", recommended: false, promises: { outside: "ask", permanent: "ask", spendWithinLine: "ask", spendOverLine: "ask", contract: null } },
  { mode: "assisted", label: "Routine work alone; ask before big or permanent steps", recommended: true, promises: { outside: "allow", permanent: "ask", spendWithinLine: "allow", spendOverLine: "ask", contract: "ask" } },
  { mode: "automated", label: "Work and decide on its own; the Chief of Staff answers routine questions for you", recommended: false, promises: { outside: "allow", permanent: "allow", spendWithinLine: "allow", spendOverLine: "ask", contract: "allow" } },
];

export const teamCanDoOption = (mode: BusinessMode): TeamCanDoOption => TEAM_CAN_DO_OPTIONS.find((o) => o.mode === mode) ?? TEAM_CAN_DO_OPTIONS[1]!;

/**
 * The spend line a new business is offered per answer (Commit's default, and the page's suggestion): nothing for "ask
 * me first", the agents' default limit for routine work, four times it for "decide on its own".
 */
export function recommendedSpendLineMinor(mode: BusinessMode, agentLimitMinor: number): number {
  if (mode === "augmented") return 0;
  return mode === "automated" ? agentLimitMinor * 4 : agentLimitMinor;
}

/**
 * The line a spend is checked against for an agent with no limit of its own: the business's line, lowered to the
 * agents' default limit (as `effectiveApprovalThresholdMinor` does). Exported for the policy test.
 */
export function spendLineInForceMinor(lineMinor: number | null, agentLimitMinor: number): number {
  return lineMinor === null ? agentLimitMinor : Math.min(lineMinor, agentLimitMinor);
}

/** "£50" for a whole amount, "£50.50" otherwise; the business's own currency and its narrow symbol. */
export function spendAmountWords(amountMinor: number, currency: string): string {
  const whole = amountMinor % 10 ** minorUnitDigits(currency) === 0;
  return formatMoney({ amountMinor, currency }, whole ? { compact: true } : {});
}

export interface SpendLineInput {
  /** `businesses.spend_cap_minor`: an amount, 0 (always ask) or null (each agent's own limit). */
  lineMinor: number | null | undefined;
  /** The business's currency; without it the words name no amount. */
  currency?: string | null;
  /** The agents' default limit (LIMITS.approvalThresholdMinorDefault). */
  agentLimitMinor: number;
}

/** "Each agent's own limit (£250 unless you set one)": the null answer, never read as "no limit". */
export function eachAgentLimitLabel(input: Omit<SpendLineInput, "lineMinor">): string {
  return input.currency ? `Each agent's own limit (${spendAmountWords(input.agentLimitMinor, input.currency)} unless you set one)` : "Each agent's own limit";
}

/** The three answers of question 2, by kind. */
export type SpendLineKind = "amount" | "always" | "agent";
export const spendLineKind = (lineMinor: number | null | undefined): SpendLineKind => (lineMinor === null || lineMinor === undefined ? "agent" : lineMinor === 0 ? "always" : "amount");

/**
 * The sentence under question 2 for an amount above the agents' default limit: the line is an upper bound, and an agent
 * whose own limit is lower asks sooner. Null when the line is at or under the default, or is not an amount.
 */
export function spendLineSoonerNote(input: SpendLineInput): string | null {
  const { lineMinor, currency, agentLimitMinor } = input;
  if (typeof lineMinor !== "number" || lineMinor <= agentLimitMinor || !currency) return null;
  return `An agent still asks above its own limit when that is lower: ${spendAmountWords(agentLimitMinor, currency)} unless you set one on its Autonomy tab.`;
}

/** "before spending over £50" / "before spending anything" / "before spending over each agent's own limit (…)". */
function beforeSpending(input: SpendLineInput, long: boolean): string {
  const kind = spendLineKind(input.lineMinor);
  if (kind === "always") return "before spending anything";
  if (kind === "agent" || !input.currency) {
    if (!long || !input.currency) return "before spending over each agent's own limit";
    return `before spending over each agent's own limit (${spendAmountWords(input.agentLimitMinor, input.currency)} unless you set one)`;
  }
  return `before spending over ${spendAmountWords(input.lineMinor as number, input.currency)}`;
}

export interface TeamCanDoChipWords {
  /** The chip's words at the widest top-bar step: "Asks before spending over £50". */
  label: string;
  /** The chip's words once the bar tightens (KitBarFit `chips-brief`): "Asks over £50". */
  brief: string;
  /** "What the team can do: asks before spending over £50", with the vacation and what comes back. */
  ariaLabel: string;
  /** The stakes in plain words, ending with where to change them. */
  tooltip: string;
}

/** The chip's label and brief form for a mode in force. */
function chipLine(mode: BusinessMode, line: SpendLineInput): { label: string; brief: string } {
  if (mode === "augmented") return { label: "Asks before acting", brief: "Asks first" };
  const kind = spendLineKind(line.lineMinor);
  const amount = kind === "amount" && line.currency ? spendAmountWords(line.lineMinor as number, line.currency) : null;
  if (mode === "assisted") {
    if (kind === "always") return { label: "Asks before any spending", brief: "Asks before spending" };
    if (amount) return { label: `Asks before spending over ${amount}`, brief: `Asks over ${amount}` };
    return { label: "Asks before spending over each agent's limit", brief: "Asks before spending" };
  }
  if (kind === "always") return { label: "Decides alone, asks before any spending", brief: "Asks before spending" };
  if (amount) return { label: `Decides alone, asks over ${amount}`, brief: `Asks over ${amount}` };
  return { label: "Decides alone, asks over each agent's limit", brief: "Decides alone" };
}

/** The tooltip's sentences for a mode in force (without the vacation's opening and closing). */
function stakes(mode: BusinessMode, line: SpendLineInput, holiday: boolean): string {
  const sooner = spendLineKind(line.lineMinor) === "amount" && spendLineSoonerNote(line) && line.currency ? ` An agent asks sooner if its own limit is lower (${spendAmountWords(line.agentLimitMinor, line.currency)} unless you set one).` : "";
  if (mode === "augmented") return `The team prepares the work and asks you before contacting anyone, spending anything or doing what can't be undone. ${ALWAYS_SHORT}`;
  if (mode === "assisted") return `The team does routine work on its own. It asks you ${beforeSpending(line, true)}, before anything it can't undo and before any contract.${sooner} ${ALWAYS_SHORT}`;
  const who = holiday ? "the Chief of Staff decides inside the authority you set" : "the Chief of Staff answers routine questions for you";
  const spend = spendLineKind(line.lineMinor) === "always" ? "Every spend still asks you." : `It still asks you ${beforeSpending(line, true)}.`;
  return `The team works and decides on its own, and ${who}. ${spend}${sooner} ${ALWAYS_SHORT}`;
}

/** Lower-case the first letter: "asks before spending over £50" inside a sentence. */
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The top bar's chip, in plain words, for the mode in force: on vacation that is the vacation's (agents that follow the
 * business decide as in "work and decide on its own", packages/policy `effectiveBusinessMode`), and the label, the
 * aria-label and the tooltip say what comes back with the founder.
 */
export function teamCanDoWords(input: SpendLineInput & { mode: BusinessMode; holiday?: boolean }): TeamCanDoChipWords {
  const holiday = input.holiday === true;
  const inForce: BusinessMode = holiday ? "automated" : input.mode;
  const now = chipLine(inForce, input);
  const back = holiday && input.mode !== "automated" ? chipLine(input.mode, input).label : null;
  const ariaLabel = `${TEAM_CAN_DO_TITLE}: ${lower(now.label)}${holiday ? `, on vacation${back ? `; ${lower(back)} when you come back` : ""}` : ""}`;
  const body = `${stakes(inForce, input, holiday)} ${TEAM_CAN_DO_SETTINGS_HINT}`;
  const tooltip = holiday ? `On vacation. ${body}${back ? ` Back to: ${lower(back)}.` : ""}` : body;
  return { label: now.label, brief: now.brief, ariaLabel, tooltip };
}

/**
 * The description under each answer of question 1, with the business's line in it: what the team does alone and what
 * it asks first. Every claim here is one the option's `promises` make, and the policy test holds them to Cedar.
 */
export function teamCanDoOptionDescription(mode: BusinessMode, line: SpendLineInput): string {
  if (mode === "augmented") return "The team researches, drafts and prepares on its own. It asks you before contacting anyone, spending anything or doing anything it can't undo.";
  if (mode === "assisted") return `The team does routine work on its own. It asks you ${beforeSpending(line, false)}, before anything it can't undo and before any contract. It emails people outside the project on its own.`;
  const spend = spendLineKind(line.lineMinor) === "always" ? "Every spend still asks you" : `It still asks you ${beforeSpending(line, false)}`;
  return `The team works without asking, and the Chief of Staff answers the team's questions in the Inbox for you. ${spend}, and putting changes live in your product still comes to you.`;
}

/**
 * Adding an agent or changing an agent's model, said as it is today (a statement, not a choice): those steps never ask
 * on their own (apps/api services/plans.ts and the orchestrator's plan.ts treat them as internal); they come to the
 * founder as Inbox decisions, which the Chief of Staff answers only in "decide on its own" (the Automated loop's
 * authority, apps/orchestrator automatedMode.ts) and on vacation when the vacation's authority includes them.
 */
export const TEAM_CAN_DO_AGENTS_STATEMENT = "The team suggests it in the Inbox and you decide. When the team works and decides on its own, or while you're on vacation and you included it, the Chief of Staff can decide it for you.";

/** "2 agents have their own setting" (read-only, under the questions). Null when none has. */
export function agentsWithOwnSettingLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 agent has its own setting for how much it does before asking." : `${count} agents have their own setting for how much they do before asking.`;
}
