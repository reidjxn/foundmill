/** businesses — the business record (BUILD §7.2 "Accounts and businesses", routers business.*). */
import { AGENT_STOP_REASONS, ARCHETYPES, BUSINESS_MODES, ConflictError, DATA_REGIONS, DEFAULT_BUSINESS_CURRENCY, GAME_MODES, MODEL_BILLING, OWNER_ROLES, PLAN_TIERS, ValidationError, slugify, uuid, type AgentStopReason, type BusinessMode, type GameMode, type MembershipRole, type PlanTier } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLog, businessLogos, businesses, memberships, type Business } from "../schema";
import { Currency, changes, Id, IsoDateInput, maybeOne, MinorAmount, one, parseInput, rowsOf, uniqueViolation, type Executor } from "./_shared";
import { membershipNotEnded } from "./memberships";

const HexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "brand colors are #RRGGBB");
/** ISO 4217: three letters (0025 holds the column to the same shape). */
const BusinessCurrency = Currency.regex(/^[A-Z]{3}$/, "a currency is a 3-letter ISO 4217 code");

/** An IANA time zone name ("Europe/London", "America/Los_Angeles", "UTC"); 0041's check on businesses.time_zone. */
export const TimeZoneName = z.string().regex(/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/, "a time zone such as Europe/London");

export const CreateBusinessInput = z.object({
  /** Supply the id when the caller must know it before RETURNING is possible (RLS bootstrap, seeds). */
  id: Id.optional(),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  gameMode: z.enum(GAME_MODES).default("personal"),
  businessMode: z.enum(BUSINESS_MODES).default("assisted"),
  archetype: z.enum(ARCHETYPES).nullable().optional(),
  kitPrimary: HexColour.optional(),
  kitSecondary: HexColour.optional(),
  region: z.enum(DATA_REGIONS).default("eu"),
  planTier: z.enum(PLAN_TIERS).default("free"),
  modelBilling: z.enum(MODEL_BILLING).default("credits"),
  /** "Spend cap per action" (Commit, Settings › What the team can do) in minor units of the business currency; null: no business cap. */
  spendCapMinor: MinorAmount.nonnegative().nullable().default(null),
  glossary: z.record(z.string(), z.string()).default({}),
  /** The business's own currency (0025); commit passes the founder's choice. Mirrors the column default. */
  currency: BusinessCurrency.default(DEFAULT_BUSINESS_CURRENCY),
  createdBy: Id.nullable().optional(),
  /** A seeded demo business (0044): kept off the network for everyone outside it. The demo seed sets it; nothing else does. */
  isDemo: z.boolean().default(false),
});
export type CreateBusinessInput = z.input<typeof CreateBusinessInput>;

export const UpdateBusinessInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  archetype: z.enum(ARCHETYPES).nullable().optional(),
  kitPrimary: HexColour.optional(),
  kitSecondary: HexColour.optional(),
  region: z.enum(DATA_REGIONS).optional(),
  planTier: z.enum(PLAN_TIERS).optional(),
  modelBilling: z.enum(MODEL_BILLING).optional(),
  glossary: z.record(z.string(), z.string()).optional(),
  currency: BusinessCurrency.optional(),
});
export type UpdateBusinessInput = z.input<typeof UpdateBusinessInput>;

const notArchived = isNull(businesses.archivedAt);

/**
 * One business as the founder's own lists show it (the top bar's Switch business, the palette, Your businesses): what
 * a row needs and nothing more, with the person's role and the version of the logo (`business.logo.get` by sha256).
 */
export interface BusinessSummary {
  id: string;
  name: string;
  slug: string;
  role: MembershipRole;
  planTier: PlanTier;
  gameMode: GameMode;
  businessMode: BusinessMode;
  isDemo: boolean;
  /** The person holds an example membership (0065): a read-only walk around a demo business, listed under "Example". */
  isExample: boolean;
  kitPrimary: string;
  kitSecondary: string;
  createdAt: Date;
  committedAt: Date | null;
  /** The team is stopped (Stop all agents, a revoked key, used-up credits). */
  agentsStopped: boolean;
  /** Null without a stored logo (the initials mark is drawn). */
  logo: { sha256: string } | null;
}

/**
 * Settings › Danger zone writes a scheduled deletion and its cancellation as audit entries (DECISIONS "Deletion requests
 * live on the audit chain"); the latest of the two is the business's deletion state.
 */
export const BUSINESS_DELETION_REQUEST_ACTION = "business.request_deletion";
export const BUSINESS_DELETION_CANCEL_ACTION = "business.cancel_deletion";
/** Days between the request and the purge, when the request does not carry its own `scheduledFor`. */
export const BUSINESS_DELETION_DELAY_DAYS = 7;
/** What Settings › Business shows under the Slug field when another business already has the slug. */
export const SLUG_TAKEN = "That slug is taken";

export const businessesRepo = {
  /** The business, or NotFoundError. Archived businesses are not found unless `includeArchived`. */
  async get(db: Executor, businessId: string, options: { includeArchived?: boolean } = {}): Promise<Business> {
    const rows = await db
      .select()
      .from(businesses)
      .where(options.includeArchived ? eq(businesses.id, businessId) : and(eq(businesses.id, businessId), notArchived))
      .limit(1);
    return one(rows, "business", businessId);
  },

  async getBySlug(db: Executor, slug: string): Promise<Business | null> {
    return maybeOne(await db.select().from(businesses).where(and(eq(businesses.slug, slug), notArchived)).limit(1));
  },

  /**
   * Account-scoped: every business the user is a member of, newest first. `isExample` marks an example membership
   * (0065): a demo the person is walking around, never "their" business (pickers prefer a real one). A membership that
   * has ended (0092: a collaborator's date passed) offers nothing, so its business is not listed.
   */
  async listForUser(db: Executor, userId: string): Promise<(Business & { role: string; isExample: boolean })[]> {
    const rows = await db
      .select({ business: businesses, role: memberships.role, source: memberships.source })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .where(and(eq(memberships.userId, userId), notArchived, membershipNotEnded))
      .orderBy(desc(businesses.createdAt));
    return rows.map((r) => ({ ...r.business, role: r.role, isExample: r.source === "example" }));
  },

  /**
   * Account-scoped: the businesses the user belongs to (not archived), with their role and logo version, A–Z by name.
   * One statement, no logo bytes. Run it as the user (`withRls`): RLS only ever shows a caller businesses they are a
   * member of, whatever `userId` is asked for.
   */
  async listSummariesForUser(db: Executor, userId: string): Promise<BusinessSummary[]> {
    const id = parseInput(Id, userId, "user id");
    const rows = await db
      .select({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
        planTier: businesses.planTier,
        gameMode: businesses.gameMode,
        businessMode: businesses.businessMode,
        isDemo: businesses.isDemo,
        kitPrimary: businesses.kitPrimary,
        kitSecondary: businesses.kitSecondary,
        createdAt: businesses.createdAt,
        committedAt: businesses.committedAt,
        agentsStoppedAt: businesses.agentsStoppedAt,
        role: memberships.role,
        source: memberships.source,
        logoSha256: businessLogos.sha256,
      })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .leftJoin(businessLogos, eq(businessLogos.businessId, businesses.id))
      .where(and(eq(memberships.userId, id), notArchived))
      .orderBy(sql`lower(${businesses.name})`, asc(businesses.id));
    return rows.map(({ agentsStoppedAt, logoSha256, source, ...r }) => ({ ...r, isExample: source === "example", agentsStopped: agentsStoppedAt !== null, logo: logoSha256 ? { sha256: logoSha256 } : null }));
  },

  /**
   * The example business (0065; docs/UX_AUDIT_AND_PLAN.md §12 item 5): a committed, open demo business (`is_demo`,
   * 0044), `prefer` first when it is one (the seed's Northwind Skincare, `EXAMPLE_BUSINESS_ID`), else the oldest. Null
   * when the deployment has no demo business (production without seeds), so New business shows no example door.
   */
  async example(db: Executor, options: { prefer?: string } = {}): Promise<Business | null> {
    const prefer = options.prefer ? parseInput(Id, options.prefer, "business id") : null;
    const oldest = [asc(businesses.createdAt), asc(businesses.id)];
    const rows = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.isDemo, true), notArchived, isNotNull(businesses.committedAt)))
      .orderBy(...(prefer ? [sql`(${businesses.id} = ${prefer}::uuid) desc`, ...oldest] : oldest))
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Account-scoped: the archived businesses the user owns (as an owner or a cofounder), most recently archived first (Settings › Danger zone
   * promises an owner can restore one; New business lists them with Restore, Export and Delete permanently).
   */
  async listArchivedForUser(db: Executor, userId: string): Promise<Business[]> {
    const rows = await db
      .select({ business: businesses })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .where(and(eq(memberships.userId, userId), inArray(memberships.role, [...OWNER_ROLES]), isNotNull(businesses.archivedAt)))
      .orderBy(desc(businesses.archivedAt));
    return rows.map((r) => r.business);
  },

  /**
   * Account-scoped: creates the business row. The id is generated here (not by RETURNING) because
   * `insert … returning` as `authenticated` needs a membership that does not exist yet (DECISIONS
   * "Business creation generates the id client-side"); callers insert the owner membership next.
   */
  async create(db: Executor, input: CreateBusinessInput): Promise<Business> {
    const v = parseInput(CreateBusinessInput, input, "business");
    const id = v.id ?? uuid();
    const slug = v.slug ?? slugify(v.name);
    await db.insert(businesses).values({
      id,
      name: v.name,
      slug,
      gameMode: v.gameMode,
      businessMode: v.businessMode,
      archetype: v.archetype ?? null,
      ...(v.kitPrimary ? { kitPrimary: v.kitPrimary } : {}),
      ...(v.kitSecondary ? { kitSecondary: v.kitSecondary } : {}),
      region: v.region,
      planTier: v.planTier,
      modelBilling: v.modelBilling,
      spendCapMinor: v.spendCapMinor,
      glossary: v.glossary,
      currency: v.currency,
      createdBy: v.createdBy ?? null,
      isDemo: v.isDemo,
    });
    return {
      id,
      name: v.name,
      slug,
      gameMode: v.gameMode,
      businessMode: v.businessMode,
      archetype: v.archetype ?? null,
      kitPrimary: v.kitPrimary ?? "#1b4fd8",
      kitSecondary: v.kitSecondary ?? "#f5c400",
      // Retired (0017): always null; the logo lives in business_logos.
      crestUrl: null,
      region: v.region,
      committedAt: null,
      planTier: v.planTier,
      modelBilling: v.modelBilling,
      spendCapMinor: v.spendCapMinor,
      modelBudgetMinor: null,
      glossary: v.glossary,
      currency: v.currency,
      createdBy: v.createdBy ?? null,
      agentsStoppedAt: null,
      agentsStoppedReason: null,
      timeZone: null,
      isDemo: v.isDemo,
      autopilotEnabled: false,
      autopilotCadence: "every_4h",
      autopilotDailyHour: 9,
      autopilotMaxCyclesPerDay: 6,
      autopilotSpendCeilingMinor: null,
      autopilotMaxIdleCycles: 3,
      autopilotPausedReason: null,
      autopilotChangedAt: null,
      autopilotNextAt: null,
      autopilotOwnMaxCyclesPerDay: null,
      autopilotOwnSpendCeilingMinor: null,
      distributionStartedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };
  },

  /**
   * Committed, live businesses in Automated mode (service role, across tenants): the orchestrator keeps an autopilot
   * workflow running for each (BUILD §11.3 "In Automated mode Continue auto-runs"). A stopped team is listed too; its
   * autopilot waits for the resume.
   */
  async listAutomated(db: Executor, options: { limit?: number } = {}): Promise<Pick<Business, "id">[]> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 1000), 1), 10_000);
    return db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.businessMode, "automated"), isNull(businesses.archivedAt), sql`${businesses.committedAt} is not null`))
      .orderBy(businesses.createdAt)
      .limit(limit);
  },

  /**
   * Whether work may start for the business (0023): false while the team is stopped (Stop all agents, a revoked key,
   * used-up credits) or the business is archived. Every path that starts a session, a cycle, an engine or a training
   * run asks this first; `resumeBusinessAgents` is the only way back.
   */
  async agentsStopped(db: Executor, businessId: string): Promise<boolean> {
    const state = await businessesRepo.stopState(db, businessId);
    return state.stopped;
  },

  /** The team-wide stop with its reason (`stopped` also when the business is archived). */
  async stopState(db: Executor, businessId: string): Promise<{ stopped: boolean; stoppedAt: Date | null; reason: Business["agentsStoppedReason"]; archived: boolean }> {
    const rows = await db
      .select({ stoppedAt: businesses.agentsStoppedAt, reason: businesses.agentsStoppedReason, archivedAt: businesses.archivedAt })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    const row = one(rows, "business", businessId);
    return { stopped: row.stoppedAt !== null || row.archivedAt !== null, stoppedAt: row.stoppedAt, reason: row.reason, archived: row.archivedAt !== null };
  },

  /**
   * Updates the business record. Slugs are unique across every business (`businesses_slug_key`), so a slug another
   * business holds is a ConflictError on the `slug` field ("That slug is taken"), never a database error.
   */
  async update(db: Executor, businessId: string, input: UpdateBusinessInput): Promise<Business> {
    const v = parseInput(UpdateBusinessInput, input, "business update");
    try {
      const rows = await db.update(businesses).set(changes(v, "business")).where(and(eq(businesses.id, businessId), notArchived)).returning();
      return one(rows, "business", businessId);
    } catch (err) {
      if (v.slug !== undefined && uniqueViolation(err)?.constraint === "businesses_slug_key") throw new ConflictError(SLUG_TAKEN, { field: "slug" });
      throw err;
    }
  },

  async setGameMode(db: Executor, businessId: string, gameMode: (typeof GAME_MODES)[number]): Promise<Business> {
    const mode = parseInput(z.enum(GAME_MODES), gameMode, "game mode");
    return one(await db.update(businesses).set({ gameMode: mode }).where(and(eq(businesses.id, businessId), notArchived)).returning(), "business", businessId);
  },

  async setBusinessMode(db: Executor, businessId: string, businessMode: (typeof BUSINESS_MODES)[number]): Promise<Business> {
    const mode = parseInput(z.enum(BUSINESS_MODES), businessMode, "business mode");
    return one(await db.update(businesses).set({ businessMode: mode }).where(and(eq(businesses.id, businessId), notArchived)).returning(), "business", businessId);
  },

  /**
   * Account-scoped: holds a per-owner lock until the transaction ends, so two commits by one owner are counted against
   * the plan's business limit one after the other (`assertBusinessAllowance`, packages/db/src/tiers.ts).
   */
  async lockOwnerBusinesses(db: Executor, userId: string): Promise<void> {
    const id = parseInput(Id, userId, "user id");
    await db.execute(sql`select pg_advisory_xact_lock(hashtext('business_allowance'), hashtext(${id}::text))`);
  },

  /**
   * The business time zone (0041): Home's "today", week and month and the Journey's days follow it. Only an IANA name
   * Postgres knows is stored (anything else would read as UTC when the Journey is rebuilt), so a typo fails here.
   */
  async setTimeZone(db: Executor, businessId: string, timeZone: string): Promise<Business> {
    const zone = parseInput(TimeZoneName, timeZone, "time zone");
    const known = rowsOf<{ known: boolean }>(await db.execute(sql`select exists (select 1 from pg_timezone_names where name = ${zone}) as known`))[0]?.known;
    if (!known) throw new ValidationError(`Unknown time zone "${zone}"`);
    return one(await db.update(businesses).set({ timeZone: zone }).where(and(eq(businesses.id, businessId), notArchived)).returning(), "business", businessId);
  },

  /** The founder's "Spend cap per action" (Settings › What the team can do); null removes the business cap. */
  async setSpendCap(db: Executor, businessId: string, spendCapMinor: number | null): Promise<Business> {
    const cap = parseInput(MinorAmount.nonnegative().nullable(), spendCapMinor, "spend cap");
    return one(await db.update(businesses).set({ spendCapMinor: cap }).where(and(eq(businesses.id, businessId), notArchived)).returning(), "business", businessId);
  },

  /** The monthly model budget in US cents (Settings; 0059): what the team's metered work may cost in a month. Null removes it. */
  async setModelBudget(db: Executor, businessId: string, modelBudgetMinor: number | null): Promise<Business> {
    const budget = parseInput(MinorAmount.nonnegative().nullable(), modelBudgetMinor, "model budget");
    return one(await db.update(businesses).set({ modelBudgetMinor: budget }).where(and(eq(businesses.id, businessId), notArchived)).returning(), "business", businessId);
  },

  /**
   * The founder started distribution (0062; Distribution › Board › Start distribution, or the Ready to start selling?
   * note): sets `distribution_started_at` once. Idempotent: a second start changes nothing (`changed: false`).
   */
  async startDistribution(db: Executor, businessId: string, input: { at?: Date } = {}): Promise<{ changed: boolean; business: Business }> {
    const v = parseInput(z.object({ at: z.date().optional() }), input, "distribution start");
    const rows = await db
      .update(businesses)
      .set({ distributionStartedAt: v.at ?? new Date() })
      .where(and(eq(businesses.id, businessId), notArchived, isNull(businesses.distributionStartedAt)))
      .returning();
    if (rows[0]) return { changed: true, business: rows[0] };
    return { changed: false, business: await businessesRepo.get(db, businessId) };
  },

  /** Whether distribution has started (0062): no channel engine starts before it. */
  async distributionStarted(db: Executor, businessId: string): Promise<boolean> {
    const rows = await db.select({ at: businesses.distributionStartedAt }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    return one(rows, "business", businessId).at !== null;
  },

  /** Marks the idea committed (BUILD §11.1): sets archetype and committed_at. */
  async commit(db: Executor, businessId: string, input: { archetype: (typeof ARCHETYPES)[number]; committedAt?: Date }): Promise<Business> {
    const v = parseInput(z.object({ archetype: z.enum(ARCHETYPES), committedAt: IsoDateInput.optional() }), input, "commit");
    return one(
      await db
        .update(businesses)
        .set({ archetype: v.archetype, committedAt: v.committedAt ?? new Date() })
        .where(and(eq(businesses.id, businessId), notArchived))
        .returning(),
      "business",
      businessId,
    );
  },

  /**
   * Sets the team-wide stop (0023). Stop all agents outranks a stop already set for a key or credits (only an owner or
   * admin lifts it); otherwise the first reason and time stay, so a later stop never hides why the team stopped.
   */
  async setAgentsStopped(db: Executor, businessId: string, input: { reason: AgentStopReason; at?: Date }): Promise<{ stoppedAt: Date; reason: AgentStopReason; already: boolean }> {
    const v = parseInput(z.object({ reason: z.enum(AGENT_STOP_REASONS), at: z.date().optional() }), input, "agents stop");
    return db.transaction(async (tx) => {
      const before = one(await tx.select({ stoppedAt: businesses.agentsStoppedAt, reason: businesses.agentsStoppedReason }).from(businesses).where(eq(businesses.id, businessId)).for("update").limit(1), "business", businessId);
      const stoppedAt = before.stoppedAt ?? v.at ?? new Date();
      const reason: AgentStopReason = v.reason === "kill_switch" ? "kill_switch" : (before.reason ?? v.reason);
      if (before.stoppedAt === null || before.reason !== reason) await tx.update(businesses).set({ agentsStoppedAt: stoppedAt, agentsStoppedReason: reason }).where(eq(businesses.id, businessId));
      return { stoppedAt, reason, already: before.stoppedAt !== null };
    });
  },

  /**
   * Clears the team-wide stop. With `onlyFor`, only a stop with one of those reasons is cleared (a new key clears a
   * key revoke, a top-up the credits stop; neither lifts Stop all agents). Returns what was cleared.
   */
  async clearAgentsStopped(db: Executor, businessId: string, options: { onlyFor?: readonly AgentStopReason[] } = {}): Promise<{ cleared: boolean; stoppedAt: Date | null; reason: AgentStopReason | null }> {
    return db.transaction(async (tx) => {
      const before = one(await tx.select({ stoppedAt: businesses.agentsStoppedAt, reason: businesses.agentsStoppedReason }).from(businesses).where(eq(businesses.id, businessId)).for("update").limit(1), "business", businessId);
      if (before.stoppedAt === null) return { cleared: false, stoppedAt: null, reason: null };
      if (options.onlyFor && (before.reason === null || !options.onlyFor.includes(before.reason))) return { cleared: false, stoppedAt: before.stoppedAt, reason: before.reason };
      await tx.update(businesses).set({ agentsStoppedAt: null, agentsStoppedReason: null }).where(eq(businesses.id, businessId));
      return { cleared: true, stoppedAt: before.stoppedAt, reason: before.reason };
    });
  },

  /**
   * Service role, for the orchestrator's schedules: the ids of every committed business that is not archived, oldest
   * first. `runnable` leaves out businesses whose team is stopped (0023), for the jobs that start agent work.
   */
  async listForSchedules(db: Executor, options: { runnable?: boolean; limit?: number } = {}): Promise<string[]> {
    const rows = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(notArchived, isNotNull(businesses.committedAt), options.runnable ? isNull(businesses.agentsStoppedAt) : undefined))
      .orderBy(asc(businesses.createdAt), asc(businesses.id))
      .limit(options.limit ?? 10_000);
    return rows.map((r) => r.id);
  },

  /**
   * Service role: the businesses whose scheduled deletion is due at `now` (the latest deletion entry on their audit
   * chain is a request, not a cancellation, and its date has passed). Archived businesses are included.
   */
  async deletionsDue(db: Executor, now: Date = new Date()): Promise<{ businessId: string; scheduledFor: Date; requestedAt: Date }[]> {
    const rows = rowsOf<{ business_id: string; action: string; scheduled_for: string | null; created_at: Date | string }>(
      await db.execute(sql`
        select business_id, action, details ->> 'scheduledFor' as scheduled_for, created_at
          from (
            select distinct on (business_id) business_id, action, details, created_at
              from ${auditLog}
             where action in (${BUSINESS_DELETION_REQUEST_ACTION}, ${BUSINESS_DELETION_CANCEL_ACTION})
             order by business_id, seq desc
          ) latest
         where action = ${BUSINESS_DELETION_REQUEST_ACTION}`),
    );
    return rows
      .map((r) => {
        const requestedAt = new Date(r.created_at);
        const scheduled = r.scheduled_for ? new Date(r.scheduled_for) : null;
        return { businessId: r.business_id, requestedAt, scheduledFor: scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled : new Date(requestedAt.getTime() + BUSINESS_DELETION_DELAY_DAYS * 86_400_000) };
      })
      .filter((r) => r.scheduledFor.getTime() <= now.getTime());
  },

  /**
   * Service role only: permanently deletes the business and everything it owns, its audit chain included (0028
   * `fm_purge_business`). Only the business-deletion job calls it, for a deletion its owner scheduled and did not cancel.
   * Returns false when there was nothing to delete.
   */
  async purge(db: Executor, businessId: string): Promise<boolean> {
    const id = parseInput(Id, businessId, "business id");
    const rows = rowsOf<{ purged: boolean }>(await db.execute(sql`select fm_purge_business(${id}::uuid) as purged`));
    return rows[0]?.purged === true;
  },

  /** Soft delete (permanent deletion is a hard gate). */
  async archive(db: Executor, businessId: string): Promise<Business> {
    return one(await db.update(businesses).set({ archivedAt: new Date() }).where(and(eq(businesses.id, businessId), notArchived)).returning(), "business", businessId);
  },

  /** Undo `archive`: the business is listed and reachable again (its agents stay stopped until resumed). */
  async restore(db: Executor, businessId: string): Promise<Business> {
    return one(await db.update(businesses).set({ archivedAt: null }).where(and(eq(businesses.id, businessId), isNotNull(businesses.archivedAt))).returning(), "archived business", businessId);
  },
};
