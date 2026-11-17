/**
 * ideas, idea_versions, idea_comparisons — the Ideation Studio (BUILD §11.1; routers idea.*).
 * Account-scoped until commit: functions take `userId` first and filter on owner_user_id. `commit` stamps the
 * business id on the idea and every version/comparison so they become business-scoped history.
 */
import { randomUUID } from "node:crypto";
import { ARCHETYPES, ConflictError, ValidationError } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { IDEA_ACTIONS, ideaComparisons, ideaVersions, ideas, type Idea, type IdeaComparison, type IdeaVersion } from "../schema";
import { Id, maybeOne, numericText, one, PageInput, parseInput, sqlState, timeKeyset, toPage, type Executor, type Page } from "./_shared";

const Stars = z.number().min(0).max(5);
const Attributes = z.record(z.string(), z.object({ value: z.number().int().min(1).max(20), evidence: z.string().optional() }));
const Research = z.object({ citations: z.array(z.unknown()) });

export const CreateIdeaInput = z.object({
  title: z.string().trim().min(1).max(120),
  pitch: z.string().max(4000).default(""),
  archetype: z.enum(ARCHETYPES).nullable().optional(),
  attributes: Attributes.default({}),
  starsCurrent: Stars.default(0),
  starsPotential: Stars.default(0),
  research: Research.default({ citations: [] }),
  action: z.enum(IDEA_ACTIONS).default("generated"),
});
export type CreateIdeaInput = z.input<typeof CreateIdeaInput>;

export const AddIdeaVersionInput = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pitch: z.string().max(4000).optional(),
  /** The kind of business, kept on the idea itself (a version has none): an edit may change it; null clears it. */
  archetype: z.enum(ARCHETYPES).nullable().optional(),
  attributes: Attributes.optional(),
  starsCurrent: Stars.optional(),
  starsPotential: Stars.optional(),
  research: Research.optional(),
  action: z.enum(IDEA_ACTIONS),
  /** Defaults to the idea's current version. */
  parentVersionId: Id.nullable().optional(),
});
export type AddIdeaVersionInput = z.input<typeof AddIdeaVersionInput>;

/** How many ideas `getMany` reads at once (the Studio's shortlisted and restored cards that are not on a loaded page). */
export const IDEAS_BY_ID_MAX = 100;

/** How many of a person's ideas (newest first) a change of their skill ratings re-rates at once. */
export const RERATE_IDEAS_MAX = 200;

const ownedIdea = (userId: string, ideaId: string) => and(eq(ideas.id, ideaId), eq(ideas.ownerUserId, userId), isNull(ideas.archivedAt));

export interface IdeaWithVersion extends Idea {
  current: IdeaVersion | null;
}

export const ideasRepo = {
  async listForUser(db: Executor, userId: string, page: PageInput = {}): Promise<Page<IdeaWithVersion>> {
    const p = parseInput(PageInput, page, "page");
    const ks = timeKeyset<{ idea: Idea; current: IdeaVersion | null }>(ideas.createdAt, ideas.id, (r) => ({ at: r.idea.createdAt, id: r.idea.id }));
    const rows = await db
      .select({ idea: ideas, current: ideaVersions })
      .from(ideas)
      .leftJoin(ideaVersions, eq(ideaVersions.id, ideas.currentVersionId))
      .where(and(eq(ideas.ownerUserId, userId), isNull(ideas.archivedAt), isNull(ideas.committedAt), ks.after(p.cursor)))
      .orderBy(...ks.orderBy)
      .limit(p.limit + 1);
    const result = toPage(rows, p, ks);
    return { items: result.items.map((r) => ({ ...r.idea, current: r.current })), nextCursor: result.nextCursor };
  },

  async get(db: Executor, userId: string, ideaId: string): Promise<IdeaWithVersion> {
    const rows = await db.select({ idea: ideas, current: ideaVersions }).from(ideas).leftJoin(ideaVersions, eq(ideaVersions.id, ideas.currentVersionId)).where(ownedIdea(userId, ideaId)).limit(1);
    const row = one(rows, "idea", ideaId);
    return { ...row.idea, current: row.current };
  },

  /**
   * The user's ideas among `ideaIds` that are still in the deck (not discarded, not committed), each with its current
   * version, newest first. The Studio pins its shortlisted and restored cards with this when they are older than the
   * pages it has loaded; an id that is not such an idea is simply absent from the answer.
   */
  async getMany(db: Executor, userId: string, ideaIds: readonly string[]): Promise<IdeaWithVersion[]> {
    const ids = parseInput(z.array(Id).max(IDEAS_BY_ID_MAX), [...new Set(ideaIds)], "idea ids");
    if (ids.length === 0) return [];
    const rows = await db
      .select({ idea: ideas, current: ideaVersions })
      .from(ideas)
      .leftJoin(ideaVersions, eq(ideaVersions.id, ideas.currentVersionId))
      .where(and(eq(ideas.ownerUserId, userId), inArray(ideas.id, ids), isNull(ideas.archivedAt), isNull(ideas.committedAt)))
      .orderBy(desc(ideas.createdAt), desc(ideas.id));
    return rows.map((r) => ({ ...r.idea, current: r.current }));
  },

  /**
   * The idea the user saved from an Import job (Import's "Continue to Commit" records the job id in the version's meta
   * entry, `research.citations[] = { kind: "foundmill:meta", import_job_id }`): the first one saved, committed or not,
   * unless discarded. Null when the job has no idea yet. Makes Continue idempotent per job.
   */
  async findByImportJob(db: Executor, userId: string, importJobId: string): Promise<IdeaWithVersion | null> {
    const meta = JSON.stringify({ citations: [{ kind: "foundmill:meta", import_job_id: importJobId }] });
    const rows = await db
      .select({ idea: ideas, current: ideaVersions })
      .from(ideas)
      .innerJoin(ideaVersions, eq(ideaVersions.id, ideas.currentVersionId))
      .where(and(eq(ideas.ownerUserId, userId), isNull(ideas.archivedAt), sql`${ideaVersions.research} @> ${meta}::jsonb`))
      .orderBy(asc(ideas.createdAt), asc(ideas.id))
      .limit(1);
    const row = rows[0];
    return row ? { ...row.idea, current: row.current } : null;
  },

  /** Which of `ideaIds` are the user's discarded (not committed) ideas: the ones `restore` can bring back. */
  async discardedAmong(db: Executor, userId: string, ideaIds: readonly string[]): Promise<string[]> {
    const ids = parseInput(z.array(Id).max(IDEAS_BY_ID_MAX), [...new Set(ideaIds)], "idea ids");
    if (ids.length === 0) return [];
    const rows = await db
      .select({ id: ideas.id })
      .from(ideas)
      .where(and(eq(ideas.ownerUserId, userId), inArray(ideas.id, ids), isNotNull(ideas.archivedAt), isNull(ideas.committedAt)));
    return rows.map((r) => r.id);
  },

  /** Creates the idea and its first version in one transaction. */
  async create(db: Executor, userId: string, input: CreateIdeaInput): Promise<IdeaWithVersion> {
    const v = parseInput(CreateIdeaInput, input, "idea");
    return db.transaction(async (tx) => {
      const idea = one(await tx.insert(ideas).values({ ownerUserId: userId, title: v.title, pitch: v.pitch, archetype: v.archetype ?? null }).returning(), "idea");
      const version = one(
        await tx
          .insert(ideaVersions)
          .values({
            ideaId: idea.id,
            ownerUserId: userId,
            version: 1,
            title: v.title,
            pitch: v.pitch,
            attributes: v.attributes,
            starsCurrent: numericText(v.starsCurrent) ?? "0",
            starsPotential: numericText(v.starsPotential) ?? "0",
            research: v.research,
            action: v.action,
          })
          .returning(),
        "idea version",
      );
      const updated = one(await tx.update(ideas).set({ currentVersionId: version.id }).where(eq(ideas.id, idea.id)).returning(), "idea");
      return { ...updated, current: version };
    });
  },

  /**
   * Several ideas, each with its first version, in one transaction of three statements however many there are: the
   * ideas, their versions, then one update pointing each idea at its version (the two tables reference each other, so
   * the link is written last). The Ideation Studio writes a drafted set this way (DECISIONS 2026-10-09 "Commit writes
   * the team in batches" is the precedent). Results come back in the order given.
   */
  async createMany(db: Executor, userId: string, inputs: readonly CreateIdeaInput[]): Promise<IdeaWithVersion[]> {
    if (inputs.length === 0) return [];
    const list = inputs.map((input) => ({ ...parseInput(CreateIdeaInput, input, "idea"), id: randomUUID() }));
    return db.transaction(async (tx) => {
      await tx.insert(ideas).values(list.map((v) => ({ id: v.id, ownerUserId: userId, title: v.title, pitch: v.pitch, archetype: v.archetype ?? null })));
      const versions = await tx
        .insert(ideaVersions)
        .values(
          list.map((v) => ({
            ideaId: v.id,
            ownerUserId: userId,
            version: 1,
            title: v.title,
            pitch: v.pitch,
            attributes: v.attributes,
            starsCurrent: numericText(v.starsCurrent) ?? "0",
            starsPotential: numericText(v.starsPotential) ?? "0",
            research: v.research,
            action: v.action,
          })),
        )
        .returning();
      const linked = await tx
        .update(ideas)
        .set({ currentVersionId: sql`(select ${ideaVersions.id} from ${ideaVersions} where ${ideaVersions.ideaId} = ${ideas.id} and ${ideaVersions.version} = 1)` })
        .where(and(eq(ideas.ownerUserId, userId), inArray(ideas.id, list.map((v) => v.id))))
        .returning();
      const ideaById = new Map(linked.map((i) => [i.id, i] as const));
      const versionByIdea = new Map(versions.map((v) => [v.ideaId, v] as const));
      return list.map((v) => ({ ...one([ideaById.get(v.id)].filter((i): i is Idea => i !== undefined), "idea", v.id), current: versionByIdea.get(v.id) ?? null }));
    });
  },

  /**
   * Appends a version (merge / fork / edit / regenerate) and makes it current. The idea's row is locked first, so
   * versions of one idea are written one after another: two at once (an Ask from two tabs, a retried request) each get
   * the next number instead of colliding on (idea_id, version), and an input given as a function is built from the
   * version that is current at that moment (the Ask appends its answer to the Q&A the version before it holds, never to
   * a copy read before its model call). A collision that still happens is a conflict, never an internal error.
   */
  async addVersion(db: Executor, userId: string, ideaId: string, input: AddIdeaVersionInput | ((current: IdeaWithVersion) => AddIdeaVersionInput)): Promise<IdeaVersion> {
    return db.transaction(async (tx) => {
      one(await tx.select({ id: ideas.id }).from(ideas).where(ownedIdea(userId, ideaId)).for("update"), "idea", ideaId);
      const current = await ideasRepo.get(tx, userId, ideaId);
      const v = parseInput(AddIdeaVersionInput, typeof input === "function" ? input(current) : input, "idea version");
      const base = current.current;
      const next = one(await tx.select({ n: sql<number>`coalesce(max(${ideaVersions.version}), 0) + 1` }).from(ideaVersions).where(eq(ideaVersions.ideaId, ideaId)), "version");
      const version = one(
        await tx
          .insert(ideaVersions)
          .values({
            ideaId,
            ownerUserId: userId,
            businessId: current.businessId,
            version: Number(next.n),
            title: v.title ?? base?.title ?? current.title,
            pitch: v.pitch ?? base?.pitch ?? current.pitch,
            attributes: v.attributes ?? base?.attributes ?? {},
            starsCurrent: numericText(v.starsCurrent) ?? base?.starsCurrent ?? "0",
            starsPotential: numericText(v.starsPotential) ?? base?.starsPotential ?? "0",
            research: v.research ?? base?.research ?? { citations: [] },
            action: v.action,
            parentVersionId: v.parentVersionId === undefined ? (base?.id ?? null) : v.parentVersionId,
          })
          .returning()
          .catch((err: unknown) => {
            if (sqlState(err) === "23505") throw new ConflictError("Another change to this concept was saved at the same moment. Try again.", { ideaId });
            throw err;
          }),
        "idea version",
      );
      await tx
        .update(ideas)
        .set({ currentVersionId: version.id, title: version.title, pitch: version.pitch, ...(v.archetype !== undefined ? { archetype: v.archetype } : {}) })
        .where(eq(ideas.id, ideaId));
      return version;
    });
  },

  async versions(db: Executor, userId: string, ideaId: string): Promise<IdeaVersion[]> {
    await ideasRepo.get(db, userId, ideaId);
    return db.select().from(ideaVersions).where(eq(ideaVersions.ideaId, ideaId)).orderBy(asc(ideaVersions.version));
  },

  /** Records a Compare verdict over 2–4 versions the user owns. */
  async compare(db: Executor, userId: string, input: { ideaVersionIds: string[]; verdictMd: string }): Promise<IdeaComparison> {
    const v = parseInput(z.object({ ideaVersionIds: z.array(Id).min(2).max(4), verdictMd: z.string() }), input, "comparison");
    const owned = await db.select({ id: ideaVersions.id }).from(ideaVersions).where(and(inArray(ideaVersions.id, v.ideaVersionIds), eq(ideaVersions.ownerUserId, userId)));
    if (owned.length !== v.ideaVersionIds.length) throw new ValidationError("Every compared version must belong to the user", { ideaVersionIds: v.ideaVersionIds });
    return one(await db.insert(ideaComparisons).values({ ownerUserId: userId, ideaVersionIds: v.ideaVersionIds, verdictMd: v.verdictMd }).returning(), "comparison");
  },

  async listComparisons(db: Executor, userId: string): Promise<IdeaComparison[]> {
    return db.select().from(ideaComparisons).where(and(eq(ideaComparisons.ownerUserId, userId), isNull(ideaComparisons.archivedAt))).orderBy(desc(ideaComparisons.createdAt));
  },

  async discard(db: Executor, userId: string, ideaId: string): Promise<Idea> {
    return one(await db.update(ideas).set({ archivedAt: new Date() }).where(ownedIdea(userId, ideaId)).returning(), "idea", ideaId);
  },

  /**
   * Undo a discard (AC-11.1.3 "Discard is reversible"): the idea is back in the deck and every action works on it again.
   * Restoring an idea that is not discarded changes nothing; one that is not the user's is not found.
   */
  async restore(db: Executor, userId: string, ideaId: string): Promise<IdeaWithVersion> {
    parseInput(Id, ideaId, "ideaId");
    await db.update(ideas).set({ archivedAt: null }).where(and(eq(ideas.id, ideaId), eq(ideas.ownerUserId, userId), isNotNull(ideas.archivedAt)));
    return ideasRepo.get(db, userId, ideaId);
  },

  /**
   * Founder fit re-rated in place on every idea the person still holds as an idea (not committed, not discarded), when
   * their skill ratings change (WP-14 T2: the quick profile, then "sharpen"). `rerate` is given the current version's
   * Founder fit (null when the card has none) and the idea's kind of business, and answers the new rating and its
   * evidence, or null to leave the card as it is. Only the current version's `founder_fit` entry is written: no new
   * version, since nothing the person or the agent wrote changed. Answers how many cards changed.
   */
  async rerateFounderFit(db: Executor, userId: string, rerate: (current: number | null, archetype: Idea["archetype"]) => { value: number; evidence: string } | null): Promise<number> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({ versionId: ideaVersions.id, attributes: ideaVersions.attributes, archetype: ideas.archetype })
        .from(ideas)
        .innerJoin(ideaVersions, eq(ideaVersions.id, ideas.currentVersionId))
        .where(and(eq(ideas.ownerUserId, userId), isNull(ideas.archivedAt), isNull(ideas.committedAt)))
        .orderBy(desc(ideas.createdAt))
        .limit(RERATE_IDEAS_MAX)
        .for("update", { of: ideaVersions });
      let changed = 0;
      for (const row of rows) {
        const attributes = (row.attributes ?? {}) as Record<string, { value: number; evidence?: string }>;
        // A card still being drafted has no ratings yet: its fit is rated when it is written, from the profile as it is then.
        if (Object.keys(attributes).length === 0) continue;
        const current = attributes.founder_fit?.value ?? null;
        const next = rerate(current, row.archetype);
        if (!next || next.value === current) continue;
        const value = Math.min(20, Math.max(1, Math.round(next.value)));
        await tx.update(ideaVersions).set({ attributes: { ...attributes, founder_fit: { value, evidence: next.evidence } } }).where(eq(ideaVersions.id, row.versionId));
        changed += 1;
      }
      return changed;
    });
  },

  /**
   * "Take charge" claims the idea before anything is created: `committed_at` is stamped only while it is still null, in
   * one statement, so of two concurrent commits exactly one gets the row; the other waits for the winner's row lock,
   * then finds the idea committed (false) and creates nothing. Run it inside the commit's transaction so a commit that
   * fails releases the claim. Not found when the idea is not the user's (or was discarded).
   */
  async claimForCommit(db: Executor, userId: string, ideaId: string): Promise<boolean> {
    const claimed = await db.update(ideas).set({ committedAt: new Date() }).where(and(ownedIdea(userId, ideaId), isNull(ideas.committedAt))).returning({ id: ideas.id });
    if (claimed.length > 0) return true;
    await ideasRepo.get(db, userId, ideaId);
    return false;
  },

  /**
   * Commit: stamps the business on the idea (claimed by `claimForCommit` in the same transaction, or claimed here), its
   * versions and any comparison that includes one of them. The stamp is conditional on the idea having no business
   * yet, so a second commit can never re-point an idea at another business.
   */
  async commit(db: Executor, userId: string, ideaId: string, businessId: string): Promise<IdeaWithVersion> {
    parseInput(Id, businessId, "businessId");
    return db.transaction(async (tx) => {
      const stamped = await tx
        .update(ideas)
        .set({ businessId, committedAt: sql`coalesce(${ideas.committedAt}, now())` })
        .where(and(ownedIdea(userId, ideaId), isNull(ideas.businessId)))
        .returning({ id: ideas.id });
      if (stamped.length === 0) {
        await ideasRepo.get(tx, userId, ideaId);
        throw new ValidationError("Idea is already committed", { ideaId });
      }
      const versionIds = (await tx.update(ideaVersions).set({ businessId }).where(eq(ideaVersions.ideaId, ideaId)).returning({ id: ideaVersions.id })).map((r) => r.id);
      if (versionIds.length) {
        await tx
          .update(ideaComparisons)
          .set({ businessId })
          .where(and(eq(ideaComparisons.ownerUserId, userId), sql`${ideaComparisons.ideaVersionIds} && array[${sql.join(versionIds.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`));
      }
      return ideasRepo.get(tx, userId, ideaId);
    });
  },

  /** Business-scoped history: the committed idea of a business, with its versions. */
  async forBusiness(db: Executor, businessId: string): Promise<{ idea: Idea; versions: IdeaVersion[] } | null> {
    const idea = maybeOne(await db.select().from(ideas).where(eq(ideas.businessId, businessId)).orderBy(desc(ideas.committedAt)).limit(1));
    if (!idea) return null;
    const versions = await db.select().from(ideaVersions).where(and(eq(ideaVersions.ideaId, idea.id), eq(ideaVersions.businessId, businessId))).orderBy(asc(ideaVersions.version));
    return { idea, versions };
  },
};
