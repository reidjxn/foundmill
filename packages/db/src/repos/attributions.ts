/**
 * attributions (0088) — account-scoped (userId first): who or what brought a new person (docs/NETWORK.md §5, §11). One
 * row per account, ever, written by the api when the person's founder profile is first created
 * (`founder.profile.update`, apps/api services/attribution.ts). In the same transaction the api writes the row's two
 * account events, one per person (`signup.attributed` for the new person, `referral.arrived` for the person credited;
 * @foundmill/events `writeAccountEvents`): they carry `sourceKind` and `sourceRef` only, so this row is the one place
 * that holds the two accounts and the source project together by id, and `record` returns it for that (its `id` is
 * what the events' idempotency keys are built from).
 *
 * Service connection only, every function: the table is the service role's (no client role reads or writes it), and
 * `resolve` reads the two public views, which are the service role's too (0080, 0081).
 *
 * `resolve` decides what a reference may name by the public views alone: a project page only while
 * `public_project_pages` lists it (published, committed, not archived, not a sample business) and a person only while
 * `public_person_profiles` lists them (public, not archived). The views give no ids, so each is joined to its own table
 * on the public address (the slug, the handle) to learn which business and which account it is; a draft page, a private
 * profile and an unknown address all read the same: null. A shared post's code (`s.<code>`, 0106) resolves to its
 * project's page and is recorded as that page (`p.<slug>`), exactly as if the person came from the page: a simulated
 * link and a code whose project has no public page resolve to nothing, and no post code is ever recorded here.
 */
import { ATTRIBUTION_VIA_KINDS, formatVia, parseVia, type AttributionViaKind, type ViaRef } from "@foundmill/shared/via";
import { and, asc, eq, inArray } from "drizzle-orm";
import { OWNER_ROLES } from "@foundmill/shared";
import { z } from "zod";
import { attributions, founderProfiles, memberships, postLinks, projectPages, publicPersonProfiles, publicProjectPages, type Attribution } from "../schema";
import { Id, maybeOne, parseInput, type Executor } from "./_shared";

/** What a reference resolved to: the public thing it named and who is credited for it. */
export interface AttributionSource {
  /** Only a page or a person: a post's code is recorded as its project's page (0106 leaves 0088 as it is). */
  kind: AttributionViaKind;
  /** The slug or handle, as the public address spells it. */
  ref: string;
  /** The project whose page it is; null for a person's profile. */
  businessId: string | null;
  /** The page's longest-standing owner, or the profile's own person; null when a page has no owner to name. */
  referrerUserId: string | null;
}

const SourceInput = z
  .object({ kind: z.enum(ATTRIBUTION_VIA_KINDS), ref: z.string(), businessId: Id.nullable(), referrerUserId: Id.nullable() })
  .refine((s) => parseVia(formatVia({ kind: s.kind, ref: s.ref })) !== null, "not a reference")
  .refine((s) => s.kind === "project_page" || s.businessId === null, "only a project page names a business");

export const attributionsRepo = {
  /** The account's attribution, or null when nothing brought them (or nothing that resolved). */
  async forUser(db: Executor, userId: string): Promise<Attribution | null> {
    const id = parseInput(Id, userId, "user id");
    return maybeOne(await db.select().from(attributions).where(eq(attributions.userId, id)).limit(1));
  },

  /** What a reference names right now, by the public views only (see the file comment); null when it names nothing public. */
  async resolve(db: Executor, ref: ViaRef): Promise<AttributionSource | null> {
    const named = parseVia(formatVia(ref));
    if (!named) return null;
    if (named.kind === "post") {
      // The post's project, then its page by the public view alone: the same answer as a visit straight from the page.
      const page = maybeOne(
        await db
          .select({ slug: publicProjectPages.slug })
          .from(postLinks)
          .innerJoin(projectPages, eq(projectPages.businessId, postLinks.businessId))
          .innerJoin(publicProjectPages, eq(publicProjectPages.slug, projectPages.slug))
          .where(and(eq(postLinks.code, named.ref), eq(postLinks.simulated, false)))
          .limit(1),
      );
      return page ? attributionsRepo.resolve(db, { kind: "project_page", ref: page.slug }) : null;
    }
    if (named.kind === "project_page") {
      const page = maybeOne(
        await db
          .select({ businessId: projectPages.businessId })
          .from(publicProjectPages)
          .innerJoin(projectPages, eq(projectPages.slug, publicProjectPages.slug))
          .where(eq(publicProjectPages.slug, named.ref))
          .limit(1),
      );
      if (!page) return null;
      // The longest-standing owner or cofounder, in the order the public page names its founders (0077, 0092).
      const owner = maybeOne(
        await db
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(and(eq(memberships.businessId, page.businessId), inArray(memberships.role, [...OWNER_ROLES])))
          .orderBy(asc(memberships.createdAt), asc(memberships.id))
          .limit(1),
      );
      return { kind: named.kind, ref: named.ref, businessId: page.businessId, referrerUserId: owner?.userId ?? null };
    }
    if (named.kind === "person_profile") {
      const person = maybeOne(
        await db
          .select({ userId: founderProfiles.userId })
          .from(publicPersonProfiles)
          .innerJoin(founderProfiles, eq(founderProfiles.handle, publicPersonProfiles.handle))
          .where(eq(publicPersonProfiles.handle, named.ref))
          .limit(1),
      );
      return person ? { kind: named.kind, ref: named.ref, businessId: null, referrerUserId: person.userId } : null;
    }
    return null;
  },

  /**
   * Records what brought the account, once: the row written, or null when the account already has one (the first
   * stays, whatever arrives later) or when the person credited is the account itself (nobody brings themselves).
   */
  async record(db: Executor, userId: string, source: AttributionSource): Promise<Attribution | null> {
    const id = parseInput(Id, userId, "user id");
    const v = parseInput(SourceInput, source, "attribution");
    if (v.referrerUserId === id) return null;
    const rows = await db
      .insert(attributions)
      .values({ userId: id, sourceKind: v.kind, sourceRef: v.ref, sourceBusinessId: v.businessId, referrerUserId: v.referrerUserId })
      .onConflictDoNothing({ target: attributions.userId })
      .returning();
    return rows[0] ?? null;
  },
};
