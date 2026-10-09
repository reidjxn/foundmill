/**
 * ideas, idea_versions, idea_comparisons — the Ideation Studio (BUILD §11.1; routers idea.*).
 * Account-scoped until commit: functions take `userId` first and filter on owner_user_id. `commit` stamps the
 * business id on the idea and every version/comparison so they become business-scoped history.
 */
import { randomUUID } from "node:crypto";
import { ARCHETYPES, ValidationError } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { IDEA_ACTIONS, ideaComparisons, ideaVersions, ideas, type Idea, type IdeaComparison, type IdeaVersion } from "../schema";
import { Id, maybeOne, numericText, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page } from "./_shared";

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
  attributes: Attributes.optional(),
  starsCurrent: Stars.optional(),
  starsPotential: Stars.optional(),
  research: Research.optional(),
  action: z.enum(IDEA_ACTIONS),
  /** Defaults to the idea's current version. */
  parentVersionId: Id.nullable().optional(),
});
export type AddIdeaVersionInput = z.input<typeof AddIdeaVersionInput>;

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

  /** Appends a version (merge / fork / edit / regenerate) and makes it current. */
  async addVersion(db: Executor, userId: string, ideaId: string, input: AddIdeaVersionInput): Promise<IdeaVersion> {
    const v = parseInput(AddIdeaVersionInput, input, "idea version");
    return db.transaction(async (tx) => {
      const current = await ideasRepo.get(tx, userId, ideaId);
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
          .returning(),
        "idea version",
      );
      await tx.update(ideas).set({ currentVersionId: version.id, title: version.title, pitch: version.pitch }).where(eq(ideas.id, ideaId));
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

  /** Commit: stamps the business on the idea, its versions and any comparison that includes one of them. */
  async commit(db: Executor, userId: string, ideaId: string, businessId: string): Promise<IdeaWithVersion> {
    parseInput(Id, businessId, "businessId");
    return db.transaction(async (tx) => {
      const idea = await ideasRepo.get(tx, userId, ideaId);
      if (idea.committedAt) throw new ValidationError("Idea is already committed", { ideaId });
      const now = new Date();
      await tx.update(ideas).set({ businessId, committedAt: now }).where(eq(ideas.id, ideaId));
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
