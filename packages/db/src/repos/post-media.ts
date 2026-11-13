/**
 * A post draft's media (0103 `post_media`; packages/shared `post-media.ts`): a short video and a voiceover for a post
 * the social agent drafted, made on the founder's own Runway and ElevenLabs accounts. One row per draft and kind.
 *
 * - `open` starts a row (`asking`) for a team post that waits to be shared, once: a second ask finds the first.
 * - `update` moves it along (`asking` → `making` → `ready`, or `declined`, `failed`, `simulated`). Only `store` makes a
 *   row `ready`, and only with its file: the file, its digest and its size are written together, under a lock per
 *   business, after the size per file (`postMediaMaxBytes`) and the project's total (`POST_MEDIA_LIMITS.perProjectBytes`)
 *   are checked. Past either, nothing is stored and the row says `failed` with a code.
 * - `markSimulated`: a mock connector answered. Nothing was made, so the row keeps no file and is never `ready` (the
 *   table's own checks say the same).
 * - Reads: `forAssets` (never the file), `content` (the file of a ready, real row only).
 *
 * Service connection: the orchestrator writes (`post-media.ts`), the api reads for the Creative tab and serves the file
 * at a signed address. A member's own reads go through RLS.
 */
import { createHash } from "node:crypto";
import { POST_MEDIA_LIMITS, postMediaMaxBytes, type PostMediaKind, type PostMediaMime, type PostMediaState } from "@foundmill/shared";
import { and, eq, inArray, ne, sql, sum } from "drizzle-orm";
import { postMedia, type PostMedia } from "../schema";
import { maybeOne, type Executor } from "./_shared";

/** A row as screens read it: everything but the file. */
export type PostMediaRow = Omit<PostMedia, "content">;

const columns = {
  id: postMedia.id,
  businessId: postMedia.businessId,
  assetId: postMedia.assetId,
  kind: postMedia.kind,
  state: postMedia.state,
  connectorKey: postMedia.connectorKey,
  approvalId: postMedia.approvalId,
  vendorRef: postMedia.vendorRef,
  simulated: postMedia.simulated,
  mime: postMedia.mime,
  sha256: postMedia.sha256,
  sizeBytes: postMedia.sizeBytes,
  durationSeconds: postMedia.durationSeconds,
  errorCode: postMedia.errorCode,
  createdAt: postMedia.createdAt,
  updatedAt: postMedia.updatedAt,
};

/** Why a file was not stored. */
export type PostMediaStoreRefusal = "too_large" | "storage_full" | "empty" | "not_found" | "simulated";

async function lock(tx: Executor, businessId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('post_media'), hashtext(${businessId}::text))`);
}

const scoped = (businessId: string, id: string) => and(eq(postMedia.businessId, businessId), eq(postMedia.id, id));

export const postMediaRepo = {
  /** The row of a draft's `kind`, created as `asking` when there is none yet. `created` says which. */
  async open(db: Executor, businessId: string, input: { assetId: string; kind: PostMediaKind; connectorKey: "runway" | "elevenlabs_voice" }): Promise<{ row: PostMediaRow; created: boolean }> {
    const inserted = await db
      .insert(postMedia)
      .values({ businessId, assetId: input.assetId, kind: input.kind, state: "asking", connectorKey: input.connectorKey })
      .onConflictDoNothing({ target: [postMedia.assetId, postMedia.kind] })
      .returning(columns);
    if (inserted[0]) return { row: inserted[0], created: true };
    const existing = maybeOne(await db.select(columns).from(postMedia).where(and(eq(postMedia.businessId, businessId), eq(postMedia.assetId, input.assetId), eq(postMedia.kind, input.kind))).limit(1));
    if (!existing) throw new Error("post_media: the draft belongs to another business");
    return { row: existing, created: false };
  },

  async get(db: Executor, businessId: string, id: string): Promise<PostMediaRow | null> {
    return maybeOne(await db.select(columns).from(postMedia).where(scoped(businessId, id)).limit(1));
  },

  /** Every row of the given drafts, never the files. */
  async forAssets(db: Executor, businessId: string, assetIds: readonly string[]): Promise<PostMediaRow[]> {
    if (assetIds.length === 0) return [];
    return db
      .select(columns)
      .from(postMedia)
      .where(and(eq(postMedia.businessId, businessId), inArray(postMedia.assetId, [...assetIds])));
  },

  /**
   * Moves a row along. `ready` is refused here (only `store` makes a row ready, with its file); a row that is already
   * `ready` or `simulated` is final and does not move. Returns the row when it changed.
   */
  async update(db: Executor, businessId: string, id: string, patch: { state: Exclude<PostMediaState, "ready" | "simulated">; approvalId?: string | null; vendorRef?: string | null; errorCode?: string | null; durationSeconds?: number | null }): Promise<PostMediaRow | null> {
    const rows = await db
      .update(postMedia)
      .set({
        state: patch.state,
        ...(patch.approvalId !== undefined ? { approvalId: patch.approvalId } : {}),
        ...(patch.vendorRef !== undefined ? { vendorRef: patch.vendorRef?.slice(0, 100) ?? null } : {}),
        ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
        ...(patch.durationSeconds !== undefined ? { durationSeconds: patch.durationSeconds } : {}),
        updatedAt: new Date(),
      })
      .where(and(scoped(businessId, id), ne(postMedia.state, "ready"), ne(postMedia.state, "simulated")))
      .returning(columns);
    return rows[0] ?? null;
  },

  /** A mock connector answered: nothing was made. The row keeps no file and is final. */
  async markSimulated(db: Executor, businessId: string, id: string, input: { durationSeconds?: number | null } = {}): Promise<PostMediaRow | null> {
    const rows = await db
      .update(postMedia)
      .set({ state: "simulated", simulated: true, content: null, sha256: null, sizeBytes: null, mime: null, errorCode: null, ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}), updatedAt: new Date() })
      .where(and(scoped(businessId, id), ne(postMedia.state, "ready")))
      .returning(columns);
    return rows[0] ?? null;
  },

  /**
   * Copies a finished file into the project's storage and makes the row `ready`, or refuses with a code (the row then
   * says `failed`). Checked under the business's lock: the file's own size for its kind and the project's total.
   */
  async store(db: Executor, businessId: string, id: string, input: { content: Uint8Array; mime: PostMediaMime; durationSeconds?: number | null }, options: { perProjectBytes?: number } = {}): Promise<{ stored: true; row: PostMediaRow } | { stored: false; reason: PostMediaStoreRefusal }> {
    const quota = options.perProjectBytes ?? POST_MEDIA_LIMITS.perProjectBytes;
    return db.transaction(async (tx) => {
      await lock(tx, businessId);
      const row = maybeOne(await tx.select(columns).from(postMedia).where(scoped(businessId, id)).limit(1));
      if (!row) return { stored: false as const, reason: "not_found" as const };
      if (row.simulated || row.state === "simulated") return { stored: false as const, reason: "simulated" as const };
      if (row.state === "ready") return { stored: true as const, row };
      const fail = async (reason: PostMediaStoreRefusal) => {
        await tx.update(postMedia).set({ state: "failed", errorCode: reason, updatedAt: new Date() }).where(scoped(businessId, id));
        return { stored: false as const, reason };
      };
      const size = input.content.byteLength;
      if (size === 0) return fail("empty");
      if (size > postMediaMaxBytes(row.kind as PostMediaKind)) return fail("too_large");
      const [used] = await tx
        .select({ n: sum(postMedia.sizeBytes) })
        .from(postMedia)
        .where(and(eq(postMedia.businessId, businessId), ne(postMedia.id, id)));
      if (Number(used?.n ?? 0) + size > quota) return fail("storage_full");
      const sha256 = createHash("sha256").update(input.content).digest("hex");
      const [updated] = await tx
        .update(postMedia)
        .set({ state: "ready", content: input.content, mime: input.mime, sha256, sizeBytes: size, errorCode: null, ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}), updatedAt: new Date() })
        .where(scoped(businessId, id))
        .returning(columns);
      return updated ? { stored: true as const, row: updated } : { stored: false as const, reason: "not_found" as const };
    });
  },

  /** The file of a ready, real row, or null for anything else (a simulated row never has one). */
  async content(db: Executor, businessId: string, id: string): Promise<{ row: PostMediaRow; content: Uint8Array } | null> {
    const found = maybeOne(await db.select().from(postMedia).where(and(scoped(businessId, id), eq(postMedia.state, "ready"), eq(postMedia.simulated, false))).limit(1));
    if (!found?.content) return null;
    const { content, ...row } = found;
    return { row, content };
  },

  /** Bytes the project keeps across every draft. */
  async usedBytes(db: Executor, businessId: string): Promise<number> {
    const [row] = await db.select({ n: sum(postMedia.sizeBytes) }).from(postMedia).where(eq(postMedia.businessId, businessId));
    return Number(row?.n ?? 0);
  },
};
