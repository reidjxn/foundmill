/**
 * founder.profile.get/update (BUILD §11.1 founder profile; AC-11.1.1 gate lives in apps/web on `profile === null`) and
 * founder.preferences.get/guidance/update: the signed-in person's own date and time format (account_preferences, 0022)
 * and the guided layer's preferences (0064, docs/UX_AUDIT_AND_PLAN.md §6.3), the same in every business. Any signed-in
 * account may call them, with or without a business or a profile; all run as that user under RLS, so a row is only ever
 * their own. No event on a change: preferences belong to the account, not to a business (events and the audit log are
 * business-scoped), and nothing reacts to them but the person's own screens.
 * founder.preferences.signal: the guided layer's product signals (UX plan §11: a tour completed or skipped, an
 * explainer dismissed, a definition opened, guidance turned off), written through the outbox into the business the
 * founder was in when it happened, for the metrics consumer. The client sends one when it records the change (the
 * tour's `onDone`, the explainer's Got it, the switch); a business the caller does not belong to is FORBIDDEN, and an
 * example membership (a read-only walk around a demo) writes nothing into the demo's log.
 * founder.tableViews.get/save: the views a person saves on a data table (saved_table_views, 0041), for a business they
 * belong to or for the account-wide LIVE pages; RLS holds them to their own rows and their own businesses.
 */
import { freeDisplayName, liveModeOpen } from "@foundmill/config";
import { AccountPreferencesPatch, repos, withRls, FounderProfileInput, FounderProfilePatch, SaveTableViewsInput, TableViewsScope, type AccountPreferencesView, type Db, type DbTx, type GuidancePrefs } from "@foundmill/db";
import { GUIDANCE_OFF_SOURCES } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { writeEventRow } from "../services/events";
import { protectedProcedure, router } from "../trpc";
import { founderBusinessesRouter } from "./founder-businesses";

/** Runs fn as the signed-in user, so Postgres RLS holds every row it touches to that user. */
function asUser<T>(ctx: { db: Db; userId: string; email?: string | null }, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return withRls(ctx.db, { userId: ctx.userId, claims: ctx.email ? { email: ctx.email } : undefined }, fn);
}

/**
 * The profile experiences that start with guidance off (UX plan §6.3, decided Oct 20, 2026): someone who has built and
 * sold a business, or run teams and budgets inside one, does not need the product explained; they can turn it on in
 * Settings › Preferences. The values are the founder profile's own (apps/web EXPERIENCE_OPTIONS).
 */
export const EXPERIENCED_FOUNDER_EXPERIENCES: readonly string[] = ["exited", "operator"];

export function guidanceOffByDefault(experience: string | null | undefined): boolean {
  return typeof experience === "string" && EXPERIENCED_FOUNDER_EXPERIENCES.includes(experience.trim().toLowerCase());
}

/** The guided layer's part of the preferences row, the anthropomorphic agents switch and its style (what founder.preferences.guidance answers). */
export function guidancePrefsOf(p: AccountPreferencesView): GuidancePrefs {
  return { guidance: p.guidance, textSize: p.textSize, explainersSeen: p.explainersSeen, toursDone: p.toursDone, checklistDismissedAt: p.checklistDismissedAt, anthropomorphicAgents: p.anthropomorphicAgents, agentStyle: p.agentStyle };
}

const SignalTourId = z.string().trim().min(1).max(120);
const SignalStep = z.number().int().positive().max(20);
const SignalScreenId = z.string().trim().min(1).max(120);

/** One guided-layer signal (the payloads of the guidance.* events in packages/events) and the business it happened in. */
export const GuidanceSignalInput = z.object({
  businessId: z.guid(),
  signal: z.discriminatedUnion("type", [
    z.object({ type: z.literal("guidance.tour_completed"), tourId: SignalTourId, steps: SignalStep }),
    z.object({ type: z.literal("guidance.tour_skipped"), tourId: SignalTourId, atStep: SignalStep, steps: SignalStep }),
    z.object({ type: z.literal("guidance.explainer_dismissed"), screenId: SignalScreenId }),
    z.object({ type: z.literal("guidance.term_opened"), termId: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64), screenId: SignalScreenId.nullable().default(null) }),
    z.object({ type: z.literal("guidance.turned_off"), from: z.enum(GUIDANCE_OFF_SOURCES) }),
  ]),
});
export type GuidanceSignalInput = z.input<typeof GuidanceSignalInput>;

export const founderRouter = router({
  businesses: founderBusinessesRouter,
  profile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      // The profile, the memberships and the open businesses in one statement: one round trip on one pooled connection.
      const { profile, memberships, businesses } = await repos.founders.account(ctx.db, ctx.userId);
      // `features.liveMode`: whether LIVE is open here (the commit screen offers Live only then). `userId` is the account ID
      // a co-founder is added by (Settings › Members); the founder can always read their own.
      return { userId: ctx.userId, profile, complete: profile !== null, email: ctx.email, memberships, businesses, features: { liveMode: liveModeOpen(ctx.env) } };
    }),
    /**
     * Creates the profile on the first save, updates it after. `guidanceTurnedOff` is true only on the save that created
     * the profile with an Exited or Operator experience: guidance was set off then, once, and the client says so
     * ("Guidance is off for experienced founders. Turn it on any time in Settings › Preferences."). A later edit never
     * touches the switch, whatever the experience becomes.
     */
    update: protectedProcedure.input(FounderProfilePatch).mutation(async ({ ctx, input }) => {
      const existing = await repos.founders.get(ctx.db, ctx.userId);
      if (existing) return { ...(await repos.founders.update(ctx.db, ctx.userId, input)), guidanceTurnedOff: false };
      const created = FounderProfileInput.parse({ displayName: input.displayName ?? freeDisplayName(ctx.email?.split("@")[0]), ...input });
      const profile = await repos.founders.upsert(ctx.db, ctx.userId, created);
      const guidanceTurnedOff = guidanceOffByDefault(profile.experience);
      if (guidanceTurnedOff) await asUser(ctx, (tx) => repos.preferences.update(tx, ctx.userId, { guidance: "off" }));
      return { ...profile, guidanceTurnedOff };
    }),
  }),
  preferences: router({
    /** The signed-in person's date and time format; the defaults (US, 12-hour) until they choose. */
    get: protectedProcedure.query(({ ctx }) =>
      asUser(ctx, async (tx) => {
        const p = await repos.preferences.get(tx, ctx.userId);
        return { date: p.date, time: p.time };
      }),
    ),
    /**
     * The guided layer's preferences (the switch, the text size, the explainers seen, the tours done, the checklist) and
     * `anthropomorphicAgents` (0067: agents show a persona's first name and face; default false) with `agentStyle` (0069:
     * humans, cartoon_3d, cartoon_2d or fantasy; default humans, meaningful only while the switch is on).
     */
    guidance: protectedProcedure.query(({ ctx }) => asUser(ctx, async (tx) => guidancePrefsOf(await repos.preferences.get(tx, ctx.userId)))),
    /** Change any of the preferences (formats, the switch, the text size, marks, the checklist, a reset, anthropomorphic agents and their style); returns them all. */
    update: protectedProcedure.input(AccountPreferencesPatch).mutation(({ ctx, input }) => asUser(ctx, (tx) => repos.preferences.update(tx, ctx.userId, input))),
    /**
     * Records one guided-layer signal as a guidance.* event in the business the founder was in (see the file comment).
     * `guidance.turned_off` carries how far the founder had come (tours done, explainers seen), read from their row.
     * Answers `{ written: false }` for an example membership.
     */
    signal: protectedProcedure.input(GuidanceSignalInput).mutation(async ({ ctx, input }) => {
      const { membership, business } = await repos.memberships.access(ctx.db, input.businessId, ctx.userId);
      if (!membership || !business) throw new TRPCError({ code: "FORBIDDEN", message: "You do not belong to this business" });
      if (membership.source === "example") return { written: false as const };
      const { type, ...rest } = input.signal;
      let payload: Record<string, unknown> = rest;
      if (type === "guidance.turned_off") {
        const prefs = await asUser(ctx, (tx) => repos.preferences.get(tx, ctx.userId));
        payload = { ...rest, toursDone: Object.keys(prefs.toursDone).length, explainersSeen: Object.keys(prefs.explainersSeen).length };
      }
      const eventId = await writeEventRow(ctx.db, { businessId: business.id, type, actor: { kind: "user", id: ctx.userId }, payload: payload as never });
      return { written: true as const, eventId };
    }),
  }),
  tableViews: router({
    /** The person's saved views and open view for one table; null until they change something there. */
    get: protectedProcedure.input(TableViewsScope).query(({ ctx, input }) => asUser(ctx, (tx) => repos.tableViews.get(tx, ctx.userId, input))),
    /** Replace the person's views and open view for one table (built-in views stay in code). */
    save: protectedProcedure.input(SaveTableViewsInput).mutation(({ ctx, input }) => asUser(ctx, (tx) => repos.tableViews.save(tx, ctx.userId, input))),
  }),
});
