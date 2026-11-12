/**
 * A person's own public profile (0080, columns on `founder_profiles`; docs/THESIS_REVIEW.md package 2.3): account-scoped
 * like `founders` (userId first). The api's `founder.publicProfile.*` writes it on the service connection after its own
 * checks; the table's guard trigger refuses a signed-in client that tries to make a profile public, or change a public
 * one, straight through PostgREST.
 *
 * `public.byHandle` is the one read without an account: the signed-out page at /u/<handle> asks by handle and gets only
 * what the view `public_person_profiles` lists. An unknown handle and a profile that is not public read the same: null.
 * The view is granted to the service role only, so every read here runs on the service connection.
 *
 * A handle a person leaves stays theirs for `PERSON_HANDLE_HOLD_DAYS` (`person_handle_releases`, written by the table's
 * triggers): `handleTaken` counts it as taken for everyone else, and the database refuses it the same way.
 */
import { ConflictError, NotFoundError, PERSON_HANDLE_HOLD_DAYS, PERSON_HANDLE_TAKEN, PersonHandle, PersonProfileContent, readPersonProfile, type PersonProfileContent as ProfileContent } from "@foundmill/shared";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { founderProfiles, memberships, personHandleReleases, projectPages, publicPersonProfiles, publicProjectPages, type FounderProfile, type PublicPersonProject } from "../schema";
import { Id, maybeOne, parseInput, uniqueViolation, type Executor } from "./_shared";

const HANDLE_CONSTRAINT = "founder_profiles_handle_key";

/** The person's public profile as the edit screen reads it. */
export interface PersonProfileRow {
  userId: string;
  displayName: string;
  /** Null until the person saves an address. */
  handle: string | null;
  content: ProfileContent;
  public: boolean;
  /** When it last went public (kept after it is taken down). */
  publishedAt: Date | null;
}

/** What anyone may read of a public profile: the view's columns, read defensively. */
export interface PublicPerson {
  handle: string;
  displayName: string;
  content: ProfileContent;
  publishedAt: Date;
  projects: PublicPersonProject[];
}

const SaveInput = z.object({ handle: PersonHandle.nullable().optional(), content: PersonProfileContent });
export type SavePersonProfileInput = z.input<typeof SaveInput>;

const rowOf = (r: FounderProfile): PersonProfileRow => ({
  userId: r.userId,
  displayName: r.displayName,
  handle: r.handle ?? null,
  content: readPersonProfile({ headline: r.headline, about: r.about, strengths: r.strengths, wantsToLearn: r.wantsToLearn, lookingFor: r.lookingFor, place: r.place }),
  public: r.public,
  publishedAt: r.publishedAt ?? null,
});

const projectsOf = (value: unknown): PublicPersonProject[] =>
  (Array.isArray(value) ? value : [])
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
    .filter((p) => typeof p.slug === "string" && typeof p.name === "string")
    .map((p) => ({ slug: p.slug as string, name: p.name as string, pitch: typeof p.pitch === "string" ? p.pitch : "" }));

/** A unique violation on the handle becomes the person's sentence; anything else is rethrown as it came. */
async function handleGuard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (uniqueViolation(err)?.constraint === HANDLE_CONSTRAINT) throw new ConflictError(PERSON_HANDLE_TAKEN, { field: "handle" });
    throw err;
  }
}

const mine = (userId: string) => and(eq(founderProfiles.userId, userId), isNull(founderProfiles.archivedAt));

export const personProfilesRepo = {
  /** The person's public profile fields, or null when the account has no (open) founder profile. */
  async get(db: Executor, userId: string): Promise<PersonProfileRow | null> {
    const id = parseInput(Id, userId, "user id");
    const row = maybeOne(await db.select().from(founderProfiles).where(mine(id)).limit(1));
    return row ? rowOf(row) : null;
  },

  /**
   * The person's row locked for the rest of the caller's transaction (`select … for update`), or null without an open
   * founder profile: what a screen checks is then what the write that follows changes, with no other save in between.
   */
  async lock(db: Executor, userId: string): Promise<PersonProfileRow | null> {
    const id = parseInput(Id, userId, "user id");
    const row = maybeOne(await db.select().from(founderProfiles).where(mine(id)).limit(1).for("update"));
    return row ? rowOf(row) : null;
  },

  /**
   * Whether another account holds this handle, or released it less than `PERSON_HANDLE_HOLD_DAYS` ago (it stays theirs).
   * Service connection only: under RLS a person sees no other row, and nobody but the service role reads the releases.
   */
  async handleTaken(db: Executor, userId: string, handle: string): Promise<boolean> {
    const held = await db.select({ id: founderProfiles.id }).from(founderProfiles).where(and(eq(founderProfiles.handle, handle), ne(founderProfiles.userId, userId))).limit(1);
    if (held.length > 0) return true;
    const released = await db
      .select({ id: personHandleReleases.id })
      .from(personHandleReleases)
      .where(and(eq(personHandleReleases.handle, handle), ne(personHandleReleases.userId, userId), sql`${personHandleReleases.releasedAt} > now() - make_interval(days => ${PERSON_HANDLE_HOLD_DAYS}::int)`))
      .limit(1);
    return released.length > 0;
  },

  /**
   * Saves what the person wrote (and the handle when one is given; `undefined` keeps it). Never changes `public` or
   * `published_at`. NOT_FOUND without an open founder profile.
   */
  async save(db: Executor, userId: string, input: SavePersonProfileInput): Promise<PersonProfileRow> {
    const id = parseInput(Id, userId, "user id");
    const v = parseInput(SaveInput, input, "public profile");
    const c = v.content;
    return handleGuard(async () => {
      const rows = await db
        .update(founderProfiles)
        .set({
          ...(v.handle !== undefined ? { handle: v.handle } : {}),
          headline: c.headline,
          about: c.about,
          strengths: c.strengths,
          wantsToLearn: c.wantsToLearn,
          lookingFor: c.lookingFor,
          place: c.place,
          updatedAt: new Date(),
        })
        .where(mine(id))
        .returning();
      if (!rows[0]) throw new NotFoundError("founder profile", id);
      return rowOf(rows[0]);
    });
  },

  /**
   * Makes the profile public. `published_at` moves only when it goes from private to public. NOT_FOUND without a
   * profile; a profile with no handle cannot go public (the table's check says the same).
   */
  async publish(db: Executor, userId: string, opts: { at?: Date } = {}): Promise<PersonProfileRow> {
    const id = parseInput(Id, userId, "user id");
    const at = opts.at ?? new Date();
    const rows = await db
      .update(founderProfiles)
      .set({ public: true, publishedAt: sql`case when ${founderProfiles.public} then ${founderProfiles.publishedAt} else ${at.toISOString()}::timestamptz end`, updatedAt: new Date() })
      .where(and(mine(id), sql`${founderProfiles.handle} is not null`))
      .returning();
    if (!rows[0]) throw new NotFoundError("public profile", id);
    return rowOf(rows[0]);
  },

  /** Takes the profile down (everything written stays). Null when it was not public. */
  async unpublish(db: Executor, userId: string): Promise<PersonProfileRow | null> {
    const id = parseInput(Id, userId, "user id");
    const rows = await db.update(founderProfiles).set({ public: false, updatedAt: new Date() }).where(and(mine(id), eq(founderProfiles.public, true))).returning();
    return rows[0] ? rowOf(rows[0]) : null;
  },

  /**
   * The project pages the person's public profile lists, by the view's own rule (published pages of projects they own
   * that name their founders), for the edit screen's preview. Service connection: it reads the public page view.
   */
  async projectsShown(db: Executor, userId: string): Promise<PublicPersonProject[]> {
    const id = parseInput(Id, userId, "user id");
    const rows = await db
      .select({ slug: publicProjectPages.slug, name: publicProjectPages.name, published: publicProjectPages.published })
      .from(publicProjectPages)
      .innerJoin(projectPages, eq(projectPages.slug, publicProjectPages.slug))
      .innerJoin(memberships, and(eq(memberships.businessId, projectPages.businessId), eq(memberships.userId, id), eq(memberships.role, "owner")))
      .where(sql`${publicProjectPages.published}->'showFounders' = 'true'::jsonb`)
      .orderBy(desc(publicProjectPages.publishedAt), publicProjectPages.slug);
    return rows.map((r) => ({ slug: r.slug, name: r.name, pitch: typeof r.published?.pitch === "string" ? r.published.pitch : "" }));
  },

  public: {
    /** A public profile by its handle, as the view exposes it; null for an unknown handle or a profile that is not public. */
    async byHandle(db: Executor, handle: string): Promise<PublicPerson | null> {
      if (!PersonHandle.safeParse(handle).success) return null;
      const row = maybeOne(await db.select().from(publicPersonProfiles).where(eq(publicPersonProfiles.handle, handle)).limit(1));
      if (!row) return null;
      return {
        handle: row.handle,
        displayName: row.displayName,
        content: readPersonProfile({ headline: row.headline, about: row.about, strengths: row.strengths, wantsToLearn: row.wantsToLearn, lookingFor: row.lookingFor, place: row.place }),
        publishedAt: row.publishedAt,
        projects: projectsOf(row.projects),
      };
    },
  },
};
