/**
 * founder_devices (0075) — account-scoped (userId first): the phones a signed-in person registered for push from the
 * mobile companion app (docs/mobile). One row per provider subscription id (`token`); the account that signed in on the
 * phone last owns it. Routers founder.devices.list/register/unregister.
 *
 * `register` is an upsert on the token. Run as the user under RLS it can only create the person's own row or refresh
 * it; a token another account still holds (a handed-over phone, a second account on one device) is invisible under
 * the policy and the upsert fails. The api therefore registers with the service role (`ctx.db`), so the token moves to
 * the account that just signed in: the previous owner stops getting that phone's pushes, which is what a sign-in on a
 * phone means. Nothing of the previous owner's is readable through it (a token carries no data; `list` and
 * `unregister` run as the user).
 */
import { DEVICE_PLATFORMS, PUSH_PROVIDERS, type DevicePlatform, type PushProvider } from "@foundmill/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { founderDevices } from "../schema";
import { parseInput, type Executor } from "./_shared";

const Token = z.string().trim().min(8).max(512);

/** What the app sends once it holds the provider's subscription id (after sign-in, and again on every launch). */
export const RegisterDeviceInput = z
  .object({
    platform: z.enum(DEVICE_PLATFORMS),
    provider: z.enum(PUSH_PROVIDERS).default("onesignal"),
    token: Token,
    appVersion: z.string().trim().max(40).default(""),
  })
  .strict();
export type RegisterDeviceInput = z.input<typeof RegisterDeviceInput>;

export const UnregisterDeviceInput = z.object({ token: Token }).strict();
export type UnregisterDeviceInput = z.input<typeof UnregisterDeviceInput>;

/** One registered phone, as the API answers it (instants as ISO strings). */
export interface FounderDeviceView {
  id: string;
  platform: DevicePlatform;
  provider: PushProvider;
  /** The provider's subscription id: the app compares it with its own to mark "this phone". */
  token: string;
  appVersion: string;
  lastSeenAt: string;
  createdAt: string;
}

const columns = {
  id: founderDevices.id,
  platform: founderDevices.platform,
  provider: founderDevices.provider,
  token: founderDevices.token,
  appVersion: founderDevices.appVersion,
  lastSeenAt: founderDevices.lastSeenAt,
  createdAt: founderDevices.createdAt,
};

type Row = { id: string; platform: DevicePlatform; provider: PushProvider; token: string; appVersion: string; lastSeenAt: Date; createdAt: Date };

const view = (row: Row): FounderDeviceView => ({ ...row, lastSeenAt: row.lastSeenAt.toISOString(), createdAt: row.createdAt.toISOString() });

export const devicesRepo = {
  /** The person's registered phones, the most recently seen first. */
  async list(db: Executor, userId: string): Promise<FounderDeviceView[]> {
    const rows = await db.select(columns).from(founderDevices).where(eq(founderDevices.userId, userId)).orderBy(desc(founderDevices.lastSeenAt), desc(founderDevices.id));
    return rows.map(view);
  },

  /**
   * Registers a phone for the person, or refreshes it (platform, provider, version, last seen) when the token is known.
   * With the service role a token another account held moves to this one; under RLS that case fails (see the file
   * comment). `created` says whether the row is new.
   */
  async register(db: Executor, userId: string, input: RegisterDeviceInput): Promise<{ device: FounderDeviceView; created: boolean }> {
    const v = parseInput(RegisterDeviceInput, input, "device");
    const rows = await db
      .insert(founderDevices)
      .values({ userId, platform: v.platform, provider: v.provider, token: v.token, appVersion: v.appVersion })
      .onConflictDoUpdate({
        target: founderDevices.token,
        set: { userId, platform: v.platform, provider: v.provider, appVersion: v.appVersion, lastSeenAt: sql`now()` },
      })
      .returning({ ...columns, created: sql<boolean>`(xmax = 0)` });
    const row = rows[0];
    if (!row) throw new Error("register device: insert returned no row");
    const { created, ...rest } = row;
    return { device: view(rest), created: Boolean(created) };
  },

  /** Forgets one of the person's phones (sign-out). Someone else's token is not theirs to forget: `removed` is false. */
  async unregister(db: Executor, userId: string, token: string): Promise<{ removed: boolean }> {
    const v = parseInput(UnregisterDeviceInput, { token }, "device");
    const rows = await db.delete(founderDevices).where(and(eq(founderDevices.userId, userId), eq(founderDevices.token, v.token))).returning({ id: founderDevices.id });
    return { removed: rows.length > 0 };
  },

  /**
   * Every registered phone of the given people, for the push fan-out (service role; a later change sends through the
   * gateway's connector). Grouped by user id, most recently seen first within a person.
   */
  async forUsers(db: Executor, userIds: readonly string[]): Promise<Map<string, FounderDeviceView[]>> {
    const out = new Map<string, FounderDeviceView[]>();
    if (userIds.length === 0) return out;
    const rows = await db
      .select({ ...columns, userId: founderDevices.userId })
      .from(founderDevices)
      .where(inArray(founderDevices.userId, [...userIds]))
      .orderBy(desc(founderDevices.lastSeenAt));
    for (const { userId, ...row } of rows) {
      const list = out.get(userId) ?? [];
      list.push(view(row));
      out.set(userId, list);
    }
    return out;
  },
};
