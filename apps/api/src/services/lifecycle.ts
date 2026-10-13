/**
 * Settings › Danger zone (BUILD §11.15): export everything, archive the business, permanent deletion
 * (founder-only, re-authentication, 7-day delay).
 *
 * - `exportBusiness` builds a portable JSON archive through repositories only (spec, roadmap, tasks, CRM, journeys,
 *   finance, legal, inbox, audit log, agent instructions). Credentials are never read; integrations appear as
 *   status rows only. The founder gets an Inbox note with the counts.
 * - `archiveBusiness` pulls the kill switch, then archives the row (hidden from lists, restorable by the db owner).
 * - `requestDeletion` / `cancelDeletion` record the request on the audit chain (append-only, hash-chained) with the
 *   scheduled date 7 days out; nothing is deleted by the API process (a deletion job outside this wave consumes the
 *   request). The request needs a fresh authentication (`authenticatedAt` from the token's `amr`).
 */
import { APP_NAME } from "@foundmill/config";
import { repos, type Business, type Executor, type InboxItem } from "@foundmill/db";
import { AppError, ValidationError } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit } from "../trpc";
import { stopAllAgents, type StopAllResult } from "./killswitch";

export const EXPORT_FORMAT = "foundmill-export/1" as const;
export const DELETION_DELAY_DAYS = 7;
/** How recent the authentication must be for permanent actions (BUILD §11.15 "re-auth"). */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;
export const DELETION_REQUEST_ACTION = "business.request_deletion";
export const DELETION_CANCEL_ACTION = "business.cancel_deletion";

const DAY_MS = 86_400_000;

/** "Oct 18, 2026" (US English, UTC so a note reads the same wherever it is written). */
const usDate = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export interface ExportArchive {
  format: typeof EXPORT_FORMAT;
  app: string;
  generatedAt: string;
  business: Omit<Business, "createdBy">;
  departments: unknown[];
  agents: { agent: unknown; versions: unknown[]; skills: unknown[] }[];
  spec: { blocks: unknown[]; versions: unknown[] };
  roadmap: { items: unknown[]; dependencies: unknown[] };
  tasks: unknown[];
  channels: unknown[];
  campaigns: unknown[];
  crm: { entities: unknown[] };
  journeys: { journeys: unknown[]; conversions: unknown[]; milestones: unknown[] };
  finance: { accounts: unknown[]; transactions: unknown[]; forecasts: unknown[]; capTable: unknown };
  legal: { entities: unknown[]; contracts: unknown[]; compliance: unknown[] };
  inbox: { items: unknown[] };
  integrations: unknown[];
  audit: unknown[];
  /** What was left out on purpose. */
  excluded: readonly string[];
}

export interface ExportResult {
  exportId: string;
  generatedAt: string;
  format: typeof EXPORT_FORMAT;
  counts: Record<string, number>;
  sizeBytes: number;
  archive: ExportArchive;
  inboxItem: InboxItem | null;
}

const EXCLUDED = ["credentials (ciphertext and plaintext)", "connector tokens", "other members' personal data beyond their role", "LIVE network messages"] as const;

async function allPages<T>(fetch: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>, max = 5000): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && out.length < max);
  return out;
}

/** Export everything (admin). One RLS transaction; repositories only. */
export async function exportBusiness(ctx: BusinessContext): Promise<ExportResult> {
  const generatedAt = new Date().toISOString();
  const archive = await ctx.rls(async (tx): Promise<ExportArchive> => {
    const b = ctx.businessId;
    const [departments, agents, blocks, versions, roadmap, dependencies, tasks, channels, campaigns, entities, journeys, conversions, milestones, accounts, transactions, forecasts, capTable, legalEntities, contracts, compliance, inbox, integrations, auditRows] = await Promise.all([
      repos.departments.list(tx, b, { includeHidden: true }),
      repos.agents.list(tx, b, { limit: 500 }),
      repos.product.listBlocks(tx, b),
      repos.product.listVersions(tx, b),
      repos.product.listRoadmap(tx, b),
      repos.product.listDependencies(tx, b),
      allPages((cursor) => repos.tasks.list(tx, b, { limit: 500, cursor })),
      repos.channels.list(tx, b),
      allPages((cursor) => repos.campaigns.list(tx, b, { limit: 200, cursor })),
      allPages((cursor) => repos.entities.list(tx, b, { limit: 500, cursor })),
      allPages((cursor) => repos.journeys.list(tx, b, { limit: 200, cursor })),
      allPages((cursor) => repos.journeys.listConversions(tx, b, { limit: 500, cursor })),
      repos.journeys.listMilestones(tx, b),
      repos.finance.listAccounts(tx, b),
      allPages((cursor) => repos.finance.listTransactions(tx, b, { limit: 500, cursor })),
      repos.finance.listForecasts(tx, b),
      repos.capTable.summary(tx, b),
      repos.legal.listEntities(tx, b),
      allPages((cursor) => repos.legal.listContracts(tx, b, { limit: 200, cursor })),
      repos.legal.listCompliance(tx, b),
      allPages((cursor) => repos.inbox.list(tx, b, { limit: 200, cursor })),
      repos.integrations.list(tx, b),
      allPages((cursor) => repos.audit.list(tx, b, { limit: 200, cursor })),
    ]);
    const agentBundles = await Promise.all(
      agents.items.map(async (agent) => ({
        agent,
        versions: await repos.agents.listVersions(tx, b, agent.id),
        skills: await repos.skills.listForAgent(tx, b, agent.id),
      })),
    );
    const { createdBy: _createdBy, ...business } = ctx.business;
    return {
      format: EXPORT_FORMAT,
      app: APP_NAME,
      generatedAt,
      business,
      departments,
      agents: agentBundles,
      spec: { blocks, versions },
      roadmap: { items: roadmap, dependencies },
      tasks,
      channels,
      campaigns,
      crm: { entities },
      journeys: { journeys, conversions, milestones },
      finance: { accounts: accounts.map((a) => ({ ...a, externalId: undefined })), transactions, forecasts, capTable },
      legal: { entities: legalEntities, contracts, compliance },
      inbox: { items: inbox },
      integrations: integrations.map((i) => ({ id: i.id, connectorKey: i.connectorKey, status: i.status, scopes: i.scopes, lastHealthAt: i.lastHealthAt })),
      audit: auditRows,
      excluded: EXCLUDED,
    };
  });

  const counts: Record<string, number> = {
    departments: archive.departments.length,
    agents: archive.agents.length,
    specBlocks: archive.spec.blocks.length,
    roadmapItems: archive.roadmap.items.length,
    tasks: archive.tasks.length,
    entities: archive.crm.entities.length,
    journeys: archive.journeys.journeys.length,
    transactions: archive.finance.transactions.length,
    contracts: archive.legal.contracts.length,
    inboxItems: archive.inbox.items.length,
    auditEntries: archive.audit.length,
  };
  const sizeBytes = Buffer.byteLength(JSON.stringify(archive), "utf8");
  const exportId = crypto.randomUUID();

  const inboxItem = await ctx.rls(async (tx) => {
    const chief = await repos.agents.chiefOfStaff(tx, ctx.businessId);
    await audit(tx, ctx, { action: "business.export", target: { kind: "business", id: ctx.businessId }, details: { exportId, counts, sizeBytes, format: EXPORT_FORMAT } });
    if (!chief) return null;
    const lines = Object.entries(counts).map(([k, v]) => `- ${labelFor(k)}: ${v}`);
    return repos.inbox.createItem(
      tx,
      ctx.businessId,
      {
        type: "update",
        from_agent_id: chief.id,
        subject: "Your export is ready",
        body_md: `The portable archive of ${ctx.business.name} was generated (${formatBytes(sizeBytes)}, format ${EXPORT_FORMAT}). It holds:\n${lines.join("\n")}\n\nCredentials and connector tokens are never included. Download it from Settings › Danger zone.`,
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

  return { exportId, generatedAt, format: EXPORT_FORMAT, counts, sizeBytes, archive, inboxItem };
}

const LABELS: Record<string, string> = {
  departments: "Departments",
  agents: "Agents (with instructions and skills)",
  specBlocks: "Specification blocks",
  roadmapItems: "Roadmap items",
  tasks: "Tasks",
  entities: "CRM entities",
  journeys: "Customer journeys",
  transactions: "Bank transactions",
  contracts: "Contracts",
  inboxItems: "Inbox items",
  auditEntries: "Audit entries",
};
const labelFor = (k: string) => LABELS[k] ?? k;
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
export function deletionCopy(business: Pick<Business, "name">, scheduledFor: string): { title: string; body: string } {
  const when = usDate(scheduledFor);
  return {
    title: `Deletion scheduled for ${when}`,
    body: `${business.name} and everything in it (spec, roadmap, tasks, CRM, journeys, finance, audit log, agent instructions) will be permanently deleted on ${when}, ${DELETION_DELAY_DAYS} days from now. Until then the business keeps working and any owner can cancel from Settings › Danger zone. This cannot be undone after that date.`,
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
    const chief = await repos.agents.chiefOfStaff(tx, ctx.businessId);
    // The warning is made first so the request on the audit chain can name it: cancelling settles exactly this item.
    const item = chief
      ? await repos.inbox.createItem(
          tx,
          ctx.businessId,
          { type: "warning", from_agent_id: chief.id, subject: copy.title.slice(0, 80), body_md: copy.body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] },
          { fromUserId: ctx.userId },
        )
      : null;
    await audit(tx, ctx, { action: DELETION_REQUEST_ACTION, target: { kind: "business", id: ctx.businessId }, details: { requestedAt: now.toISOString(), scheduledFor, delayDays: DELETION_DELAY_DAYS, reauthenticatedAt: authenticatedAt!.toISOString(), inboxItemId: item?.id ?? null } });
    return item;
  });
  return { deletion: await deletionState(ctx), reauth: { required: true, satisfied, authenticatedAt: authenticatedAt!.toISOString(), windowMinutes: REAUTH_WINDOW_MS / 60_000 }, copy, inboxItem };
}

/**
 * Owner-only. Cancels a scheduled deletion (idempotent). The Inbox warning the request left is settled (archived) and
 * the Chief of Staff leaves a note that the deletion was canceled, so the Inbox never keeps announcing a deletion that
 * is no longer going to happen (audit MLSL-X: "Deletion scheduled for …" stayed after canceling).
 */
export async function cancelDeletion(ctx: BusinessContext): Promise<DeletionState> {
  const existing = await deletionState(ctx);
  if (existing.status !== "scheduled") return existing;
  const request = (await repos.audit.list(ctx.db, ctx.businessId, { action: DELETION_REQUEST_ACTION, limit: 1 })).items[0];
  const warningId = (request?.details as { inboxItemId?: string | null } | undefined)?.inboxItemId ?? null;
  await ctx.rls(async (tx) => {
    await audit(tx, ctx, { action: DELETION_CANCEL_ACTION, target: { kind: "business", id: ctx.businessId }, details: { cancelledAt: new Date().toISOString(), hadBeenScheduledFor: existing.scheduledFor } });
    if (warningId) await repos.inbox.archive(tx, ctx.businessId, warningId).catch(() => undefined);
    const chief = await repos.agents.chiefOfStaff(tx, ctx.businessId);
    if (!chief) return;
    await repos.inbox.createItem(
      tx,
      ctx.businessId,
      {
        type: "update",
        from_agent_id: chief.id,
        subject: "Deletion canceled",
        body_md: `The permanent deletion of ${ctx.business.name}${existing.scheduledFor ? ` that was scheduled for ${usDate(existing.scheduledFor)}` : ""} was canceled. Nothing was deleted and the business keeps working. You can schedule it again from Settings › Danger zone.`,
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
  return deletionState(ctx);
}
