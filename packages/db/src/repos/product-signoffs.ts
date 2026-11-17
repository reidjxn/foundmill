/**
 * product_signoffs — the founder's sign-offs of the product (founder, 2026-10-18 "the first days are about the
 * product"; migration 0062). One row per round of a kind (`spec`, `roadmap`, `ready_to_sell`), tied to the Inbox
 * decision note that asks for it: `open` writes the note and the row together; `decide` settles a round exactly once
 * (the update is conditional on the status); `latest` is what the screens, the brief and `productStageOf` read.
 *
 * Who writes: the foundations apply (service role) opens the spec and roadmap rounds; the api decides them as the
 * user (RLS: owner, admin, member); the orchestrator (service role) offers `ready_to_sell` once; the demo seeds write
 * approved rounds.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { PLAN_READY_NOTE, SIGNOFF_KINDS, SIGNOFF_STATUSES, type SignoffKind } from "@foundmill/shared";
import { productSignoffs, type InboxItem, type ProductSignoff } from "../schema";
import { Id, JsonObject, maybeOne, parseInput, type Executor } from "./_shared";
import { inboxRepo, type ComposerItem } from "./inbox";

/** The latest round of each kind (null when the kind was never asked). */
export interface LatestSignoffs {
  spec: ProductSignoff | null;
  roadmap: ProductSignoff | null;
  readyToSell: ProductSignoff | null;
}

/** One option of a sign-off note as the Composer schema writes it. */
export interface SignoffOption {
  id: string;
  label: string;
  recommended: boolean;
  consequence: string;
  cost_minor: number;
  reversible: boolean;
}

/**
 * The option blocks of the sign-off notes, fixed here so every note of a kind decides the same way (`decideSignoffItem`
 * in apps/api keys on the option ids). Free text on the note is the founder's own words: a request for changes.
 */
export const SIGNOFF_OPTIONS: Record<SignoffKind, readonly SignoffOption[]> = {
  spec: [
    { id: "approve", label: "Approve the specification", recommended: true, consequence: "The team builds from this version; later changes arrive as proposals you accept.", cost_minor: 0, reversible: true },
    { id: "request_changes", label: "Request changes", recommended: false, consequence: "Tell me what to change; I revise the specification and ask for your sign-off again.", cost_minor: 0, reversible: true },
  ],
  roadmap: [
    { id: "approve", label: "Approve the roadmap", recommended: true, consequence: "Building starts: the Planner turns the Now items into tasks and the team starts on them in its next round of work.", cost_minor: 0, reversible: true },
    { id: "request_changes", label: "Request changes", recommended: false, consequence: "Tell me what to change; I revise the roadmap and ask for your sign-off again.", cost_minor: 0, reversible: true },
  ],
  ready_to_sell: [
    { id: "start", label: "Start distribution now", recommended: true, consequence: "The channel engines start and the Board asks which route to the first customer comes first.", cost_minor: 0, reversible: true },
    { id: "not_yet", label: "Not yet", recommended: false, consequence: "Nothing changes; start it any time from Customers › Board.", cost_minor: 0, reversible: true },
  ],
};

/** The decision block of a sign-off note of `kind` (options fixed, free text allowed, no deadline). */
export function signoffDecisionBlock(kind: SignoffKind): NonNullable<ComposerItem["decision"]> {
  return { options: SIGNOFF_OPTIONS[kind].map((o) => ({ ...o })), free_text: true, expires_at: null };
}

/**
 * The options of the one plan note (WP-04 T5): the same ids as a sign-off (`approve`, `request_changes`), so the Inbox,
 * the one-click answer and Today decide it as they decide any sign-off; the words are the plan's.
 */
export const PLAN_OPTIONS: readonly SignoffOption[] = [
  { id: "approve", label: PLAN_READY_NOTE.approveLabel, recommended: true, consequence: "Your team starts building the first item on the plan.", cost_minor: 0, reversible: true },
  { id: "request_changes", label: PLAN_READY_NOTE.changeLabel, recommended: false, consequence: "Tell me what to change; I revise the plan and ask you again.", cost_minor: 0, reversible: true },
];

/** The decision block of the plan note: both rounds (the specification and the roadmap) are answered from it. */
export function planDecisionBlock(): NonNullable<ComposerItem["decision"]> {
  return { options: PLAN_OPTIONS.map((o) => ({ ...o })), free_text: true, expires_at: null, key: PLAN_READY_NOTE.key };
}

const OpenInput = z.object({
  kind: z.enum(SIGNOFF_KINDS),
  snapshot: JsonObject.nullable().optional(),
  specVersionId: Id.nullable().optional(),
});

const DecideInput = z.object({
  status: z.enum(SIGNOFF_STATUSES).refine((s) => s !== "pending", "a decision settles the round"),
  notes: z.string().trim().max(2000).nullable().optional(),
  decidedBy: Id.nullable().optional(),
  decidedByKind: z.enum(["user", "system"]).default("user"),
  specVersionId: Id.nullable().optional(),
  snapshot: JsonObject.nullable().optional(),
  /** Statuses the round may be decided from (default: pending only; the screens also approve from changes_requested). */
  from: z.array(z.enum(SIGNOFF_STATUSES)).min(1).default(["pending"]),
});
export type DecideSignoffInput = z.input<typeof DecideInput>;

const SeedApprovedInput = z.object({
  spec: z.object({ at: z.coerce.date(), specVersionId: Id.nullable().optional() }),
  roadmap: z.object({ at: z.coerce.date() }),
  decidedBy: Id.nullable().optional(),
});

const scoped = (businessId: string, id: string) => and(eq(productSignoffs.businessId, businessId), eq(productSignoffs.id, id));

export const productSignoffsRepo = {
  /**
   * One decision per business at a time (transaction-scoped advisory lock): the specification approved in one tab and
   * the roadmap in another both read the other's committed decision, so exactly one of them sees "both approved" and
   * starts the build. Take it before `latest` in a deciding transaction.
   */
  async lock(db: Executor, businessId: string): Promise<void> {
    await db.execute(sql`select pg_advisory_xact_lock(hashtext('product_signoffs'), hashtext(${businessId}::text))`);
  },

  /** The latest round per kind, in one statement (`distinct on`). */
  async latest(db: Executor, businessId: string): Promise<LatestSignoffs> {
    const rows = await db
      .selectDistinctOn([productSignoffs.kind])
      .from(productSignoffs)
      .where(eq(productSignoffs.businessId, businessId))
      .orderBy(productSignoffs.kind, desc(productSignoffs.round));
    const of = (kind: SignoffKind) => rows.find((r) => r.kind === kind) ?? null;
    return { spec: of("spec"), roadmap: of("roadmap"), readyToSell: of("ready_to_sell") };
  },

  async get(db: Executor, businessId: string, id: string): Promise<ProductSignoff | null> {
    return maybeOne(await db.select().from(productSignoffs).where(scoped(businessId, id)).limit(1));
  },

  /**
   * The round an Inbox decision note asks about, or null for any other note. The plan note (WP-04 T5) carries two rounds:
   * one still open comes first, then the newest, then the specification's.
   */
  async forInboxItem(db: Executor, businessId: string, inboxItemId: string): Promise<ProductSignoff | null> {
    return maybeOne(
      await db
        .select()
        .from(productSignoffs)
        .where(and(eq(productSignoffs.businessId, businessId), eq(productSignoffs.inboxItemId, inboxItemId)))
        .orderBy(sql`case when ${productSignoffs.status} in ('pending', 'changes_requested') then 0 else 1 end`, desc(productSignoffs.round), desc(productSignoffs.kind))
        .limit(1),
    );
  },

  /** Every round tied to an Inbox note (the plan note has two), newest first. */
  async listForInboxItem(db: Executor, businessId: string, inboxItemId: string): Promise<ProductSignoff[]> {
    return db
      .select()
      .from(productSignoffs)
      .where(and(eq(productSignoffs.businessId, businessId), eq(productSignoffs.inboxItemId, inboxItemId)))
      .orderBy(desc(productSignoffs.round), desc(productSignoffs.kind));
  },

  /** Point a round at another Inbox note (the plan note asked again carries the roadmap round still pending, WP-04 T5). */
  async attach(db: Executor, businessId: string, signoffId: string, inboxItemId: string): Promise<ProductSignoff | null> {
    const rows = await db.update(productSignoffs).set({ inboxItemId }).where(scoped(businessId, signoffId)).returning();
    return rows[0] ?? null;
  },

  /**
   * Open the next round of `kind`: the Inbox decision note (`item`, whose decision block the caller takes from
   * `signoffDecisionBlock` or `planDecisionBlock`) and the row, together; with `inboxItemId` instead, the round is
   * attached to that existing note (the plan note's second round, WP-04 T5) and no note is written. While a pending round
   * of that kind exists nothing is written and that round comes back (`created: false`), so a retried apply or a second
   * publish never asks twice.
   */
  async open(db: Executor, businessId: string, input: { kind: SignoffKind; snapshot?: Record<string, unknown> | null; specVersionId?: string | null } & ({ item: ComposerItem; inboxItemId?: undefined } | { inboxItemId: string; item?: undefined })): Promise<{ signoff: ProductSignoff; item: InboxItem | null; created: boolean }> {
    const v = parseInput(OpenInput, input, "product sign-off");
    const latest = maybeOne(await db.select().from(productSignoffs).where(and(eq(productSignoffs.businessId, businessId), eq(productSignoffs.kind, v.kind))).orderBy(desc(productSignoffs.round)).limit(1));
    if (latest && latest.status === "pending") {
      const item = latest.inboxItemId ? await inboxRepo.get(db, businessId, latest.inboxItemId).catch(() => null) : null;
      return { signoff: latest, item, created: false };
    }
    const item = input.inboxItemId ? await inboxRepo.get(db, businessId, input.inboxItemId) : await inboxRepo.createItem(db, businessId, input.item!);
    const [signoff] = await db
      .insert(productSignoffs)
      .values({ businessId, kind: v.kind, round: (latest?.round ?? 0) + 1, status: "pending", inboxItemId: item.id, snapshot: v.snapshot ?? null, specVersionId: v.specVersionId ?? null })
      .returning();
    return { signoff: signoff!, item, created: true };
  },

  /**
   * Settle a round exactly once: the update is conditional on the row still being in one of `from` (pending by default;
   * the Product screens also approve a round the founder sent back). Null when the round was already decided.
   */
  async decide(db: Executor, businessId: string, id: string, input: DecideSignoffInput): Promise<ProductSignoff | null> {
    const v = parseInput(DecideInput, input, "product sign-off decision");
    const rows = await db
      .update(productSignoffs)
      .set({
        status: v.status,
        notes: v.notes ?? null,
        decidedBy: v.decidedBy ?? null,
        decidedByKind: v.decidedByKind,
        decidedAt: new Date(),
        ...(v.specVersionId !== undefined ? { specVersionId: v.specVersionId } : {}),
        ...(v.snapshot !== undefined ? { snapshot: v.snapshot } : {}),
      })
      .where(and(scoped(businessId, id), inArray(productSignoffs.status, v.from)))
      .returning();
    return rows[0] ?? null;
  },

  /** The demo seeds: both rounds approved at the given times (one statement each; a business seeded twice keeps the first). */
  async seedApproved(db: Executor, businessId: string, input: z.input<typeof SeedApprovedInput>): Promise<void> {
    const v = parseInput(SeedApprovedInput, input, "seeded sign-offs");
    await db
      .insert(productSignoffs)
      .values([
        { businessId, kind: "spec", round: 1, status: "approved", specVersionId: v.spec.specVersionId ?? null, decidedBy: v.decidedBy ?? null, decidedByKind: "user", decidedAt: v.spec.at, requestedAt: v.spec.at },
        { businessId, kind: "roadmap", round: 1, status: "approved", decidedBy: v.decidedBy ?? null, decidedByKind: "user", decidedAt: v.roadmap.at, requestedAt: v.roadmap.at },
      ])
      .onConflictDoNothing();
  },

  /**
   * Offer "Ready to start selling?" once per business: the pending `ready_to_sell` round and its note (from the Chief
   * of Staff, non-blocking) when none of that kind exists yet and distribution has not started. Null otherwise.
   */
  async offerReadyToSell(db: Executor, businessId: string, input: { roadmapItemId: string; title: string; chiefId: string; item: ComposerItem }): Promise<{ signoff: ProductSignoff; item: InboxItem } | null> {
    const existing = await db.select({ id: productSignoffs.id }).from(productSignoffs).where(and(eq(productSignoffs.businessId, businessId), eq(productSignoffs.kind, "ready_to_sell"))).limit(1);
    if (existing.length) return null;
    const started = await db.execute(sql`select distribution_started_at from businesses where id = ${businessId}`);
    const row = (Array.isArray(started) ? started : ((started as { rows?: unknown[] }).rows ?? []))[0] as { distribution_started_at?: unknown } | undefined;
    if (row?.distribution_started_at) return null;
    const opened = await productSignoffsRepo.open(db, businessId, { kind: "ready_to_sell", item: input.item, snapshot: { roadmapItemId: input.roadmapItemId, title: input.title } });
    return opened.item ? { signoff: opened.signoff, item: opened.item } : null;
  },
};
