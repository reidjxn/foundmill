/**
 * Account export and closing, by request (WP-11 T16; A8-13). The Privacy Policy promises closing an account and exporting
 * all of a person's data by request, and deletion within 30 days. This is the operator's path: `apps/api` script
 * `account` runs it (docs/DEPLOY.md §4 "Closing an account by request"). Deleting the auth user is the founder's step in
 * the Supabase dashboard (F6) and is never done by code: nothing here deletes, and no agent can call any of it.
 *
 * `ACCOUNT_COLUMNS` classifies every column in `public` that holds a person's id: each foreign key to `auth.users`, plus
 * the listed ones without a key. `account-portability.test.ts` fails when a new key is not classified here.
 */
import { sql } from "drizzle-orm";
import type { Executor } from "./_shared";
import { portableValue, type PortableRow } from "./portability";

export interface AccountColumn {
  /** Whether `export` returns the rows that hold the person's id in this column. */
  export: boolean;
  /** What deleting the auth user does to the row (its foreign key's action), or "none" without a key. */
  onDelete: "cascade" | "set null" | "restrict" | "none";
  note?: string;
  /** Columns left out of the export: other people's private state, or values hidden from clients (security review). */
  omit?: readonly string[];
}

/** Keyed `table.column`. */
export const ACCOUNT_COLUMNS: Readonly<Record<string, AccountColumn>> = {
  "account_admissions.user_id": { export: false, onDelete: "cascade", note: "the admission record; the person is told they were let in" },
  "account_events.user_id": { export: true, onDelete: "cascade", omit: ["idempotency_key"] },
  "account_outbox.user_id": { export: false, onDelete: "cascade", note: "the delivery queue of the person's own events; the events themselves are exported" },
  "account_preferences.user_id": { export: true, onDelete: "cascade" },
  "adult_confirmations.user_id": { export: true, onDelete: "cascade" },
  "agent_messages.author_user_id": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "attributions.referrer_user_id": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "attributions.user_id": { export: true, onDelete: "cascade", omit: ["referrer_user_id"] },
  "businesses.created_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "communities.created_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "community_members.invited_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "community_members.user_id": { export: true, onDelete: "cascade" },
  "connections.blocked_by": { export: true, onDelete: "cascade" },
  "connections.from_user": { export: true, onDelete: "cascade" },
  "connections.to_user": { export: true, onDelete: "cascade" },
  "dashboard_layouts.user_id": { export: true, onDelete: "cascade" },
  "founder_cancel_links.user_id": { export: false, onDelete: "cascade", note: "one-time link token hashes; nothing a person can read" },
  "founder_departures.by_user_id": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "founder_departures.user_id": { export: true, onDelete: "cascade" },
  "founder_devices.user_id": { export: false, onDelete: "cascade", note: "phone push tokens; a credential, not something to email out" },
  "founder_notifications.user_id": { export: true, onDelete: "cascade", omit: ["action_token_hash"] },
  "founder_presence.user_id": { export: true, onDelete: "cascade" },
  "founder_profiles.user_id": { export: true, onDelete: "cascade" },
  "founder_visit_days.user_id": { export: true, onDelete: "cascade" },
  "goals.approved_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "idea_comparisons.owner_user_id": { export: true, onDelete: "cascade" },
  "idea_drafts.claimed_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "idea_versions.owner_user_id": { export: true, onDelete: "cascade" },
  "ideas.owner_user_id": { export: true, onDelete: "cascade" },
  "inbox_item_reads.user_id": { export: true, onDelete: "cascade" },
  "inbox_items.for_user_id": { export: true, onDelete: "cascade" },
  "inbox_items.from_user_id": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "invitations.accepted_by_user_id": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "invitations.invited_by_user_id": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "invitations.revoked_by_user_id": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "memberships.user_id": { export: true, onDelete: "cascade" },
  "messages.from_user": { export: true, onDelete: "cascade", omit: ["read_by"] },
  "network_attestations.user_id": { export: true, onDelete: "cascade" },
  "page_quizzes.approved_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "page_quizzes.updated_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "person_handle_releases.user_id": { export: false, onDelete: "cascade", note: "service-only: handles kept for the person for 90 days" },
  "post_reports.reporter_user_id": { export: true, onDelete: "cascade" },
  "post_reports.resolved_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "posts.author_user_id": { export: true, onDelete: "cascade", omit: ["screening", "moderated_by", "moderation_note"] },
  "posts.moderated_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "product_signoffs.decided_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "project_pages.published_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "project_pages.updated_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "project_postal_addresses.updated_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "reports.reporter_user_id": { export: true, onDelete: "cascade", omit: ["resolved_by"] },
  "reports.resolved_by": { export: false, onDelete: "set null", note: "the operator who resolved a report; the report is kept, the id is cleared" },
  "reports.target_user_id": { export: false, onDelete: "set null", note: "a report about the person stays for safety review with the person set null; never exported, so it does not reveal who reported them" },
  "saved_table_views.user_id": { export: true, onDelete: "cascade" },
  "showcase_consents.user_id": { export: true, onDelete: "cascade" },
  "showcase_requests.requested_by_user_id": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "spec_versions.published_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "team_call_turns.user_id": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "team_calls.started_by": { export: false, onDelete: "set null", note: "a reference inside a project's own records; the project keeps it, the id is cleared" },
  "waitlist_entries.user_id": { export: true, onDelete: "cascade" },
  "message_threads.participant_ids": { export: true, onDelete: "none", note: "an array without a foreign key: the person is a participant of these threads", omit: ["muted_ids", "left_ids"] },
};

export const ACCOUNT_EXPORT_FORMAT = "foundmill-account-export/1" as const;
export const ACCOUNT_EXPORT_MAX_ROWS = 10_000;

const ARRAY_COLUMNS: ReadonlySet<string> = new Set(["message_threads.participant_ids"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The table and column of a key, checked against the classification so no other name ever reaches SQL. */
function parts(key: string): { table: string; column: string } {
  if (!Object.hasOwn(ACCOUNT_COLUMNS, key)) throw new Error(`unclassified account column ${key}`);
  const [table, column] = key.split(".") as [string, string];
  return { table, column };
}

function matches(key: string, userId: string) {
  const { table, column } = parts(key);
  return ARRAY_COLUMNS.has(key) ? sql`${userId}::uuid = any(${sql.identifier(table)}.${sql.identifier(column)})` : sql`${sql.identifier(table)}.${sql.identifier(column)} = ${userId}::uuid`;
}

const rowsOf = async <T>(db: Executor, q: ReturnType<typeof sql>): Promise<T[]> => ((await db.execute(q)) as unknown as { rows: T[] }).rows;

function requireUserId(userId: string): void {
  if (!UUID_RE.test(userId)) throw new Error("userId must be a UUID");
}

export const accountPortabilityRepo = {
  /** Every exported row that holds the person's id, per `table.column`, at most 10,000 a column (listed in `truncated`). */
  async export(db: Executor, userId: string): Promise<{ format: typeof ACCOUNT_EXPORT_FORMAT; userId: string; generatedAt: string; tables: Record<string, PortableRow[]>; truncated: string[] }> {
    requireUserId(userId);
    const tables: Record<string, PortableRow[]> = {};
    const truncated: string[] = [];
    for (const [key, c] of Object.entries(ACCOUNT_COLUMNS)) {
      if (!c.export) continue;
      const { table } = parts(key);
      // A block is never shown to the person blocked (0016): their export leaves out a connection someone else blocked.
      const hiddenBlocks = table === "connections" ? sql` and not (status = 'blocked' and blocked_by is distinct from ${userId}::uuid)` : sql``;
      const found = await rowsOf<Record<string, unknown>>(db, sql`select * from ${sql.identifier(table)} where ${matches(key, userId)}${hiddenBlocks} limit ${ACCOUNT_EXPORT_MAX_ROWS + 1}`);
      const omitted = new Set(c.omit ?? []);
      if (found.length > ACCOUNT_EXPORT_MAX_ROWS) truncated.push(key);
      if (found.length) tables[key] = found.slice(0, ACCOUNT_EXPORT_MAX_ROWS).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !omitted.has(k)).map(([k, v]) => [k, portableValue(v)])));
    }
    return { format: ACCOUNT_EXPORT_FORMAT, userId, generatedAt: new Date().toISOString(), tables, truncated };
  },

  /**
   * What must happen before the auth user may be deleted: the real projects (archived ones too, which can be restored)
   * the person is the only unexpired owner or cofounder of (each is handed over or deleted first, or the project would be left without anyone), and how many
   * memberships they hold.
   */
  async closingPlan(db: Executor, userId: string): Promise<{ soleOwnerOf: { businessId: string; name: string }[]; memberships: number }> {
    requireUserId(userId);
    const sole = await rowsOf<{ business_id: string; name: string }>(db, sql`
      select b.id as business_id, b.name from businesses b
        join memberships m on m.business_id = b.id and m.user_id = ${userId}::uuid and m.role in ('owner', 'cofounder') and (m.expires_at is null or m.expires_at > now())
       where not b.is_demo
         and not exists (select 1 from memberships o where o.business_id = b.id and o.user_id <> ${userId}::uuid and o.role in ('owner', 'cofounder') and (o.expires_at is null or o.expires_at > now()))
       order by b.name`);
    const [count] = await rowsOf<{ n: number }>(db, sql`select count(*)::int as n from memberships where user_id = ${userId}::uuid`);
    return { soleOwnerOf: sole.map((r) => ({ businessId: r.business_id, name: r.name })), memberships: count?.n ?? 0 };
  },

  /** Classified columns that still hold the id, with their row counts (zero counts left out). */
  async leftovers(db: Executor, userId: string): Promise<{ column: string; rows: number }[]> {
    requireUserId(userId);
    const out: { column: string; rows: number }[] = [];
    for (const key of Object.keys(ACCOUNT_COLUMNS)) {
      const { table } = parts(key);
      const [r] = await rowsOf<{ n: number }>(db, sql`select count(*)::int as n from ${sql.identifier(table)} where ${matches(key, userId)}`);
      if (r && r.n > 0) out.push({ column: key, rows: r.n });
    }
    return out;
  },
};
