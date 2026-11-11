/**
 * project_mail (0078): the local part a project sends from at the Foundmill sending domain (package 1.5).
 *
 * Written on the service connection only: `ensure` chooses the local part the first time it is needed (the gateway's
 * first send, or Settings › Integrations first showing it) and every later call returns the same row, so the address
 * never moves even when the page's address does (the table's guard trigger refuses a change). Members read their own
 * row through RLS (`get` inside `withRls`). `resolve.byLocalPart` is the one read without a business: ingest finds the
 * project an inbound reply is addressed to. `setDailyCap` and `setStatus` are an operator's (docs/DEPLOY.md §5.7).
 */
import { isMailLocalPart, MAIL_LOCAL_PART_PATTERN, suffixPageSlug, suggestPageSlug } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { businesses, projectMail, projectPages, type ProjectMail, type ProjectMailStatus } from "../schema";
import { maybeOne, uniqueViolation, type Executor } from "./_shared";

const LOCAL_PART_KEY = "project_mail_local_part_key";
const BUSINESS_KEY = "project_mail_business_id_key";

/** The local parts to try, best first: the page's address, the business's slug, its name, then a fixed fallback. */
export function mailLocalPartCandidates(input: { pageSlug: string | null; businessSlug: string; businessName: string; businessId: string }): string[] {
  const out: string[] = [];
  const add = (v: string | null | undefined) => {
    if (v && isMailLocalPart(v) && !out.includes(v)) out.push(v);
  };
  add(input.pageSlug);
  add(input.businessSlug);
  add(suggestPageSlug(input.businessSlug));
  add(suggestPageSlug(input.businessName));
  const tail = input.businessId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  add(`project-${tail.slice(0, 8)}`);
  // A taken local part gets a short suffix from the business id (stable for the project), then a longer one.
  for (const base of [...out]) {
    add(suffixPageSlug(base, tail.slice(0, 4)));
    add(suffixPageSlug(base, tail.slice(0, 8)));
  }
  return out.filter((v) => MAIL_LOCAL_PART_PATTERN.test(v));
}

export const mailRepo = {
  async get(db: Executor, businessId: string): Promise<ProjectMail | null> {
    return maybeOne(await db.select().from(projectMail).where(eq(projectMail.businessId, businessId)).limit(1));
  },

  /**
   * The project's row, created with the first free candidate when it has none (service connection). Safe under
   * concurrency: a second writer for the same business reads the first one's row.
   */
  async ensure(db: Executor, businessId: string): Promise<ProjectMail> {
    const existing = await mailRepo.get(db, businessId);
    if (existing) return existing;
    const business = maybeOne(await db.select({ slug: businesses.slug, name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1));
    if (!business) throw new Error(`business ${businessId} not found`);
    const page = maybeOne(await db.select({ slug: projectPages.slug }).from(projectPages).where(eq(projectPages.businessId, businessId)).limit(1));
    for (const localPart of mailLocalPartCandidates({ pageSlug: page?.slug ?? null, businessSlug: business.slug, businessName: business.name, businessId })) {
      try {
        // A savepoint per attempt, so a taken local part does not abort the caller's transaction.
        const row = await db.transaction(async (tx) => maybeOne(await tx.insert(projectMail).values({ businessId, localPart }).returning()));
        if (row) return row;
      } catch (e) {
        const v = uniqueViolation(e);
        if (v?.constraint === BUSINESS_KEY) {
          const raced = await mailRepo.get(db, businessId);
          if (raced) return raced;
        }
        if (v && v.constraint !== LOCAL_PART_KEY && v.constraint !== undefined) throw e;
        if (!v) throw e;
      }
    }
    throw new Error(`no free sending address for business ${businessId}`);
  },

  /** An operator raises (or resets, with null) one project's daily cap. Never exposed to the app roles. */
  async setDailyCap(db: Executor, businessId: string, dailyCap: number | null): Promise<ProjectMail | null> {
    if (dailyCap !== null && (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 10_000)) throw new Error("daily cap must be an integer from 1 to 10,000, or null");
    return maybeOne(await db.update(projectMail).set({ dailyCap, updatedAt: new Date() }).where(eq(projectMail.businessId, businessId)).returning());
  },

  /** An operator pauses (or resumes) one project's sending. */
  async setStatus(db: Executor, businessId: string, status: ProjectMailStatus): Promise<ProjectMail | null> {
    return maybeOne(await db.update(projectMail).set({ status, updatedAt: new Date() }).where(eq(projectMail.businessId, businessId)).returning());
  },

  resolve: {
    /** The project a local part at the sending domain belongs to (ingest; service connection), or null. */
    async byLocalPart(db: Executor, localPart: string): Promise<Pick<ProjectMail, "businessId" | "localPart" | "status"> | null> {
      if (!MAIL_LOCAL_PART_PATTERN.test(localPart)) return null;
      return maybeOne(await db.select({ businessId: projectMail.businessId, localPart: projectMail.localPart, status: projectMail.status }).from(projectMail).where(eq(projectMail.localPart, localPart.toLowerCase())).limit(1));
    },
  },
};
