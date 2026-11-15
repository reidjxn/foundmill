/**
 * Mock goal revision (founder, 2026-11-07): the founder's "Change it" words read by packages/shared `parseGoalWords`, the
 * same deterministic reader the api falls back to when the model does not answer. What a mock-mode founder sees after
 * "20 customers by Jan 31" is therefore exactly what the api writes without a model.
 *
 * Input (apps/api services/goals.ts): `{ founder_words, today, currency, current: { kind, target, due_on, custom_words } }`,
 * where a revenue target is in whole units of the business's currency.
 */
import { GOAL_METRIC_KINDS, addDaysToDay, majorToMinor, minorToMajor, parseGoalWords, type GoalMetricKind, type GoalShape } from "@foundmill/shared";
import type { GoalProposalOutput } from "../schemas";
import type { MockContext } from "./inputs";

const isKind = (v: unknown): v is GoalMetricKind => typeof v === "string" && (GOAL_METRIC_KINDS as readonly string[]).includes(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function generateGoalProposal(ctx: MockContext): GoalProposalOutput {
  const todayRaw = ctx.getString("today");
  const today = todayRaw && DAY.test(todayRaw) ? todayRaw : new Date().toISOString().slice(0, 10);
  const currency = (ctx.getString("currency") ?? "USD").toUpperCase().slice(0, 3);
  const current = ctx.getRecord("current", "goal", "proposal") ?? {};
  const kind: GoalMetricKind = isKind(current.kind) ? current.kind : "paying_customers";
  const rawTarget = typeof current.target === "number" && current.target > 0 ? current.target : kind === "custom" ? null : 10;
  const dueOn = typeof current.due_on === "string" && DAY.test(current.due_on) ? current.due_on : addDaysToDay(today, 42);
  const customWords = typeof current.custom_words === "string" ? current.custom_words : null;
  const base: GoalShape = { kind, target: rawTarget === null ? null : kind === "revenue_month" ? majorToMinor(rawTarget, currency) : rawTarget, currency: kind === "revenue_month" ? currency : null, dueOn, text: customWords };
  const words = ctx.getString("founder_words", "words", "change_request") ?? "";
  const next = parseGoalWords(words, { base, today, currency });
  const shape = next ?? base;
  const target = shape.target === null ? null : shape.kind === "revenue_month" ? minorToMajor(shape.target, currency) : shape.target;
  return { changed: next !== null, kind: shape.kind, target, due_on: shape.dueOn, custom_words: shape.kind === "custom" ? (shape.text ?? null) : null };
}
