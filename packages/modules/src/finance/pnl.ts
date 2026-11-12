/**
 * Zod-free finance helpers (months, the chart of accounts and P&L section totals): pure arithmetic that screens outside
 * Finance (the Inbox status strip) can import without pulling in vesting and its schemas. metrics.ts re-exports all of
 * it, so "@foundmill/modules/finance/metrics" keeps working everywhere. The code lives in @foundmill/shared/pnl, so the
 * server's revenue milestones add revenue up with the same function as these screens (DECISIONS 2026-11-11).
 */
export * from "@foundmill/shared/pnl";
