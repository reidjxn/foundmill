/**
 * `browser_steps` (0162; founder, Nov 22, 2026): each write step the team takes in a website through the hosted
 * browser. Services write (`record`); members read under RLS. The lists leave the screenshot bytes out and say whether
 * there is one; `get` returns the step with its PNG.
 */
import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { BROWSER_STEP_CLASSES, browserSteps, type BrowserStep } from "../schema";
import { Id, maybeOne, parseInput, type Executor } from "./_shared";

export const RecordBrowserStepInput = z.object({
  agentId: Id.nullish(),
  sessionId: Id.nullish(),
  siteKey: z.string().trim().min(1).max(200),
  tool: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(500),
  class: z.enum(BROWSER_STEP_CLASSES),
  why: z.string().trim().min(1).max(2000),
  url: z.string().trim().min(1).max(4000),
  amount: z.string().trim().max(200).nullish(),
  screenshot: z.instanceof(Uint8Array).nullish(),
  simulated: z.boolean().default(false),
});
export type RecordBrowserStepInput = z.input<typeof RecordBrowserStepInput>;

/** A step as the lists return it: every column but the PNG, and whether there is one. */
export type BrowserStepListed = Omit<BrowserStep, "screenshot"> & { hasScreenshot: boolean };

const { screenshot, ...withoutScreenshot } = getTableColumns(browserSteps);
const listed = { ...withoutScreenshot, hasScreenshot: sql<boolean>`${screenshot} is not null`.as("has_screenshot") };

export const browserStepsRepo = {
  async record(db: Executor, businessId: string, input: RecordBrowserStepInput): Promise<{ id: string }> {
    const v = parseInput(RecordBrowserStepInput, input, "browser step");
    const [row] = await db
      .insert(browserSteps)
      .values({ businessId, agentId: v.agentId ?? null, sessionId: v.sessionId ?? null, siteKey: v.siteKey, tool: v.tool, target: v.target, class: v.class, why: v.why, url: v.url, amount: v.amount ?? null, screenshot: v.screenshot ?? null, simulated: v.simulated })
      .returning({ id: browserSteps.id });
    return row!;
  },

  /** One step with its screenshot. */
  async get(db: Executor, businessId: string, id: string): Promise<BrowserStep | null> {
    return maybeOne(await db.select().from(browserSteps).where(and(eq(browserSteps.businessId, businessId), eq(browserSteps.id, id))).limit(1));
  },

  /** A session's steps, oldest first. */
  async listForSession(db: Executor, businessId: string, sessionId: string): Promise<BrowserStepListed[]> {
    return db.select(listed).from(browserSteps).where(and(eq(browserSteps.businessId, businessId), eq(browserSteps.sessionId, sessionId))).orderBy(asc(browserSteps.createdAt), asc(browserSteps.id));
  },

  /** The latest steps, newest first, optionally on one site. */
  async listRecent(db: Executor, businessId: string, options: { siteKey?: string; limit: number }): Promise<BrowserStepListed[]> {
    const limit = Math.min(Math.max(Math.trunc(options.limit), 1), 500);
    const where = options.siteKey ? and(eq(browserSteps.businessId, businessId), eq(browserSteps.siteKey, options.siteKey)) : eq(browserSteps.businessId, businessId);
    return db.select(listed).from(browserSteps).where(where).orderBy(desc(browserSteps.createdAt), desc(browserSteps.id)).limit(limit);
  },
};
