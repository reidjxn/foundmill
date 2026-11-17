/**
 * founder_notifications (0083; retention plan, founder 2026-11-11). Written by the platform's one sender, the gateway's
 * `/v1/notify/email` (founder 2026-11-12), with the service role; the api marks one opened when the founder comes back
 * through its link and spends a one-click answer.
 * A founder reads their own (Settings › Preferences › Email shows the latest) under RLS, without the HTML or the hash.
 *
 * The sender claims a notification before it sends it: `claim` inserts the row with its dedupe key and answers null
 * when the key exists, so two passes (two replicas, a retried call) never send the same thing twice.
 *
 * `businessId` null (0132) is the email about a kept card to a person with no project (kind `getting_started`): the
 * same calls take null and then match only the person's rows with no business.
 */
import { LIFECYCLE_EMAIL_KINDS, LIMITED_EMAIL_KINDS, type FounderNotificationChannel, type FounderNotificationKind, type LifecycleSent } from "@foundmill/shared";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { founderNotifications, type FounderNotification } from "../schema";
import { maybeOne, type Executor } from "./_shared";

export interface ClaimNotificationInput {
  /** Chosen by the caller when its links must carry the id before the row exists. */
  id?: string;
  userId: string;
  kind: FounderNotificationKind;
  channel?: FounderNotificationChannel;
  dedupeKey: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  inboxItemIds?: string[];
  action?: { itemId: string; optionId: string; tokenHash: string; expiresAt: Date } | null;
}

/** What a founder reads of their own notifications (no HTML, no hash). */
export interface NotificationView {
  id: string;
  kind: FounderNotificationKind;
  channel: FounderNotificationChannel;
  status: FounderNotification["status"];
  skipReason: string | null;
  subject: string;
  sentAt: string | null;
  openedAt: string | null;
  createdAt: string;
}

const LIMITED_KINDS = [...LIMITED_EMAIL_KINDS];

/** The rows of one business, or (null) the person's rows that belong to no business. */
const inScope = (businessId: string | null) => (businessId === null ? isNull(founderNotifications.businessId) : eq(founderNotifications.businessId, businessId));

export const notificationsRepo = {
  /** Inserts the notification as queued; null when one with the same dedupe key exists for this founder. */
  async claim(db: Executor, businessId: string | null, input: ClaimNotificationInput): Promise<FounderNotification | null> {
    const rows = await db
      .insert(founderNotifications)
      .values({
        ...(input.id ? { id: input.id } : {}),
        businessId,
        userId: input.userId,
        kind: input.kind,
        channel: input.channel ?? "email",
        dedupeKey: input.dedupeKey,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        inboxItemIds: input.inboxItemIds ?? [],
        actionItemId: input.action?.itemId ?? null,
        actionOptionId: input.action?.optionId ?? null,
        actionTokenHash: input.action?.tokenHash ?? null,
        actionExpiresAt: input.action?.expiresAt ?? null,
      })
      .onConflictDoNothing({ target: [founderNotifications.userId, founderNotifications.dedupeKey] })
      .returning();
    return rows[0] ?? null;
  },

  /** Records a decision not to send (the row is still claimed, so the same thing is not reconsidered). */
  async skip(db: Executor, businessId: string | null, input: { userId: string; kind: FounderNotificationKind; dedupeKey: string; reason: string; subject?: string }): Promise<boolean> {
    const rows = await db
      .insert(founderNotifications)
      .values({ businessId, userId: input.userId, kind: input.kind, dedupeKey: input.dedupeKey, status: "skipped", skipReason: input.reason, subject: input.subject ?? "" })
      .onConflictDoNothing({ target: [founderNotifications.userId, founderNotifications.dedupeKey] })
      .returning({ id: founderNotifications.id });
    return rows.length > 0;
  },

  /** Whether a dedupe key was already decided on (sent, skipped or failed). */
  async exists(db: Executor, businessId: string | null, userId: string, dedupeKey: string): Promise<boolean> {
    const row = maybeOne(await db.select({ id: founderNotifications.id }).from(founderNotifications).where(and(inScope(businessId), eq(founderNotifications.userId, userId), eq(founderNotifications.dedupeKey, dedupeKey))).limit(1));
    return row !== null;
  },

  async markSent(db: Executor, businessId: string | null, id: string, result: { mode: "mock" | "live"; providerMessageId: string | null; at?: Date }): Promise<void> {
    await db
      .update(founderNotifications)
      .set({ status: "sent", mode: result.mode, providerMessageId: result.providerMessageId, sentAt: result.at ?? new Date() })
      .where(and(inScope(businessId), eq(founderNotifications.id, id)));
  },

  async markFailed(db: Executor, businessId: string | null, id: string, reason: string): Promise<void> {
    await db.update(founderNotifications).set({ status: "failed", skipReason: reason.slice(0, 200) }).where(and(inScope(businessId), eq(founderNotifications.id, id)));
  },

  /**
   * The lifecycle emails (`getting_started`, `checkin`) decided on for these people in this business, or (null) with no
   * business, any age, newest first, by person: what `dueLifecycle` and `dueCardEmail` read (WP-04 T11, T12, T16).
   */
  async lifecycleHistory(db: Executor, businessId: string | null, userIds: readonly string[]): Promise<Map<string, LifecycleSent[]>> {
    const out = new Map<string, LifecycleSent[]>(userIds.map((u) => [u, []]));
    if (userIds.length === 0) return out;
    const rows = await db
      .select({ userId: founderNotifications.userId, dedupeKey: founderNotifications.dedupeKey, status: founderNotifications.status, sentAt: founderNotifications.sentAt, openedAt: founderNotifications.openedAt })
      .from(founderNotifications)
      .where(and(inScope(businessId), inArray(founderNotifications.userId, [...userIds]), inArray(founderNotifications.kind, [...LIFECYCLE_EMAIL_KINDS])))
      .orderBy(desc(founderNotifications.createdAt))
      .limit(200 * userIds.length);
    for (const r of rows) out.get(r.userId)?.push({ dedupeKey: r.dedupeKey, status: r.status, sentAt: r.sentAt, openedAt: r.openedAt });
    return out;
  },

  /** The founder came back through one of its links (first time only). True when this call set it. */
  async markOpened(db: Executor, businessId: string, userId: string, id: string, at: Date = new Date()): Promise<boolean> {
    const rows = await db
      .update(founderNotifications)
      .set({ openedAt: at })
      .where(and(eq(founderNotifications.businessId, businessId), eq(founderNotifications.userId, userId), eq(founderNotifications.id, id), isNull(founderNotifications.openedAt)))
      .returning({ id: founderNotifications.id });
    return rows.length > 0;
  },

  /** Event emails sent to this founder in this business since `since` (the daily limit; the briefs do not count). */
  async countLimitedSince(db: Executor, businessId: string, userId: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(founderNotifications)
      .where(and(eq(founderNotifications.businessId, businessId), eq(founderNotifications.userId, userId), eq(founderNotifications.status, "sent"), inArray(founderNotifications.kind, LIMITED_KINDS), gte(founderNotifications.sentAt, since)));
    return Number(row?.n ?? 0);
  },

  /** The founder's latest notifications in a business (Settings › Preferences › Email). Safe under RLS. */
  async listForUser(db: Executor, businessId: string, userId: string, limit = 20): Promise<NotificationView[]> {
    const rows = await db
      .select({
        id: founderNotifications.id,
        kind: founderNotifications.kind,
        channel: founderNotifications.channel,
        status: founderNotifications.status,
        skipReason: founderNotifications.skipReason,
        subject: founderNotifications.subject,
        sentAt: founderNotifications.sentAt,
        openedAt: founderNotifications.openedAt,
        createdAt: founderNotifications.createdAt,
      })
      .from(founderNotifications)
      .where(and(eq(founderNotifications.businessId, businessId), eq(founderNotifications.userId, userId)))
      .orderBy(desc(founderNotifications.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map((r) => ({ ...r, sentAt: r.sentAt?.toISOString() ?? null, openedAt: r.openedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }));
  },

  /**
   * The notification a one-click answer token belongs to, found by the token's hash (service role: the person who opens
   * the link may not be signed in). Never by business: the token is the only key the link carries.
   */
  async findByActionTokenHash(db: Executor, tokenHash: string): Promise<FounderNotification | null> {
    return maybeOne(await db.select().from(founderNotifications).where(eq(founderNotifications.actionTokenHash, tokenHash)).limit(1));
  },

  /** Spends the one-click answer: true only for the first caller (the token works once). */
  async useAction(db: Executor, businessId: string, id: string, at: Date = new Date()): Promise<boolean> {
    const rows = await db
      .update(founderNotifications)
      .set({ actionUsedAt: at, openedAt: sql`coalesce(${founderNotifications.openedAt}, ${at})` })
      .where(and(eq(founderNotifications.businessId, businessId), eq(founderNotifications.id, id), isNull(founderNotifications.actionUsedAt)))
      .returning({ id: founderNotifications.id });
    return rows.length > 0;
  },

  /** For the sweep's "already told them" checks and the tests. */
  async get(db: Executor, businessId: string, id: string): Promise<FounderNotification | null> {
    return maybeOne(await db.select().from(founderNotifications).where(and(eq(founderNotifications.businessId, businessId), eq(founderNotifications.id, id))).limit(1));
  },
};
