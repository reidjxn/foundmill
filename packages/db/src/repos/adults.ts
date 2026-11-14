/**
 * adult_confirmations (0100) — account-scoped (userId first): the person's own statement that they are 18 or older,
 * confirmed once at sign-up for the whole product (founder, 2026-11-11), and the source of truth for every check that
 * asks (the profile that creates an account, an invitation's accept, a new project, the network, going LIVE). The
 * network's `network_attestations` (0027) is kept in step with it by triggers, so a person the network already asked
 * reads as confirmed here, and the reverse.
 *
 * Runs as the person under RLS (they read and insert only their own row) or on the service connection. The time is the
 * database's: a client names only `user_id` (a column grant), the row holds now() (a trigger), and the first
 * confirmation stands.
 */
import { eq, sql } from "drizzle-orm";
import { adultConfirmations } from "../schema";
import { Id, one, parseInput, rowsOf, type Executor } from "./_shared";

export const adultsRepo = {
  /** When the person confirmed that they are 18 or older; null when they have not. */
  async confirmedAt(db: Executor, userId: string): Promise<Date | null> {
    const id = parseInput(Id, userId, "user id");
    const rows = await db.select({ at: adultConfirmations.confirmedAt }).from(adultConfirmations).where(eq(adultConfirmations.userId, id)).limit(1);
    return rows[0]?.at ?? null;
  },

  /** The same as a SQL expression (`is not null` reads as confirmed), for a caller that answers in one statement. */
  confirmedAtSql(userId: string) {
    const id = parseInput(Id, userId, "user id");
    return sql<Date | null>`(select ${adultConfirmations.confirmedAt} from ${adultConfirmations} where ${adultConfirmations.userId} = ${id}::uuid limit 1)`;
  },

  /**
   * Records the person's confirmation and answers when it was made. The first one stands: asking again writes nothing
   * and answers the first time (`created: false`).
   */
  async confirm(db: Executor, userId: string): Promise<{ confirmedAt: Date; created: boolean }> {
    const id = parseInput(Id, userId, "user id");
    // `user_id` alone: a client role may name no other column (0100's column grant), and every other value is the
    // database's. Drizzle's insert lists every column (as `default`), so the statement is written out.
    const inserted = rowsOf<{ user_id: string }>(await db.execute(sql`insert into adult_confirmations (user_id) values (${id}::uuid) on conflict (user_id) do nothing returning user_id`));
    // Read back through the schema, so the time is the same Date every other read answers.
    const row = one(await db.select({ at: adultConfirmations.confirmedAt }).from(adultConfirmations).where(eq(adultConfirmations.userId, id)).limit(1), "adult confirmation");
    return { confirmedAt: row.at, created: inserted.length > 0 };
  },
};
