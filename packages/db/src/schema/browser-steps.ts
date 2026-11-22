/**
 * 0162 — each write step the team takes in a website through the hosted browser (founder, Nov 22, 2026). Members read;
 * only the services write. Retention and export follow the project's other records (tool_needs, audit_log): the rows
 * are deleted with the project (business_id cascades) and exported without the screenshot bytes (portability.ts).
 */
import { boolean, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bytea, id, timestamps } from "./_common";
import { businessId } from "./_refs";

export const BROWSER_STEP_CLASSES = ["read", "reversible", "outward", "hard_gate", "unknown"] as const;
export type BrowserStepClass = (typeof BROWSER_STEP_CLASSES)[number];

export const browserSteps = pgTable(
  "browser_steps",
  {
    id: id(),
    businessId: businessId(),
    agentId: uuid("agent_id"),
    sessionId: uuid("session_id"),
    siteKey: text("site_key").notNull(),
    tool: text("tool").notNull(),
    target: text("target").notNull(),
    class: text("class", { enum: BROWSER_STEP_CLASSES }).notNull(),
    why: text("why").notNull(),
    url: text("url").notNull(),
    amount: text("amount"),
    /** PNG of the page before the step; may hold other people's personal data. */
    screenshot: bytea("screenshot"),
    simulated: boolean("simulated").notNull().default(false),
    ...timestamps(),
  },
  (t) => [index("browser_steps_session_idx").on(t.businessId, t.sessionId, t.createdAt), index("browser_steps_recent_idx").on(t.businessId, t.createdAt.desc())],
);
export type BrowserStep = typeof browserSteps.$inferSelect;
