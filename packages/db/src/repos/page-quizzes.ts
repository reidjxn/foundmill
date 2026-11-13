/**
 * page_quizzes and page_quiz_counts (0101): the optional "which one is for you" quiz on a project's public page.
 *
 * - `facts` (service connection or the founder's own): what the team drafts from, read from the project's own rows
 *   only. Customers are contacts in the `customer` role (or with a payment), people or organizations, not archived,
 *   merged, being deleted, or an unverified name the Composer guessed. Their replies are inbound interactions; their
 *   purchases are incoming transactions linked to them. Contacts get opaque refs (`c1`, `c2`, ...): no name, address or
 *   identifier leaves this function. A sample business's seeded rows are read only for a sample business (they are its
 *   own rows; nothing of a sample is ever public).
 * - `writeDraft` (service connection): the team's draft, the only way a row is written. A second draft replaces the
 *   first: the trigger makes it a new version, back to draft and off the page.
 * - `save`, `setStatus` (the signed-in founder, through RLS): an edit, an approval, turning it on or off. The trigger
 *   keeps approving and turning on or off to an owner or an admin, and records who and when itself.
 * - `counts`: how many visitors finished the current version with each result. Never who.
 * - `public.*` (service connection): a live quiz by its page's address, through the view `public_page_quizzes` only, and
 *   one finished quiz counted for its result type.
 */
import { PAGE_QUIZ_TYPE_KEYS, ProjectPageSlug, readPageQuiz, type PageQuizDefinition, type PageQuizEvidence, type PageQuizStatus } from "@foundmill/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { pageQuizCounts, pageQuizzes, projectPages, publicPageQuizzes, type PageQuiz } from "../schema";
import { maybeOne, rowsOf, type Executor } from "./_shared";

/** At most this many customers are read for a draft: enough to see types, little enough for one short call. */
export const PAGE_QUIZ_FACTS_MAX_CUSTOMERS = 60;
const REPLIES_PER_CUSTOMER = 3;
const REPLY_MAX_CHARS = 240;
const OFFER_MAX_CHARS = 80;

/** One customer as the team sees them: an opaque ref, the kind of contact, what they bought and what they wrote. */
export interface PageQuizCustomerFact {
  ref: string;
  kind: "person" | "organization";
  /** The refs of the things they bought (`PageQuizOfferFact.ref`). */
  bought: string[];
  /** Short summaries of their own replies, newest first. Their words: untrusted. */
  replies: string[];
}

/** Something customers actually paid for, as the payment's own description says it, with how many bought it. */
export interface PageQuizOfferFact {
  ref: string;
  title: string;
  buyers: number;
}

export interface PageQuizFacts {
  customers: PageQuizCustomerFact[];
  offers: PageQuizOfferFact[];
  /** Real counts of what the facts were read from. */
  totals: { customers: number; replies: number; purchases: number };
}

const offerKey = (description: string) => description.replace(/\s+/g, " ").trim().toLowerCase();

export interface WriteQuizDraftInput {
  definition: PageQuizDefinition;
  evidence: PageQuizEvidence;
  agentId: string | null;
}

export const pageQuizzesRepo = {
  /** The business's quiz, or null before the team drafted one. */
  async get(db: Executor, businessId: string): Promise<PageQuiz | null> {
    return maybeOne(await db.select().from(pageQuizzes).where(eq(pageQuizzes.businessId, businessId)).limit(1));
  },

  /** What the team drafts from: the project's real customers, their purchases and their replies (see the file's note). */
  async facts(db: Executor, businessId: string): Promise<PageQuizFacts> {
    const customers = rowsOf<{ id: string; kind: string }>(await db.execute(sql`
      select e.id::text as id, e.kind
        from entities e
       where e.business_id = ${businessId}
         and e.kind in ('person', 'organisation')
         and e.archived_at is null and e.merged_into_id is null and e.deletion_requested_at is null
         and coalesce(e.source, '') not like 'composer:unverified:%'
         and (exists (select 1 from entity_roles r where r.business_id = e.business_id and r.entity_id = e.id and r.role = 'customer' and r.ended_at is null)
              or exists (select 1 from conversions c where c.business_id = e.business_id and c.entity_id = e.id and c.kind = 'payment'))
       order by e.created_at, e.id
       limit ${PAGE_QUIZ_FACTS_MAX_CUSTOMERS}`));
    if (customers.length === 0) return { customers: [], offers: [], totals: { customers: 0, replies: 0, purchases: 0 } };
    const ids = customers.map((c) => c.id);
    const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    const purchases = rowsOf<{ entity_id: string; description: string }>(await db.execute(sql`
      select t.counterparty_entity_id::text as entity_id, t.description
        from transactions t
       where t.business_id = ${businessId} and t.amount_minor > 0 and t.counterparty_entity_id in (${idList}) and btrim(t.description) <> ''
       order by t.booked_at, t.id`));
    const replies = rowsOf<{ entity_id: string; summary: string }>(await db.execute(sql`
      select x.entity_id, x.summary from (
        select u.entity_id::text as entity_id, i.summary, row_number() over (partition by u.entity_id order by i.occurred_at desc, i.id) as n
          from interactions i
          cross join lateral unnest(i.entity_ids) as u(entity_id)
         where i.business_id = ${businessId} and i.direction = 'inbound' and i.archived_at is null and btrim(i.summary) <> ''
           and u.entity_id in (${idList})
      ) x where x.n <= ${REPLIES_PER_CUSTOMER}`));

    // Offers: each distinct description customers paid for, most bought first, at most 8.
    const offerBuyers = new Map<string, { title: string; buyers: Set<string> }>();
    for (const p of purchases) {
      const key = offerKey(p.description);
      const entry = offerBuyers.get(key) ?? { title: p.description.replace(/\s+/g, " ").trim().slice(0, OFFER_MAX_CHARS), buyers: new Set<string>() };
      entry.buyers.add(p.entity_id);
      offerBuyers.set(key, entry);
    }
    const ranked = [...offerBuyers.entries()].sort((a, b) => b[1].buyers.size - a[1].buyers.size || a[1].title.localeCompare(b[1].title)).slice(0, 8);
    const offers: PageQuizOfferFact[] = ranked.map(([, v], i) => ({ ref: `p${i + 1}`, title: v.title, buyers: v.buyers.size }));
    const offerRef = new Map(ranked.map(([k], i) => [k, `p${i + 1}`]));

    const refOf = new Map(ids.map((id, i) => [id, `c${i + 1}`]));
    const facts: PageQuizCustomerFact[] = customers.map((c) => ({
      ref: refOf.get(c.id)!,
      kind: c.kind === "organisation" ? "organization" : "person",
      bought: [...new Set(purchases.filter((p) => p.entity_id === c.id).map((p) => offerRef.get(offerKey(p.description))).filter((r): r is string => Boolean(r)))],
      replies: replies.filter((r) => r.entity_id === c.id).map((r) => r.summary.replace(/\s+/g, " ").trim().slice(0, REPLY_MAX_CHARS)),
    }));
    return { customers: facts, offers, totals: { customers: customers.length, replies: replies.length, purchases: purchases.length } };
  },

  /**
   * The team's draft (service connection): the row, or the definition of the one there is replaced (a new version, back
   * to draft, off the page). `updated_by` stays as it was: it names people.
   */
  async writeDraft(db: Executor, businessId: string, input: WriteQuizDraftInput): Promise<PageQuiz> {
    const now = new Date();
    const rows = await db
      .insert(pageQuizzes)
      .values({ businessId, definition: input.definition, evidence: input.evidence, draftedByAgentId: input.agentId, draftedAt: now })
      .onConflictDoUpdate({ target: pageQuizzes.businessId, set: { definition: input.definition, evidence: input.evidence, draftedByAgentId: input.agentId, draftedAt: now, status: "draft", updatedAt: now } })
      .returning();
    return rows[0]!;
  },

  /** The founder's edit, through RLS. Null when the business has no quiz. A changed definition goes back to draft (the trigger). */
  async save(db: Executor, businessId: string, input: { definition: PageQuizDefinition; userId: string | null }): Promise<PageQuiz | null> {
    const rows = await db.update(pageQuizzes).set({ definition: input.definition, updatedBy: input.userId, updatedAt: new Date() }).where(eq(pageQuizzes.businessId, businessId)).returning();
    return rows[0] ?? null;
  },

  /**
   * Moves the quiz from one of `from` to `to`, through RLS (approve: draft → approved; turn on: approved → live; turn
   * off: live → approved). Null when it was not in one of `from` (a second tab already did it). The trigger records who
   * approved it and when, and refuses anyone but an owner or an admin.
   */
  async setStatus(db: Executor, businessId: string, input: { from: PageQuizStatus[]; to: PageQuizStatus; userId: string | null }): Promise<PageQuiz | null> {
    const rows = await db
      .update(pageQuizzes)
      .set({ status: input.to, updatedBy: input.userId, updatedAt: new Date() })
      .where(and(eq(pageQuizzes.businessId, businessId), inArray(pageQuizzes.status, input.from)))
      .returning();
    return rows[0] ?? null;
  },

  /** How many visitors finished `version` with each result type. Types nobody got are 0. */
  async counts(db: Executor, businessId: string, quizId: string, version: number): Promise<Record<string, number>> {
    const rows = await db
      .select({ typeKey: pageQuizCounts.typeKey, finished: pageQuizCounts.finished })
      .from(pageQuizCounts)
      .where(and(eq(pageQuizCounts.businessId, businessId), eq(pageQuizCounts.quizId, quizId), eq(pageQuizCounts.version, version)));
    return Object.fromEntries(rows.map((r) => [r.typeKey, Number(r.finished)]));
  },

  public: {
    /** A live quiz by its page's address, as the view gives it; null for anything not public. Service connection only. */
    async bySlug(db: Executor, slug: string): Promise<{ slug: string; version: number; definition: PageQuizDefinition; followForm: boolean } | null> {
      if (!ProjectPageSlug.safeParse(slug).success) return null;
      const row = maybeOne(await db.select().from(publicPageQuizzes).where(eq(publicPageQuizzes.slug, slug)).limit(1));
      if (!row) return null;
      const definition = readPageQuiz(row.definition);
      return definition ? { slug: row.slug, version: row.version, definition, followForm: row.followForm } : null;
    },

    /**
     * One finished quiz, counted for its result type: only for the live quiz at `slug`, at that version, and a type it
     * has. A number goes up by one; nothing else is written. False when nothing was counted. Service connection only.
     */
    async recordResult(db: Executor, input: { slug: string; version: number; typeKey: string }): Promise<boolean> {
      if (!(PAGE_QUIZ_TYPE_KEYS as readonly string[]).includes(input.typeKey)) return false;
      const target = maybeOne(
        await db
          .select({ quizId: pageQuizzes.id, businessId: pageQuizzes.businessId, version: pageQuizzes.version })
          .from(publicPageQuizzes)
          .innerJoin(projectPages, eq(projectPages.slug, publicPageQuizzes.slug))
          .innerJoin(pageQuizzes, eq(pageQuizzes.businessId, projectPages.businessId))
          .where(and(eq(publicPageQuizzes.slug, input.slug), eq(publicPageQuizzes.version, input.version), eq(pageQuizzes.version, input.version)))
          .limit(1),
      );
      if (!target) return false;
      await db
        .insert(pageQuizCounts)
        .values({ businessId: target.businessId, quizId: target.quizId, version: target.version, typeKey: input.typeKey, finished: 1 })
        .onConflictDoUpdate({ target: [pageQuizCounts.quizId, pageQuizCounts.version, pageQuizCounts.typeKey], set: { finished: sql`${pageQuizCounts.finished} + 1`, updatedAt: new Date() } });
      return true;
    },
  },
};
