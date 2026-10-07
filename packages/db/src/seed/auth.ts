/**
 * Owner provisioning (ARCHITECTURE §4 Seeds): on PGlite and local databases the demo founder is a plain row in the
 * stub `auth.users`; against a real Supabase project the users are created through the admin API with the service
 * role key and the seed only ever learns their ids.
 */
import { sql } from "drizzle-orm";
import type { Db } from "../client";
import { rowsOf } from "../repos/_shared";

export interface AuthProvisioner {
  /** Returns the auth user id for the email, creating the user when it does not exist. */
  ensureUser(email: string, options?: { preferredId?: string; displayName?: string }): Promise<string>;
  readonly kind: "stub" | "supabase";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stub auth: inserts into `auth.users (id, email, raw_user_meta_data)` as the PGlite harness and local dev databases define it. */
export function stubAuthProvisioner(db: Db): AuthProvisioner {
  return {
    kind: "stub",
    async ensureUser(email, options = {}) {
      const existing = rowsOf<{ id: string }>(await db.execute(sql`select id from auth.users where email = ${email} limit 1`));
      if (existing[0]) return existing[0].id;
      const id = options.preferredId && UUID_RE.test(options.preferredId) ? options.preferredId : crypto.randomUUID();
      const meta = JSON.stringify({ display_name: options.displayName ?? email.split("@")[0], seeded: true });
      const rows = rowsOf<{ id: string }>(
        await db.execute(
          sql`insert into auth.users (id, email, raw_user_meta_data) values (${id}::uuid, ${email}, ${meta}::jsonb)
              on conflict (email) do update set raw_user_meta_data = excluded.raw_user_meta_data returning id`,
        ),
      );
      const row = rows[0];
      if (!row) throw new Error(`stub auth: could not create ${email}`);
      return row.id;
    },
  };
}

interface AdminUser {
  id: string;
  email?: string | null;
}

interface AdminApi {
  createUser(attributes: { email: string; email_confirm: boolean; user_metadata?: Record<string, unknown> }): Promise<{ data: { user: AdminUser | null }; error: { message: string; status?: number } | null }>;
  listUsers(params: { page: number; perPage: number }): Promise<{ data: { users: AdminUser[] }; error: { message: string } | null }>;
}

/**
 * Supabase admin API (service role). Loaded lazily so the module never needs the client in tests.
 * Users already registered are found by paging `listUsers` (the admin API has no lookup by email).
 */
export async function supabaseAuthProvisioner(url: string, serviceRoleKey: string): Promise<AuthProvisioner> {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = client.auth.admin as unknown as AdminApi;

  async function findByEmail(email: string): Promise<string | null> {
    const wanted = email.toLowerCase();
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`supabase admin listUsers: ${error.message}`);
      const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
      if (hit) return hit.id;
      if (data.users.length < 200) break;
    }
    return null;
  }

  return {
    kind: "supabase",
    async ensureUser(email, options = {}) {
      const existing = await findByEmail(email);
      if (existing) return existing;
      const { data, error } = await admin.createUser({ email, email_confirm: true, user_metadata: { display_name: options.displayName ?? email.split("@")[0], seeded: true } });
      if (error) {
        const again = await findByEmail(email);
        if (again) return again;
        throw new Error(`supabase admin createUser(${email}): ${error.message}`);
      }
      if (!data.user) throw new Error(`supabase admin createUser(${email}) returned no user`);
      return data.user.id;
    },
  };
}

/** Parses SEED_OWNER_EMAILS ("a@x.com, b@y.com"). */
export function parseOwnerEmails(value: string | undefined | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[,\s;]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@")))];
}
