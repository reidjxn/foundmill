/**
 * audit_log — append-only, hash-chained per business (BUILD §7.2, ARCHITECTURE §4).
 *
 * `append` runs in a transaction: the `audit_log_chain` trigger takes the per-business advisory lock,
 * assigns `seq`, links `prev_hash` to the previous row and computes
 * `hash = sha256(prev | business | seq | actor | action | target | details | created_at)` (DECISIONS "Audit log
 * hash chain lives in the database"), so every writer produces one chain and no client can forge a hash.
 * The repo then checks, still inside the transaction, that the returned row links onto the previous one
 * and that the trigger's digest equals the same formula evaluated over the stored row (`hashOf`); a mismatch
 * rolls the append back. `verify` runs the database's full-chain check and returns the first broken seq.
 */
import { ACTOR_KINDS, ValidationError } from "@founder-manager/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLog, type AuditEntry } from "../schema";
import { DateRange, Id, JsonObject, one, PageInput, parseInput, rowsOf, seqKeyset, timeRange, toPage, type Executor, type Page } from "./_shared";

export const AppendAuditInput = z.object({
  actorKind: z.enum(ACTOR_KINDS),
  actorId: Id.nullable().optional(),
  /** Dotted verb, e.g. "task.create", "tool.call", "decision.made". */
  action: z.string().trim().min(1).max(120),
  target: JsonObject.default({}),
  details: JsonObject.default({}),
});
export type AppendAuditInput = z.input<typeof AppendAuditInput>;

export const AuditListFilter = PageInput.extend(DateRange.shape).extend({
  actorKind: z.enum(ACTOR_KINDS).optional(),
  actorId: Id.optional(),
  action: z.union([z.string(), z.array(z.string())]).optional(),
  /** Prefix match on action, e.g. "tool." for every tool call. */
  actionPrefix: z.string().max(120).optional(),
});
export type AuditListFilter = z.input<typeof AuditListFilter>;

const HEX64 = /^[0-9a-f]{64}$/;
const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

/** The chain digest of one stored row, evaluated in SQL so jsonb canonical text and timestamp formatting match the trigger exactly. */
function hashOf(db: Executor, row: Pick<AuditEntry, "id">): Promise<string | null> {
  return db
    .execute(
      sql`select encode(sha256(convert_to(
        coalesce(a.prev_hash, '') || '|' || a.business_id::text || '|' || a.seq::text || '|' ||
        a.actor_kind || '|' || coalesce(a.actor_id::text, '') || '|' || a.action || '|' ||
        a.target::text || '|' || a.details::text || '|' || to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'UTF8')), 'hex') as hash from audit_log a where a.id = ${row.id}::uuid`,
    )
    .then((res) => rowsOf<{ hash: string }>(res)[0]?.hash ?? null);
}

export const auditRepo = {
  /** Appends one entry and returns it with seq, prev_hash and hash filled in. */
  async append(db: Executor, businessId: string, input: AppendAuditInput): Promise<AuditEntry> {
    const v = parseInput(AppendAuditInput, input, "audit entry");
    return db.transaction(async (tx) => {
      // The same per-business lock the trigger takes (re-entrant in this transaction), so the "previous" read is the row the trigger links to.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('audit_log'), hashtext(${businessId}::text))`);
      const [previous] = await tx.select({ seq: auditLog.seq, hash: auditLog.hash }).from(auditLog).where(eq(auditLog.businessId, businessId)).orderBy(desc(auditLog.seq)).limit(1);
      const row = one(
        await tx.insert(auditLog).values({ businessId, actorKind: v.actorKind, actorId: v.actorId ?? null, action: v.action, target: v.target, details: v.details }).returning(),
        "audit entry",
      );
      const expectedPrev = previous?.hash ?? null;
      if (!HEX64.test(row.hash) || row.prevHash !== expectedPrev || (previous && Number(row.seq) !== Number(previous.seq) + 1)) {
        throw new ValidationError("Audit chain link mismatch", { seq: row.seq, prevHash: row.prevHash, expectedPrev });
      }
      const recomputed = await hashOf(tx, row);
      if (recomputed !== row.hash) throw new ValidationError("Audit hash mismatch", { seq: row.seq, hash: row.hash, recomputed });
      return row;
    });
  },

  /** Several entries in one transaction, in order (one tool call → several audit lines). */
  async appendMany(db: Executor, businessId: string, inputs: AppendAuditInput[]): Promise<AuditEntry[]> {
    const parsed = inputs.map((i) => parseInput(AppendAuditInput, i, "audit entry"));
    return db.transaction(async (tx) => {
      const out: AuditEntry[] = [];
      for (const v of parsed) out.push(await auditRepo.append(tx, businessId, v));
      return out;
    });
  },

  async get(db: Executor, businessId: string, entryId: string): Promise<AuditEntry> {
    return one(await db.select().from(auditLog).where(and(eq(auditLog.businessId, businessId), eq(auditLog.id, entryId))).limit(1), "audit entry", entryId);
  },

  /** Newest first by seq; cursor paging over seq. */
  async list(db: Executor, businessId: string, filter: AuditListFilter = {}): Promise<Page<AuditEntry>> {
    const f = parseInput(AuditListFilter, filter, "audit filter");
    const ks = seqKeyset<AuditEntry>(auditLog.seq, (r) => Number(r.seq));
    const actions = toArray(f.action);
    const rows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.businessId, businessId),
          f.actorKind ? eq(auditLog.actorKind, f.actorKind) : undefined,
          f.actorId ? eq(auditLog.actorId, f.actorId) : undefined,
          actions?.length ? inArray(auditLog.action, actions) : undefined,
          f.actionPrefix ? sql`left(${auditLog.action}, ${f.actionPrefix.length}) = ${f.actionPrefix}` : undefined,
          timeRange(auditLog.createdAt, f),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  /** The latest entry (chain head), or null. */
  async head(db: Executor, businessId: string): Promise<AuditEntry | null> {
    const rows = await db.select().from(auditLog).where(eq(auditLog.businessId, businessId)).orderBy(desc(auditLog.seq)).limit(1);
    return rows[0] ?? null;
  },

  /** Walks the whole chain in the database; `{ ok: true }` or the first broken seq. */
  async verify(db: Executor, businessId: string): Promise<{ ok: boolean; brokenSeq: number | null; length: number }> {
    const broken = rowsOf<{ broken: number | string | null }>(await db.execute(sql`select audit_log_verify(${businessId}::uuid) as broken`))[0]?.broken ?? null;
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(eq(auditLog.businessId, businessId));
    return { ok: broken === null, brokenSeq: broken === null ? null : Number(broken), length: Number(count?.n ?? 0) };
  },

  /** Recomputes one row's digest from its stored fields (what `append` checks and what tests compare to `hash`). */
  hashOf,
};
