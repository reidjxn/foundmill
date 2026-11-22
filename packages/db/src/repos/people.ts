/**
 * 0091 — the way in: admissions (account-scoped) and invitations (business-scoped). docs/NETWORK.md F5; docs/THESIS_REVIEW.md
 * packages 2.2 and 3.1; apps/api services/access.ts and invitations.ts are the callers and hold the rules a person meets.
 *
 * - `admissions`: service connection only, every function (no client role reads or writes the table).
 * - `invitations`: `create`, `list` and `revoke` work on a signed-in founder's RLS connection as well as the service
 *   one, so they never select `token_hash` or `email` (a client role is not granted them: every select and every
 *   `returning` names its columns). Everything about a token or an address (`byTokenHash`, `accept`, `decline`,
 *   `addressesOf`) is the service connection's.
 */
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { INVITATION_ROLES, type InvitationRole, type InvitationState } from "@foundmill/shared";
import { businesses, founderProfiles } from "../schema";
import { ADMISSION_KINDS, accountAdmissions, invitations, type AccountAdmission, type AdmissionKind } from "../schema/people";
import { Id, maybeOne, parseInput, type Executor } from "./_shared";

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const Address = z.email().max(254).transform((e) => e.trim().toLowerCase());
/** A key @foundmill/shared `addressKey` made: one `@`, lower case. */
const AddressKey = z.string().max(254).regex(/^[^@\s]+@[^@\s]+$/);

/* ---------------------------------------------------------------------------------------------------------------- */
/* account_admissions                                                                                                */
/* ---------------------------------------------------------------------------------------------------------------- */

/** The advisory lock open sign-up's count is taken under (`pg_advisory_xact_lock(7461, 89)`; 7461/1 is the migrator's). */
const OPEN_COUNT_LOCK = sql`select pg_advisory_xact_lock(7461, 89)`;

export const admissionsRepo = {
  async has(db: Executor, userId: string): Promise<boolean> {
    const rows = await db.select({ id: accountAdmissions.id }).from(accountAdmissions).where(eq(accountAdmissions.userId, parseInput(Id, userId, "user id"))).limit(1);
    return rows.length > 0;
  },

  async forUser(db: Executor, userId: string): Promise<AccountAdmission | null> {
    return maybeOne(await db.select().from(accountAdmissions).where(eq(accountAdmissions.userId, parseInput(Id, userId, "user id"))).limit(1));
  },

  /**
   * Records an admission once: the row written, or null when the account already had one (the first stays). `at` is its
   * time (the waitlist sweep's clock; default the database's). `addressKey` (0112, @foundmill/shared `addressKey`) is
   * kept for an `open` admission only: open sign-up's guards read it (`keyTaken`, `openSinceForDomain`).
   */
  async record(db: Executor, input: { userId: string; how: AdmissionKind; invitationId?: string | null; addressKey?: string | null; at?: Date }): Promise<AccountAdmission | null> {
    const v = parseInput(z.object({ userId: Id, how: z.enum(ADMISSION_KINDS), invitationId: Id.nullable().default(null), addressKey: AddressKey.nullable().default(null), at: z.date().optional() }), input, "admission");
    const rows = await db
      .insert(accountAdmissions)
      .values({ userId: v.userId, how: v.how, invitationId: v.how === "invitation" ? v.invitationId : null, addressKey: v.how === "open" ? v.addressKey : null, ...(v.at ? { createdAt: v.at, updatedAt: v.at } : {}) })
      .onConflictDoNothing({ target: accountAdmissions.userId })
      .returning();
    return rows[0] ?? null;
  },

  /** Takes the lock open sign-up's daily count is decided under, for the rest of the transaction. */
  async lockOpenCount(tx: Executor): Promise<void> {
    await tx.execute(OPEN_COUNT_LOCK);
  },

  /**
   * New accounts admitted since `since` (the start of the UTC day) that open sign-up's ceiling counts: those admitted
   * under it (`open`), those an invitation let in (`invitation`) and those the waitlist let in (`waitlist`), so neither
   * invitations nor the waitlist's daily number can add a second ceiling's worth.
   */
  async openSince(db: Executor, since: Date): Promise<number> {
    const [row] = await db.select({ n: count() }).from(accountAdmissions).where(and(inArray(accountAdmissions.how, ["open", "invitation", "waitlist"]), gte(accountAdmissions.createdAt, since)));
    return Number(row?.n ?? 0);
  },

  /** Whether an account was already admitted by open sign-up from the mailbox `key` (0112; any day). */
  async keyTaken(db: Executor, key: string): Promise<boolean> {
    const rows = await db.select({ id: accountAdmissions.id }).from(accountAdmissions).where(eq(accountAdmissions.addressKey, parseInput(AddressKey, key, "address key"))).limit(1);
    return rows.length > 0;
  },

  /** Accounts open sign-up admitted since `since` from addresses at `domain` exactly (0112; a subdomain is another domain). */
  async openSinceForDomain(db: Executor, since: Date, domain: string): Promise<number> {
    const d = parseInput(z.string().min(1).max(253), domain, "domain").toLowerCase();
    const [row] = await db
      .select({ n: count() })
      .from(accountAdmissions)
      .where(and(eq(accountAdmissions.how, "open"), gte(accountAdmissions.createdAt, since), sql`split_part(${accountAdmissions.addressKey}, '@', 2) = ${d}`));
    return Number(row?.n ?? 0);
  },

  /** New accounts that invitations made by `inviterUserId` let in since `since` (services/access.ts; the inviter's total counts since the epoch). */
  async admittedByInviterSince(db: Executor, inviterUserId: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(accountAdmissions)
      .innerJoin(invitations, eq(invitations.id, accountAdmissions.invitationId))
      .where(and(eq(accountAdmissions.how, "invitation"), eq(invitations.invitedByUserId, parseInput(Id, inviterUserId, "user id")), gte(accountAdmissions.createdAt, since)));
    return Number(row?.n ?? 0);
  },

  /** 0093's cutover: the moment the migration ran (`admission_existing_before()`). */
  async existingBefore(db: Executor): Promise<Date> {
    const res = (await db.execute(sql`select admission_existing_before() as at`)) as unknown as { rows?: { at: Date | string }[] } | { at: Date | string }[];
    const rows = Array.isArray(res) ? res : (res.rows ?? []);
    const at = rows[0]?.at;
    if (at === undefined || at === null) throw new Error("admission_existing_before() returned nothing");
    return at instanceof Date ? at : new Date(at);
  },

  /**
   * Whether the account was a person here before open sign-up: a founder profile created before `before` (0093's
   * cutover, or SIGNUP_EXISTING_BEFORE). Admitted without counting. A profile made since does not count.
   */
  async hasProfile(db: Executor, userId: string, before: Date): Promise<boolean> {
    const rows = await db
      .select({ id: founderProfiles.id })
      .from(founderProfiles)
      .where(and(eq(founderProfiles.userId, parseInput(Id, userId, "user id")), lt(founderProfiles.createdAt, parseInput(z.date(), before, "cutover"))))
      .limit(1);
    return rows.length > 0;
  },
};

/* ---------------------------------------------------------------------------------------------------------------- */
/* invitations                                                                                                       */
/* ---------------------------------------------------------------------------------------------------------------- */

/** The columns a client role may read: everything but `token_hash` and `email`. */
const SAFE = {
  id: invitations.id,
  businessId: invitations.businessId,
  role: invitations.role,
  invitedByUserId: invitations.invitedByUserId,
  state: invitations.state,
  expiresAt: invitations.expiresAt,
  acceptedByUserId: invitations.acceptedByUserId,
  acceptedAt: invitations.acceptedAt,
  declinedAt: invitations.declinedAt,
  revokedAt: invitations.revokedAt,
  revokedByUserId: invitations.revokedByUserId,
  createdAt: invitations.createdAt,
  updatedAt: invitations.updatedAt,
};
export interface InvitationRow {
  id: string;
  businessId: string;
  role: InvitationRole;
  invitedByUserId: string | null;
  state: InvitationState;
  expiresAt: Date;
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CreateInvitation = z.object({ tokenHash: Hex64, role: z.enum(INVITATION_ROLES), invitedByUserId: Id, email: Address.nullable().default(null), expiresAt: z.date() });

/** What the service reads of an invitation by its token: the row and the words its page shows. */
export interface InvitationByToken extends InvitationRow {
  email: string | null;
  businessName: string;
  businessArchived: boolean;
  businessIsDemo: boolean;
  inviterName: string | null;
}

export const invitationsRepo = {
  /** A pending invitation; under RLS the policies and the guard decide who may (see 0091). */
  async create(db: Executor, businessId: string, input: z.input<typeof CreateInvitation>): Promise<InvitationRow> {
    const bid = parseInput(Id, businessId, "business id");
    const v = parseInput(CreateInvitation, input, "invitation");
    const [row] = await db.insert(invitations).values({ businessId: bid, tokenHash: v.tokenHash, role: v.role as InvitationRole, invitedByUserId: v.invitedByUserId, email: v.email, expiresAt: v.expiresAt }).returning(SAFE);
    return row as InvitationRow;
  },

  /** The business's invitations, newest first. */
  async list(db: Executor, businessId: string, limit = 100): Promise<InvitationRow[]> {
    const bid = parseInput(Id, businessId, "business id");
    return (await db.select(SAFE).from(invitations).where(eq(invitations.businessId, bid)).orderBy(desc(invitations.createdAt), desc(invitations.id)).limit(Math.min(Math.max(1, limit), 200))) as InvitationRow[];
  },

  async get(db: Executor, businessId: string, id: string): Promise<InvitationRow | null> {
    return maybeOne((await db.select(SAFE).from(invitations).where(and(eq(invitations.businessId, parseInput(Id, businessId, "business id")), eq(invitations.id, parseInput(Id, id, "invitation id")))).limit(1)) as InvitationRow[]);
  },

  /** How many of the business's invitations still wait (pending, not past their date). */
  async pendingCount(db: Executor, businessId: string): Promise<number> {
    const [row] = await db.select({ n: count() }).from(invitations).where(and(eq(invitations.businessId, parseInput(Id, businessId, "business id")), eq(invitations.state, "pending"), gt(invitations.expiresAt, sql`now()`)));
    return Number(row?.n ?? 0);
  },

  /** Revokes a pending invitation: the row, or null when it was not pending (or not this business's). */
  async revoke(db: Executor, businessId: string, id: string, userId: string): Promise<InvitationRow | null> {
    const [row] = await db
      .update(invitations)
      .set({ state: "revoked", revokedAt: sql`now()`, revokedByUserId: parseInput(Id, userId, "user id") })
      .where(and(eq(invitations.businessId, parseInput(Id, businessId, "business id")), eq(invitations.id, parseInput(Id, id, "invitation id")), eq(invitations.state, "pending")))
      .returning(SAFE);
    return (row as InvitationRow | undefined) ?? null;
  },

  /** Service only: the addresses invitations were sent to, by id (the People tab shows them masked). */
  async addressesOf(db: Executor, businessId: string, ids: readonly string[]): Promise<Map<string, string>> {
    const list = parseInput(z.array(Id).max(200), [...ids], "invitation ids");
    if (list.length === 0) return new Map();
    const rows = await db.select({ id: invitations.id, email: invitations.email }).from(invitations).where(and(eq(invitations.businessId, parseInput(Id, businessId, "business id")), inArray(invitations.id, list), isNotNull(invitations.email)));
    return new Map(rows.map((r) => [r.id, r.email!]));
  },

  /** Service only: the invitation a token names (whatever its state), with its project's name and the inviter's. */
  async byTokenHash(db: Executor, tokenHash: string): Promise<InvitationByToken | null> {
    const hash = parseInput(Hex64, tokenHash, "invitation token hash");
    const row = maybeOne(
      await db
        .select({ ...SAFE, email: invitations.email, businessName: businesses.name, businessArchivedAt: businesses.archivedAt, businessIsDemo: businesses.isDemo, inviterName: founderProfiles.displayName })
        .from(invitations)
        .innerJoin(businesses, eq(businesses.id, invitations.businessId))
        .leftJoin(founderProfiles, and(eq(founderProfiles.userId, invitations.invitedByUserId), isNull(founderProfiles.archivedAt)))
        .where(eq(invitations.tokenHash, hash))
        .limit(1),
    );
    if (!row) return null;
    const { businessArchivedAt, ...rest } = row;
    return { ...(rest as unknown as InvitationRow), email: row.email, businessName: row.businessName, businessArchived: businessArchivedAt !== null, businessIsDemo: row.businessIsDemo, inviterName: row.inviterName?.trim() || null };
  },

  /** Service only: a pending invitation, still in date, is used by `userId` once: the row, or null. */
  async accept(db: Executor, id: string, userId: string): Promise<InvitationRow | null> {
    const [row] = await db
      .update(invitations)
      .set({ state: "accepted", acceptedAt: sql`now()`, acceptedByUserId: parseInput(Id, userId, "user id") })
      .where(and(eq(invitations.id, parseInput(Id, id, "invitation id")), eq(invitations.state, "pending"), gt(invitations.expiresAt, sql`now()`)))
      .returning(SAFE);
    return (row as InvitationRow | undefined) ?? null;
  },

  /** Service only: a pending invitation, still in date, is declined: the row, or null. */
  async decline(db: Executor, id: string): Promise<InvitationRow | null> {
    const [row] = await db
      .update(invitations)
      .set({ state: "declined", declinedAt: sql`now()` })
      .where(and(eq(invitations.id, parseInput(Id, id, "invitation id")), eq(invitations.state, "pending"), gt(invitations.expiresAt, sql`now()`)))
      .returning(SAFE);
    return (row as InvitationRow | undefined) ?? null;
  },

  /** Service only: the first invitation `userId` accepted, for the step that records who brought a new person. */
  async firstAcceptedBy(db: Executor, userId: string): Promise<InvitationRow | null> {
    return maybeOne((await db.select(SAFE).from(invitations).where(and(eq(invitations.acceptedByUserId, parseInput(Id, userId, "user id")), eq(invitations.state, "accepted"))).orderBy(asc(invitations.acceptedAt), asc(invitations.id)).limit(1)) as InvitationRow[]);
  },
};
