/**
 * Mock founder titles: the deterministic rewrite of packages/shared `founderPhrase`, cut to ten words, for every task in
 * the request. What a mock-mode founder reads on the Plan is therefore exactly what the api writes when the composer is
 * away, and the eval over runtime founder strings runs the same rules over it.
 */
import { founderTitleFallback } from "@foundmill/shared";
import type { FounderTitlesOutput } from "../schemas";
import { type MockContext, isRecord } from "./inputs";

export function generateFounderTitles(ctx: MockContext): FounderTitlesOutput {
  const raw = ctx.getArray<unknown>("tasks", "items", "titles");
  const titles: FounderTitlesOutput["titles"] = [];
  for (const t of raw) {
    if (!isRecord(t)) continue;
    const id = typeof t.id === "string" ? t.id : typeof t.task_id === "string" ? t.task_id : null;
    const technical = typeof t.title === "string" ? t.title : typeof t.name === "string" ? t.name : null;
    if (!id || !technical) continue;
    const goal = typeof t.goal === "string" ? t.goal : "";
    // A task the rewrite cannot title within the rules is left out, as a careful model would leave it: the composer then
    // keeps the technical title and asks again next time.
    const title = founderTitleFallback(technical) ?? founderTitleFallback(goal.split(/(?<=[.!?])\s|\n/)[0] ?? "");
    if (title) titles.push({ id, title });
  }
  return { titles };
}
