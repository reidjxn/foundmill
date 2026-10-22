/**
 * A small definitions map for stories and tests (the app passes `TERMS` from @foundmill/shared through the business
 * glossary; see docs/UX_AUDIT_AND_PLAN.md §6.1). Keyed by stable id, never by the display word.
 */
import type { TermDefinition } from "./GuidanceProvider";

export const FIXTURE_TERMS: Record<string, TermDefinition> = {
  runway: {
    id: "runway",
    word: "Runway",
    short: "How many months your cash lasts at today's spending.",
    long: "Cash in the bank divided by what you spend more than you earn each month. Estimated until a bank is connected.",
    learn: "finance/runway",
  },
  cycle: {
    id: "cycle",
    word: "Cycle",
    short: "One round of work: the team works for a while, then reports back in the Inbox.",
    long: "Press Continue to run one. What the team needs from you comes back as notes.",
  },
  estimate: {
    id: "estimate",
    word: "Estimate",
    short: "Worked out, not measured.",
    long: "A figure the team calculated from what it knows so far. It becomes a measurement once the real number arrives.",
    learn: "settings/integrations",
  },
  forecast: {
    id: "forecast",
    word: "Forecast",
    short: "A projection of what could happen, not a measurement.",
    long: "Drawn from today's numbers and a few assumptions. Save a scenario in Finance to keep one.",
  },
  mrr: {
    id: "mrr",
    word: "MRR",
    short: "Monthly recurring revenue: what subscriptions bring in each month.",
    learn: "https://example.com/mrr",
  },
};
