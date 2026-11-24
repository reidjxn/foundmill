/**
 * site_terms_checks (0174): the platform-wide answer to "do this site's terms forbid automated use of a person's own
 * account", one row per host (founder, Nov 24, 2026). Only the service role reaches the table, so callers pass the
 * service connection. A row is fresh for 30 days; an older one reads as absent and is replaced by the next check.
 * A simulated row (mock mode) is never read as a live answer, and a live one never as a simulated one.
 */
import { and, eq, gt } from "drizzle-orm";
import { siteTermsChecks, type SiteNeverCategory, type SiteTermsCheck, type SiteTermsVerdict } from "../schema";
import { maybeOne, type Executor } from "./_shared";

export const SITE_TERMS_FRESH_DAYS = 30;

export interface SiteTermsCheckInput {
  host: string;
  verdict: SiteTermsVerdict;
  line: string | null;
  termsUrl: string | null;
  signInHosts: readonly string[];
  simulated: boolean;
  /** Set when the site is in a category the team never works in: the row is a refusal. */
  neverCategory?: SiteNeverCategory | null;
}

const freshAfter = (now: Date): Date => new Date(now.getTime() - SITE_TERMS_FRESH_DAYS * 86_400_000);

export const siteTermsChecksRepo = {
  /** The fresh check of a host, or null when there is none, it is older than 30 days, or it is of the other mode. */
  async get(db: Executor, host: string, opts: { simulated: boolean; now?: Date }): Promise<SiteTermsCheck | null> {
    return maybeOne(await db.select().from(siteTermsChecks).where(and(eq(siteTermsChecks.host, host.toLowerCase()), eq(siteTermsChecks.simulated, opts.simulated), gt(siteTermsChecks.checkedAt, freshAfter(opts.now ?? new Date())))).limit(1));
  },

  /** Stores or replaces the check of a host. */
  async put(db: Executor, input: SiteTermsCheckInput, now: Date = new Date()): Promise<SiteTermsCheck> {
    const values = { host: input.host.toLowerCase(), verdict: input.verdict, line: input.line?.slice(0, 300) ?? null, termsUrl: input.termsUrl?.slice(0, 500) ?? null, signInHosts: [...input.signInHosts], simulated: input.simulated, neverCategory: input.neverCategory ?? null, checkedAt: now };
    const [row] = await db.insert(siteTermsChecks).values(values).onConflictDoUpdate({ target: [siteTermsChecks.host, siteTermsChecks.simulated], set: values }).returning();
    return row!;
  },
};
