/**
 * Settings › Danger zone (BUILD §11.15): export everything, archive and restore the business, permanent deletion
 * (founder-only, re-authentication, 7-day delay).
 *
 * - `exportBusiness` reads every exported business-scoped table (packages/db `EXPORT_TABLES`, page by page until each
 *   is exhausted) through the portability repository and returns the archive to the browser, which saves it as a
 *   file; nothing is stored on the server. Credentials are never read; integrations appear as status rows only;
 *   sections the member is walled off are left out. The founder gets an Inbox note with the counts and the file name.
 * - `archiveBusiness` pulls the kill switch, then archives the row (hidden from lists and from every procedure but
 *   export, restore and deletion). `restoreBusiness` (owner) brings it back; its agents stay stopped until resumed.
 * - `requestDeletion` / `cancelDeletion` record the request on the audit chain (append-only, hash-chained) with the
 *   scheduled date 7 days out, for an active or an archived business; nothing is deleted by the API process (a
 *   deletion job outside this wave consumes the request). The request needs a fresh authentication (`authenticatedAt`
 *   from the token's `amr`).
 */
import { APP_NAME } from "@foundmill/config";
import { EXPORT_EXCLUDED_TABLES, EXPORT_SECTIONS, EXPORT_TABLES, portableValue, repos, type Business, type Executor, type ExportSection, type InboxItem, type PortableRow } from "@foundmill/db";
import { AppError, ValidationError } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, effectivePermission } from "../trpc";
import { stopAllAgents, type StopAllResult } from "./killswitch";

export const EXPORT_FORMAT = "foundmill-export/2" as const;
export const DELETION_DELAY_DAYS = 7;
/** How recent the authentication must be for permanent actions (BUILD §11.15 "re-auth"). */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;
export const DELETION_REQUEST_ACTION = "business.request_deletion";
export const DELETION_CANCEL_ACTION = "business.cancel_deletion";
/** Rows read per round trip while a table is exported. */
export const EXPORT_PAGE_ROWS = 1000;
/**
 * The most rows one table may put in a single archive (a memory bound for one request, far above any business today).
 * A table that reaches it is named in `truncated`, in the toast and in the Inbox note: never a silent cut.
 */
export const EXPORT_MAX_TABLE_ROWS = 250_000;

const DAY_MS = 86_400_000;

export interface ExportArchive {
  format: typeof EXPORT_FORMAT;
  app: string;
  generatedAt: string;
  business: PortableRow;
  /** Every exported business-scoped table by its SQL name: rows in id order, dates as ISO strings, bytes as base64. */
  tables: Record<string, PortableRow[]>;
  counts: Record<string, number>;
  /** Tables that reached EXPORT_MAX_TABLE_ROWS; empty when the archive is complete. */
  truncated: { table: string; rows: number }[];
  /** What was left out on purpose, and why. */
  excluded: { what: string; why: string }[];
}

export interface ExportResult {
  exportId: string;
  generatedAt: string;
  format: typeof EXPORT_FORMAT;
  /** The name the browser saves the archive under (`<slug>-export-<YYYY-MM-DD>.json`). */
  fileName: string;
  counts: Record<string, number>;
  totalRows: number;
  complete: boolean;
  sizeBytes: number;
  archive: ExportArchive;
  inboxItem: InboxItem | null;
}

const EXCLUDED_ALWAYS = [
  { what: "Credentials and connector tokens", why: "Never exported, as ciphertext or plaintext." },
  { what: "Other members' personal data", why: "Members appear by account id and role only." },
  { what: "LIVE network messages", why: "They belong to the conversations on the network, not to the business." },
] as const;

/** `ledgerly-export-2026-10-12.json`: the slug, the UTC date of the export. */
export function exportFileName(business: Pick<Business, "slug" | "name">, generatedAt: string): string {
  const base = (business.slug || business.name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "business";
  return `${base}-export-${generatedAt.slice(0, 10)}.json`;
}

/** The sections this member may not read: their tables stay out of the archive (BUILD §11.9 staff permissions). */
function walledSections(membership: BusinessContext["membership"]): ExportSection[] {
  return EXPORT_SECTIONS.filter((section) => effectivePermission(membership, section) === "none");
}

/**
 * Export everything (admin; also on an archived business): every exported business-scoped table, page by page until
 * each is exhausted, in one RLS transaction (one consistent snapshot) and through the portability repository only.
 * Credentials are never read. The archive goes back to the caller as JSON-safe data that the browser saves as a file;
 * nothing is kept on the server. The founder gets an Inbox note with the counts and the file name.
 */
export async function exportBusiness(ctx: BusinessContext): Promise<ExportResult> {
  const generatedAt = new Date().toISOString();
  const walled = walledSections(ctx.membership);
  const { tables, truncated } = await ctx.rls(async (tx) => {
    const out: Record<string, PortableRow[]> = {};
    const cut: { table: string; rows: number }[] = [];
    for (const [name, spec] of Object.entries(EXPORT_TABLES)) {
      if (walled.includes(spec.section)) continue;
      const rows: PortableRow[] = [];
      let after: string | null = null;
      do {
        const page = await repos.portability.page(tx, ctx.businessId, name, { after, limit: EXPORT_PAGE_ROWS });
        rows.push(...page.rows);
        after = page.nextAfter;
        if (after && rows.length >= EXPORT_MAX_TABLE_ROWS) {
          cut.push({ table: name, rows: rows.length });
          break;
        }
      } while (after);
      out[name] = rows;
    }
    return { tables: out, truncated: cut };
  });

  const { createdBy: _createdBy, ...business } = ctx.business;
  const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
  const totalRows = Object.values(counts).reduce((n, c) => n + c, 0);
  const excluded = [
    ...EXCLUDED_ALWAYS,
    ...Object.entries(EXPORT_EXCLUDED_TABLES).map(([table, why]) => ({ what: table, why })),
    ...walled.map((section) => ({ what: `The ${section} section`, why: "Your role has no access to it, so its tables are not in your export." })),
  ];
  const archive: ExportArchive = {
    format: EXPORT_FORMAT,
    app: APP_NAME,
    generatedAt,
    business: Object.fromEntries(Object.entries(business).map(([k, v]) => [k, portableValue(v)])),
    tables,
    counts,
    truncated,
    excluded,
  };
  const sizeBytes = Buffer.byteLength(JSON.stringify(archive), "utf8");
  const exportId = crypto.randomUUID();
  const fileName = exportFileName(ctx.business, generatedAt);

  const inboxItem = await ctx.rls(async (tx) => {
    const chief = await repos.agents.chiefOfStaff(tx, ctx.businessId);
    await audit(tx, ctx, { action: "business.export", target: { kind: "business", id: ctx.businessId }, details: { exportId, fileName, tables: Object.keys(tables).length, totalRows, sizeBytes, format: EXPORT_FORMAT, truncated, walled } });
    if (!chief) return null;
    return repos.inbox.createItem(
      tx,
      ctx.businessId,
      {
        type: "update",
        from_agent_id: chief.id,
        subject: "Your export is ready",
        body_md: exportNote({ name: ctx.business.name, fileName, counts, totalRows, sizeBytes, truncated, walled }),
        status_strip: [],
        exhibit: { kind: "none", spec_ref: null },
        decision: null,
        blocks_continue: false,
        source_event_ids: [],
        entity_ids: [],
      },
      { fromUserId: ctx.userId, state: "unread" },
    );
  });

  return { exportId, generatedAt, format: EXPORT_FORMAT, fileName, counts, totalRows, complete: truncated.length === 0, sizeBytes, archive, inboxItem };
}

/** Tables named in the Inbox note, in this order (the rest are summed as "other records"). */
const LABELS: Record<string, string> = {
  departments: "Departments",
  agents: "Agents (with versions, skills and conversations alongside)",
  spec_blocks: "Specification blocks",
  roadmap_items: "Roadmap items",
  tasks: "Tasks",
  entities: "CRM records",
  interactions: "CRM interactions",
  journeys: "Customer journeys",
  transactions: "Bank transactions",
  contracts: "Contracts",
  inbox_items: "Inbox items",
  usage_ledger: "Usage ledger entries",
  audit_log: "Audit entries",
};
const labelFor = (k: string) => LABELS[k] ?? k;

/** The Inbox note: what the file holds, where it went, and anything left out or cut. */
export function exportNote(input: { name: string; fileName: string; counts: Record<string, number>; totalRows: number; sizeBytes: number; truncated: { table: string; rows: number }[]; walled: readonly string[] }): string {
  const named = Object.keys(LABELS).filter((k) => k in input.counts);
  const lines = named.map((k) => `- ${labelFor(k)}: ${formatCount(input.counts[k] ?? 0)}`);
  const others = input.totalRows - named.reduce((n, k) => n + (input.counts[k] ?? 0), 0);
  const tables = Object.keys(input.counts).length;
  if (others > 0) lines.push(`- Other records: ${formatCount(others)}`);
  const parts = [
    `The portable archive of ${input.name} is ready: ${formatCount(input.totalRows)} records across ${tables} tables (${formatBytes(input.sizeBytes)}, format ${EXPORT_FORMAT}). It holds:`,
    lines.join("\n"),
    "",
    `It was handed to your browser as **${input.fileName}**. Nothing is kept on our side, so export again from Settings › Danger zone whenever you need a fresh copy. Credentials and connector tokens are never included.`,
  ];
  if (input.truncated.length) parts.push("", `Not complete: ${input.truncated.map((t) => `${t.table} stopped at ${formatCount(t.rows)} rows`).join("; ")}. Ask support for a full copy of ${input.truncated.length === 1 ? "that table" : "those tables"}.`);
  if (input.walled.length) parts.push("", `Left out because your role has no access: ${input.walled.join(", ")}.`);
  return parts.join("\n");
}

const formatCount = (n: number) => n.toLocaleString("en-US");
const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

export interface ArchiveResult {
  business: Business;
  stopped: StopAllResult;
}

/** Archive (admin): stop every agent, then hide the business. Data stays; nothing is deleted. */
export async function archiveBusiness(ctx: BusinessContext, reason = "archived"): Promise<ArchiveResult> {
  const stopped = await stopAllAgents(ctx, reason);
  const business = await ctx.rls(async (tx) => {
    await audit(tx, ctx, { action: "business.archive", target: { kind: "business", id: ctx.businessId }, details: { reason, pausedAgents: stopped.pausedAgents, pausedTasks: stopped.pausedTasks } });
    return repos.businesses.archive(tx, ctx.businessId);
  });
  return { business, stopped };
}

export interface RestoreResult {
  business: Business;
  /** False when the business was not archived (restore is idempotent). */
  restored: boolean;
}

/**
 * Restore (owner): the archived business is listed and reachable again with all its data. Its agents stay stopped
 * (archive pulled the kill switch) until the founder resumes them, so nothing spends on the founder's behalf by surprise.
 */
export async function restoreBusiness(ctx: BusinessContext): Promise<RestoreResult> {
  if (!ctx.business.archivedAt) return { business: ctx.business, restored: false };
  const archivedAt = ctx.business.archivedAt;
  const business = await ctx.rls(async (tx) => {
    const restored = await repos.businesses.restore(tx, ctx.businessId);
    await audit(tx, ctx, { action: "business.restore", target: { kind: "business", id: ctx.businessId }, details: { archivedAt: archivedAt.toISOString() } });
    return restored;
  });
  return { business, restored: true };
}

export interface DeletionState {
  status: "none" | "scheduled" | "cancelled";
  requestedAt: string | null;
  requestedBy: string | null;
  scheduledFor: string | null;
  delayDays: number;
}

/** The current deletion request, read from the audit chain (latest request/cancel wins). */
export async function deletionState(ctx: { db: Executor; businessId: string }): Promise<DeletionState> {
  const page = await repos.audit.list(ctx.db, ctx.businessId, { action: [DELETION_REQUEST_ACTION, DELETION_CANCEL_ACTION], limit: 1 });
  const latest = page.items[0];
  if (!latest) return { status: "none", requestedAt: null, requestedBy: null, scheduledFor: null, delayDays: DELETION_DELAY_DAYS };
  if (latest.action === DELETION_CANCEL_ACTION) return { status: "cancelled", requestedAt: null, requestedBy: null, scheduledFor: null, delayDays: DELETION_DELAY_DAYS };
  const details = latest.details as { scheduledFor?: string };
  return { status: "scheduled", requestedAt: latest.createdAt.toISOString(), requestedBy: latest.actorId ?? null, scheduledFor: details.scheduledFor ?? new Date(latest.createdAt.getTime() + DELETION_DELAY_DAYS * DAY_MS).toISOString(), delayDays: DELETION_DELAY_DAYS };
}

export class ReauthRequiredError extends AppError {
  constructor() {
    super("reauth_required", "Sign in again to confirm permanent deletion. Re-authentication is required for this action.", 412, { windowMinutes: REAUTH_WINDOW_MS / 60_000 });
  }
}

export interface RequestDeletionInput {
  /** The business name typed back by the founder (checked when given). */
  confirmName?: string;
  now?: Date;
}

export interface RequestDeletionResult {
  deletion: DeletionState;
  reauth: { required: true; satisfied: boolean; authenticatedAt: string | null; windowMinutes: number };
  copy: { title: string; body: string };
  inboxItem: InboxItem | null;
}

/** Deletion copy shown by the UI; the API is the source of truth for the delay. */
export function deletionCopy(business: Pick<Business, "name"> & { archivedAt?: Date | null }, scheduledFor: string): { title: string; body: string } {
  const when = new Date(scheduledFor).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const until = business.archivedAt
    ? "Until then any owner can cancel from New business › Archived businesses, or restore the business and cancel from Settings › Danger zone."
    : "Until then the business keeps working and any owner can cancel from Settings › Danger zone.";
  return {
    title: `Deletion scheduled for ${when}`,
    body: `${business.name} and everything in it (spec, roadmap, tasks, CRM, journeys, finance, audit log, agent instructions) will be permanently deleted on ${when}, ${DELETION_DELAY_DAYS} days from now. ${until} This cannot be undone after that date.`,
  };
}

/** Owner-only; needs a fresh authentication. Records the request with the 7-day date; the deletion job does the rest. */
export async function requestDeletion(ctx: BusinessContext, input: RequestDeletionInput = {}): Promise<RequestDeletionResult> {
  const now = input.now ?? new Date();
  const authenticatedAt = ctx.authenticatedAt ?? null;
  const satisfied = authenticatedAt !== null && now.getTime() - authenticatedAt.getTime() <= REAUTH_WINDOW_MS;
  if (!satisfied) throw new ReauthRequiredError();
  if (input.confirmName !== undefined && input.confirmName.trim() !== ctx.business.name.trim()) throw new ValidationError("Type the business name exactly to confirm permanent deletion");
  const existing = await deletionState(ctx);
  if (existing.status === "scheduled") {
    return { deletion: existing, reauth: { required: true, satisfied, authenticatedAt: authenticatedAt?.toISOString() ?? null, windowMinutes: REAUTH_WINDOW_MS / 60_000 }, copy: deletionCopy(ctx.business, existing.scheduledFor!), inboxItem: null };
  }
  const scheduledFor = new Date(now.getTime() + DELETION_DELAY_DAYS * DAY_MS).toISOString();
  const copy = deletionCopy(ctx.business, scheduledFor);
  const inboxItem = await ctx.rls(async (tx) => {
    await audit(tx, ctx, { action: DELETION_REQUEST_ACTION, target: { kind: "business", id: ctx.businessId }, details: { requestedAt: now.toISOString(), scheduledFor, delayDays: DELETION_DELAY_DAYS, reauthenticatedAt: authenticatedAt!.toISOString() } });
    const chief = await repos.agents.chiefOfStaff(tx, ctx.businessId);
    if (!chief) return null;
    return repos.inbox.createItem(
      tx,
      ctx.businessId,
      { type: "warning", from_agent_id: chief.id, subject: copy.title.slice(0, 80), body_md: copy.body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] },
      { fromUserId: ctx.userId },
    );
  });
  return { deletion: await deletionState(ctx), reauth: { required: true, satisfied, authenticatedAt: authenticatedAt!.toISOString(), windowMinutes: REAUTH_WINDOW_MS / 60_000 }, copy, inboxItem };
}

/** Owner-only. Cancels a scheduled deletion (idempotent). */
export async function cancelDeletion(ctx: BusinessContext): Promise<DeletionState> {
  const existing = await deletionState(ctx);
  if (existing.status !== "scheduled") return existing;
  await ctx.rls((tx) => audit(tx, ctx, { action: DELETION_CANCEL_ACTION, target: { kind: "business", id: ctx.businessId }, details: { cancelledAt: new Date().toISOString(), hadBeenScheduledFor: existing.scheduledFor } }));
  return deletionState(ctx);
}
