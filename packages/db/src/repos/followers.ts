/**
 * Followers of a project's public page (0079 `contact_consents`; docs/THESIS_REVIEW.md package 1.6). Double opt-in.
 *
 * A visitor who signs up gets a consent record that is **pending**: the exact sentence they agreed to, when, and the
 * page's address, with `confirmed_at` null. Their contact is the existing one with that address (its name, lawful basis
 * and roles untouched), or a new lead named "Follower (ma***@example.com)" with no lawful basis. Only once the person
 * confirms from the email the platform sends them (`confirm`, ingest's `/mail/confirm`) is the record consent, the
 * contact's lawful basis `consent` (when it had none), and the person a follower. Everything here runs on the service
 * connection: the signed-out visitor has no membership, and `contact_consents` has no write policy for app roles
 * (members only read it).
 *
 * - `target`: the business behind a published page, joined through the view `public_project_pages`, so only a page the
 *   public can read takes followers (published, committed, not archived, not a sample).
 * - `record`: writes the signup in the caller's transaction. A confirmed or withdrawn record, a suppressed address, a
 *   contact being deleted and a contact the founder archived write nothing (an archived contact is never brought back).
 * - `reserveConfirmation` / `releaseConfirmation`: at most one confirmation email per address per project per 30 days,
 *   kept on the row (`confirmation_sent_at`), with the hash of the nonce the link carries.
 * - `pendingConfirmation` (the gateway, before it sends) and `confirm` (ingest, when the link is used).
 * - `withdrawByEmailHash`: an unsubscribe, a bounce or a spam report for the address ends its consent for that business.
 * - `count`, `consentStates`, `awaitingConfirmation`: what the founder sees and what the gateway checks.
 */
import { FOLLOW_CONSENT_PURPOSE, FOLLOW_SOURCE, followerDisplayName, ProjectPageSlug, readPageContent } from "@foundmill/shared";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { contactConsents, entities, projectPages, publicProjectPages } from "../schema";
import { suppressionHash } from "./channels";
import { entitiesRepo } from "./entities";
import { maybeOne, type Executor } from "./_shared";

/** One confirmation email per address per project in this window. */
export const FOLLOW_CONFIRM_RESEND_MS = 30 * 24 * 60 * 60_000;

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
  /**
   * The post link the visitor last arrived through (0102), already checked by the caller (`postLinks.followable`: the
   * business's own, not simulated, visited). A new signup keeps it; a repeat signup that is still pending takes the
   * newer one (last touch).
   */
  postLinkId?: string | null;
}

/**
 * `new`: a pending record was written (for a new contact, or an existing one); `pending`: the address already signed up
 * and has not confirmed (the record is unchanged; the caller may send the email again once 30 days passed);
 * `nothing`: no record to write (confirmed or withdrawn already, suppressed, being deleted, or a contact the founder
 * archived).
 */
export type RecordFollowerResult =
  | { status: "new"; entityId: string; consentId: string; entityCreated: boolean }
  | { status: "pending"; entityId: string; consentId: string; entityCreated: false }
  | { status: "nothing"; reason: "repeat" | "suppressed" | "archived"; entityId: null; consentId: null; entityCreated: false };

const nothing = (reason: "repeat" | "suppressed" | "archived"): RecordFollowerResult => ({ status: "nothing", reason, entityId: null, consentId: null, entityCreated: false });

const pageConsent = (businessId: string) => and(eq(contactConsents.businessId, businessId), eq(contactConsents.purpose, FOLLOW_CONSENT_PURPOSE), eq(contactConsents.source, FOLLOW_SOURCE));
/** A contact the founder works with: not archived, not merged away, not being deleted. */
const liveContact = and(isNull(entities.archivedAt), isNull(entities.mergedIntoId), isNull(entities.deletionRequestedAt));
/** sha256 hex of a contact's email identifier, trimmed and lowercased: the suppression list's form. */
const emailHashOf = sql<string>`encode(sha256(convert_to(lower(trim(${entities.identifiers} ->> 'email')), 'UTF8')), 'hex')`;

/** What the founder sees for one contact: when they confirmed, or that they have not yet. */
export type FollowConsentState = { state: "confirmed"; confirmedAt: Date } | { state: "pending"; agreedAt: Date };

export interface PendingConfirmation {
  consentId: string;
  entityId: string;
  email: string;
  tokenHash: string | null;
  confirmationSentAt: Date | null;
}

export type ConfirmFollowResult = { status: "confirmed"; entityId: string; consentId: string; pageId: string | null; lawfulBasisSet: boolean } | { status: "already" } | { status: "invalid" };

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
   * Writes one signup in the caller's transaction. Two signups with the same address at the same moment are serialized
   * by a transaction lock on the business and the address's hash, so they never make two contacts.
   */
  async record(db: Executor, businessId: string, input: RecordFollowerInput): Promise<RecordFollowerResult> {
    const email = input.email.trim().toLowerCase();
    const hash = suppressionHash("email", email);
    await db.execute(sql`select pg_advisory_xact_lock(hashtext('fm.page_follow'), hashtext(${`${businessId}:${hash}`}))`);
    let entityId: string;
    let entityCreated = false;
    const known = await entitiesRepo.findByIdentifier(db, businessId, "email", email);
    if (known) {
      // An existing contact keeps its name, its lawful basis and its roles: the signup only adds a pending record.
      if (known.deletionRequestedAt) return nothing("suppressed");
      const existing = maybeOne(await db.select({ id: contactConsents.id, confirmedAt: contactConsents.confirmedAt, withdrawnAt: contactConsents.withdrawnAt }).from(contactConsents).where(and(pageConsent(businessId), eq(contactConsents.entityId, known.id))).limit(1));
      if (existing) {
        if (existing.confirmedAt || existing.withdrawnAt) return nothing("repeat");
        // Still pending: the post the visitor came back through last is the one a confirmation will credit.
        if (input.postLinkId) await db.update(contactConsents).set({ postLinkId: input.postLinkId, updatedAt: input.at ?? new Date() }).where(and(eq(contactConsents.businessId, businessId), eq(contactConsents.id, existing.id), isNull(contactConsents.confirmedAt)));
        return { status: "pending", entityId: known.id, consentId: existing.id, entityCreated: false };
      }
      entityId = known.id;
    } else {
      // A contact the founder archived is not brought back by a signup (nor duplicated).
      const archived = await db
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.businessId, businessId), isNotNull(entities.archivedAt), isNull(entities.mergedIntoId), sql`lower(${entities.identifiers} ->> 'email') = ${email}`))
        .limit(1);
      if (archived.length) return nothing("archived");
      // A new contact: a lead with no lawful basis until the person confirms (the masked address as its name).
      const lead = await entitiesRepo.upsertLead(db, businessId, { kind: "person", displayName: followerDisplayName(email), email, source: FOLLOW_SOURCE, lawfulBasis: null, ownerAgentId: null, startedAt: input.at });
      if (lead.status === "suppressed") return nothing("suppressed");
      entityId = lead.entity.id;
      entityCreated = lead.status === "created";
    }
    const rows = await db
      .insert(contactConsents)
      .values({ businessId, entityId, purpose: FOLLOW_CONSENT_PURPOSE, source: FOLLOW_SOURCE, sourceRef: input.slug, pageId: input.pageId, consentText: input.consentText, agreedAt: input.at ?? new Date(), postLinkId: input.postLinkId ?? null })
      .onConflictDoNothing({ target: [contactConsents.businessId, contactConsents.entityId, contactConsents.purpose, contactConsents.source] })
      .returning({ id: contactConsents.id });
    const consent = rows[0];
    if (!consent) return nothing("repeat");
    return { status: "new", entityId, consentId: consent.id, entityCreated };
  },

  /**
   * Claims the right to send the confirmation email for a pending record: true (and the time and the link's nonce hash
   * written) when none was sent in the last 30 days; false otherwise, or when the record is confirmed or withdrawn.
   */
  async reserveConfirmation(db: Executor, businessId: string, consentId: string, input: { tokenHash: string; at?: Date }): Promise<boolean> {
    const at = input.at ?? new Date();
    const since = new Date(at.getTime() - FOLLOW_CONFIRM_RESEND_MS);
    const rows = await db
      .update(contactConsents)
      .set({ confirmationSentAt: at, confirmationTokenHash: input.tokenHash, updatedAt: at })
      .where(and(pageConsent(businessId), eq(contactConsents.id, consentId), isNull(contactConsents.confirmedAt), isNull(contactConsents.withdrawnAt), or(isNull(contactConsents.confirmationSentAt), lt(contactConsents.confirmationSentAt, since))))
      .returning({ id: contactConsents.id });
    return rows.length > 0;
  },

  /** Gives a reservation back when the email was not sent (platform mail off, refused): a later signup may try again. */
  async releaseConfirmation(db: Executor, businessId: string, consentId: string, tokenHash: string): Promise<void> {
    await db
      .update(contactConsents)
      .set({ confirmationSentAt: null, confirmationTokenHash: null, updatedAt: new Date() })
      .where(and(pageConsent(businessId), eq(contactConsents.id, consentId), eq(contactConsents.confirmationTokenHash, tokenHash), isNull(contactConsents.confirmedAt)));
  },

  /** A pending record of the business and its contact's address (the gateway checks this before it sends), or null. */
  async pendingConfirmation(db: Executor, businessId: string, consentId: string): Promise<PendingConfirmation | null> {
    const row = maybeOne(
      await db
        .select({ consentId: contactConsents.id, entityId: contactConsents.entityId, email: sql<string | null>`lower(trim(${entities.identifiers} ->> 'email'))`, tokenHash: contactConsents.confirmationTokenHash, confirmationSentAt: contactConsents.confirmationSentAt })
        .from(contactConsents)
        .innerJoin(entities, and(eq(entities.id, contactConsents.entityId), eq(entities.businessId, businessId)))
        .where(and(pageConsent(businessId), eq(contactConsents.id, consentId), isNull(contactConsents.confirmedAt), isNull(contactConsents.withdrawnAt), liveContact))
        .limit(1),
    );
    if (!row?.email) return null;
    return { consentId: row.consentId, entityId: row.entityId, email: row.email, tokenHash: row.tokenHash, confirmationSentAt: row.confirmationSentAt };
  },

  /**
   * The person used the link (ingest checked its signature and expiry). In the caller's transaction: the record must be
   * this business's, for the contact whose address hashes to `emailHash`, carry `tokenHash` (the newest link), and be
   * neither withdrawn nor for a contact being deleted. Sets `confirmed_at`, clears the nonce, and gives the contact the
   * lawful basis `consent` only when it had none. A second use answers `already`.
   */
  async confirm(db: Executor, input: { businessId: string; consentId: string; emailHash: string; tokenHash: string; at?: Date }): Promise<ConfirmFollowResult> {
    const at = input.at ?? new Date();
    const row = maybeOne(
      await db
        .select({ id: contactConsents.id, entityId: contactConsents.entityId, pageId: contactConsents.pageId, confirmedAt: contactConsents.confirmedAt, withdrawnAt: contactConsents.withdrawnAt, tokenHash: contactConsents.confirmationTokenHash, emailHash: emailHashOf, lawfulBasis: entities.lawfulBasis, archivedAt: entities.archivedAt, mergedIntoId: entities.mergedIntoId, deletionRequestedAt: entities.deletionRequestedAt })
        .from(contactConsents)
        .innerJoin(entities, and(eq(entities.id, contactConsents.entityId), eq(entities.businessId, input.businessId)))
        .where(and(pageConsent(input.businessId), eq(contactConsents.id, input.consentId)))
        .for("update", { of: contactConsents })
        .limit(1),
    );
    if (!row || row.emailHash !== input.emailHash || row.withdrawnAt) return { status: "invalid" };
    if (row.confirmedAt) return { status: "already" };
    if (!row.tokenHash || row.tokenHash !== input.tokenHash || row.archivedAt || row.mergedIntoId || row.deletionRequestedAt) return { status: "invalid" };
    await db.update(contactConsents).set({ confirmedAt: at, confirmationTokenHash: null, updatedAt: at }).where(eq(contactConsents.id, row.id));
    let lawfulBasisSet = false;
    if (!row.lawfulBasis) {
      await db.update(entities).set({ lawfulBasis: "consent" }).where(and(eq(entities.businessId, input.businessId), eq(entities.id, row.entityId), isNull(entities.lawfulBasis)));
      lawfulBasisSet = true;
    }
    return { status: "confirmed", entityId: row.entityId, consentId: row.id, pageId: row.pageId, lawfulBasisSet };
  },

  /** Ends every page consent of the business for the address with this hash (an unsubscribe, a bounce, a spam report). */
  async withdrawByEmailHash(db: Executor, businessId: string, emailHash: string, at: Date = new Date()): Promise<number> {
    const rows = await db
      .update(contactConsents)
      .set({ withdrawnAt: at, confirmationTokenHash: null, updatedAt: at })
      .where(and(pageConsent(businessId), isNull(contactConsents.withdrawnAt), inArray(contactConsents.entityId, db.select({ id: entities.id }).from(entities).where(and(eq(entities.businessId, businessId), sql`${emailHashOf} = ${emailHash}`)))))
      .returning({ id: contactConsents.id });
    return rows.length;
  },

  /**
   * The first confirmation the business's page ever got: the consent record's id and the moment, or null while nobody
   * confirmed. A person who unsubscribed later still was the first follower that day. Ids only, never an address.
   */
  async firstConfirmed(db: Executor, businessId: string): Promise<{ consentId: string; confirmedAt: Date } | null> {
    const row = maybeOne(
      await db
        .select({ consentId: contactConsents.id, confirmedAt: contactConsents.confirmedAt })
        .from(contactConsents)
        .where(and(pageConsent(businessId), isNotNull(contactConsents.confirmedAt)))
        .orderBy(contactConsents.confirmedAt, contactConsents.id)
        .limit(1),
    );
    return row?.confirmedAt ? { consentId: row.consentId, confirmedAt: row.confirmedAt } : null;
  },

  /** How many people follow the business's page now: confirmed, not withdrawn, on a contact the founder still works with. */
  async count(db: Executor, businessId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(contactConsents)
      .innerJoin(entities, and(eq(entities.id, contactConsents.entityId), eq(entities.businessId, businessId)))
      .where(and(pageConsent(businessId), isNotNull(contactConsents.confirmedAt), isNull(contactConsents.withdrawnAt), liveContact));
    return Number(rows[0]?.n ?? 0);
  },

  /** For each of `entityIds` with a page consent not withdrawn: confirmed (and when), or pending. */
  async consentStates(db: Executor, businessId: string, entityIds: readonly string[]): Promise<Map<string, FollowConsentState>> {
    const out = new Map<string, FollowConsentState>();
    if (!entityIds.length) return out;
    const rows = await db
      .select({ entityId: contactConsents.entityId, agreedAt: contactConsents.agreedAt, confirmedAt: contactConsents.confirmedAt })
      .from(contactConsents)
      .where(and(eq(contactConsents.businessId, businessId), eq(contactConsents.purpose, FOLLOW_CONSENT_PURPOSE), isNull(contactConsents.withdrawnAt), inArray(contactConsents.entityId, [...entityIds])));
    for (const r of rows) {
      const seen = out.get(r.entityId);
      if (r.confirmedAt) {
        if (!seen || seen.state === "pending" || r.confirmedAt < seen.confirmedAt) out.set(r.entityId, { state: "confirmed", confirmedAt: r.confirmedAt });
      } else if (!seen) out.set(r.entityId, { state: "pending", agreedAt: r.agreedAt });
    }
    return out;
  },

  /**
   * Of `emails` (trimmed, lowercased), the ones whose contact in the business has no lawful basis and a page signup that
   * was never confirmed: nothing proves the person owns the address, so the gateway treats them like an address first
   * seen in untrusted content (refused).
   */
  async awaitingConfirmation(db: Executor, businessId: string, emails: readonly string[]): Promise<string[]> {
    const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (!list.length) return [];
    const rows = await db
      .select({ email: sql<string>`lower(trim(${entities.identifiers} ->> 'email'))` })
      .from(contactConsents)
      .innerJoin(entities, and(eq(entities.id, contactConsents.entityId), eq(entities.businessId, businessId)))
      .where(and(pageConsent(businessId), isNull(contactConsents.confirmedAt), isNull(entities.lawfulBasis), inArray(sql`lower(trim(${entities.identifiers} ->> 'email'))`, list)));
    return [...new Set(rows.map((r) => r.email))];
  },
};
