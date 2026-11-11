/**
 * Followers of a project's public page (0079 `contact_consents`; docs/THESIS_REVIEW.md package 1.6).
 *
 * A visitor who follows a page becomes a lead in the CRM (`entitiesRepo.upsertLead`: source `page`, lawful basis
 * `consent`, owned by nobody) with one consent record: the exact sentence they agreed to, when, and the page's address.
 * Everything here runs on the service connection: the signed-out visitor has no membership, and `contact_consents` has
 * no write policy for app roles (members only read it).
 *
 * - `target`: the business behind a published page, joined through the view `public_project_pages`, so only a page the
 *   public can read takes followers (published, committed, not archived, not a sample).
 * - `record`: writes the follower in the caller's transaction. A repeat (the address already has its consent record)
 *   writes nothing; an address on the business's (or the platform's) suppression list, or a record being deleted,
 *   writes nothing either. The caller answers the visitor the same way in every case.
 * - `count` and `agreedAt`: what the founder sees (the Public page tab's count; "Agreed to email on …" in Customers).
 */
import { FOLLOW_CONSENT_PURPOSE, FOLLOW_SOURCE, ProjectPageSlug, readPageContent } from "@foundmill/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { contactConsents, entities, projectPages, publicProjectPages } from "../schema";
import { suppressionHash } from "./channels";
import { entitiesRepo } from "./entities";
import { maybeOne, type Executor } from "./_shared";

/** The page a follow is for, as only a published page gives it. */
export interface FollowTarget {
  businessId: string;
  pageId: string;
  slug: string;
  name: string;
  /** The founders' switch on the published copy (`followForm`; a copy published before it existed reads as off). */
  followForm: boolean;
}

export interface RecordFollowerInput {
  pageId: string;
  slug: string;
  /** Trimmed and lowercased by the caller, already checked. */
  email: string;
  /** The sentence beside the box, exactly as the visitor read it. */
  consentText: string;
  at?: Date;
}

/** `new`: a contact (or an existing one) now follows; `repeat`: they already did; `suppressed`: never written. */
export type RecordFollowerResult = { status: "new"; entityId: string; consentId: string; entityCreated: boolean } | { status: "repeat" | "suppressed"; entityId: null; consentId: null; entityCreated: false };

const nothing = (status: "repeat" | "suppressed"): RecordFollowerResult => ({ status, entityId: null, consentId: null, entityCreated: false });

const activePageConsent = (businessId: string) =>
  and(eq(contactConsents.businessId, businessId), eq(contactConsents.purpose, FOLLOW_CONSENT_PURPOSE), eq(contactConsents.source, FOLLOW_SOURCE), isNull(contactConsents.withdrawnAt));

export const followersRepo = {
  /** The business behind the published page at `slug`, or null for an unknown address or a page that is not public. */
  async target(db: Executor, slug: string): Promise<FollowTarget | null> {
    if (!ProjectPageSlug.safeParse(slug).success) return null;
    const row = maybeOne(
      await db
        .select({ businessId: projectPages.businessId, pageId: projectPages.id, slug: publicProjectPages.slug, name: publicProjectPages.name, published: publicProjectPages.published })
        .from(publicProjectPages)
        .innerJoin(projectPages, eq(projectPages.slug, publicProjectPages.slug))
        .where(eq(publicProjectPages.slug, slug))
        .limit(1),
    );
    if (!row) return null;
    const content = readPageContent(row.published);
    if (!content) return null;
    return { businessId: row.businessId, pageId: row.pageId, slug: row.slug, name: row.name, followForm: content.followForm };
  },

  /**
   * Writes one follower in the caller's transaction. Two signups with the same address at the same moment are
   * serialized by a transaction lock on the business and the address's hash, so they never make two contacts.
   */
  async record(db: Executor, businessId: string, input: RecordFollowerInput): Promise<RecordFollowerResult> {
    const email = input.email.trim().toLowerCase();
    const hash = suppressionHash("email", email);
    await db.execute(sql`select pg_advisory_xact_lock(hashtext('fm.page_follow'), hashtext(${`${businessId}:${hash}`}))`);
    const known = await entitiesRepo.findByIdentifier(db, businessId, "email", email);
    if (known) {
      const already = await db.select({ id: contactConsents.id }).from(contactConsents).where(and(activePageConsent(businessId), eq(contactConsents.entityId, known.id))).limit(1);
      if (already.length) return nothing("repeat");
    }
    const lead = await entitiesRepo.upsertLead(db, businessId, { kind: "person", displayName: email, email, source: FOLLOW_SOURCE, lawfulBasis: "consent", ownerAgentId: null, startedAt: input.at });
    if (lead.status === "suppressed") return nothing("suppressed");
    const rows = await db
      .insert(contactConsents)
      .values({ businessId, entityId: lead.entity.id, purpose: FOLLOW_CONSENT_PURPOSE, source: FOLLOW_SOURCE, sourceRef: input.slug, pageId: input.pageId, consentText: input.consentText, agreedAt: input.at ?? new Date() })
      .onConflictDoNothing({ target: [contactConsents.businessId, contactConsents.entityId, contactConsents.purpose, contactConsents.source] })
      .returning({ id: contactConsents.id });
    const consent = rows[0];
    if (!consent) return nothing("repeat");
    return { status: "new", entityId: lead.entity.id, consentId: consent.id, entityCreated: lead.status === "created" };
  },

  /** How many people follow the business's page now (records not withdrawn, contacts not being deleted). */
  async count(db: Executor, businessId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(contactConsents)
      .innerJoin(entities, and(eq(entities.id, contactConsents.entityId), eq(entities.businessId, businessId)))
      .where(and(activePageConsent(businessId), isNull(entities.deletionRequestedAt)));
    return Number(rows[0]?.n ?? 0);
  },

  /** When each of `entityIds` agreed to email (the earliest record not withdrawn), for the ones that did. */
  async agreedAt(db: Executor, businessId: string, entityIds: readonly string[]): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    if (!entityIds.length) return out;
    const rows = await db
      .select({ entityId: contactConsents.entityId, agreedAt: contactConsents.agreedAt })
      .from(contactConsents)
      .where(and(eq(contactConsents.businessId, businessId), eq(contactConsents.purpose, FOLLOW_CONSENT_PURPOSE), isNull(contactConsents.withdrawnAt), inArray(contactConsents.entityId, [...entityIds])));
    for (const r of rows) {
      const seen = out.get(r.entityId);
      if (!seen || r.agreedAt < seen) out.set(r.entityId, r.agreedAt);
    }
    return out;
  },
};
