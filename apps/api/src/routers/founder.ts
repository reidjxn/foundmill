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
 * founder.preferences.notifications and founder.devices.list/register/unregister (0075, docs/mobile): the mobile app's
 * push preferences (which kinds, amounts off the lock screen), the email channel beside them (which kinds of email
 * Foundmill sends the person, packages 1.5 and 5.1; changed through `update` with `email`) and the phones it registered. `register` runs with the
 * service role so a token follows the latest sign-in on a phone (packages/db repos/devices.ts); the rest run as the user.
 * founder.publicProfile.get/update/publish/unpublish (0080, package 2.3): the person's own public profile at /u/<handle>,
 * and publicPerson.byHandle, its signed-out read (services/person-profile.ts).
 * founder.profile.update also takes `via` (0088, docs/NETWORK.md §5): who or what brought the person, recorded once on
 * the save that creates the profile (services/attribution.ts), and `ideaDraftToken`, which no step reads yet. Both go
 * to `onPersonCreated` (services/person-created.ts), the one place that runs what happens once when a person's profile
 * is first created.
 */
import { freeDisplayName, liveModeOpen } from "@foundmill/config";
import { AccountPreferencesPatch, EmailPrefsPatch, RegisterDeviceInput, UnregisterDeviceInput, repos, withRls, FounderProfileInput, FounderProfilePatch, SaveTableViewsInput, TableViewsScope, type AccountPreferencesView, type Db, type DbTx, type GuidancePrefs, type NotificationPreferences } from "@foundmill/db";
import { FOUNDER_RETURN_VIA, GUIDANCE_OFF_SOURCES, PAGE_SLUG_MAX, PERSON_ABOUT_MAX, PERSON_HEADLINE_MAX, PERSON_LOOKING_FOR, PERSON_PLACE_MAX, PERSON_TAGS_MAX, PERSON_TAG_MAX } from "@foundmill/shared";
import { VIA_MAX_LENGTH } from "@foundmill/shared/via";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adultConfirmedAt, recordAdultConfirmation, requireAdult } from "../services/adults";
import { IDEA_DRAFT_TOKEN_MAX_LENGTH, onPersonCreated } from "../services/person-created";
import { writeEventRow } from "../services/events";
import { getPublicProfile, publicPersonByHandle, publishPublicProfile, unpublishPublicProfile, updateFounderProfile, updatePublicProfile } from "../services/person-profile";
import { protectedProcedure, publicProcedure, router, signedInProcedure } from "../trpc";
import { founderBusinessesRouter } from "./founder-businesses";
import { cancelDeletionAsFormerFounder, formerProjectCards } from "../services/founder-notices";

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

/** The guided layer's part of the preferences row, the anthropomorphic agents switch and its style, and Builder view (what founder.preferences.guidance answers). */
export function guidancePrefsOf(p: AccountPreferencesView): GuidancePrefs {
  return { guidance: p.guidance, textSize: p.textSize, explainersSeen: p.explainersSeen, toursDone: p.toursDone, checklistDismissedAt: p.checklistDismissedAt, anthropomorphicAgents: p.anthropomorphicAgents, agentStyle: p.agentStyle, builderView: p.builderView };
}

/** The mobile app's part of the preferences row (what founder.preferences.notifications answers). */
export function notificationPrefsOf(p: AccountPreferencesView): NotificationPreferences {
  return { notifications: p.notifications, hideAmountsOnLockScreen: p.hideAmountsOnLockScreen, email: p.email };
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

/** The public profile's fields as the client sends them; the shared schema tidies and checks them in the service. */
export const PublicProfileInput = z.object({
  handle: z.string().max(PAGE_SLUG_MAX * 2).optional(),
  content: z.object({
    headline: z.string().max(PERSON_HEADLINE_MAX * 4).default(""),
    about: z.string().max(PERSON_ABOUT_MAX * 4).default(""),
    strengths: z.array(z.string().max(PERSON_TAG_MAX * 4)).max(PERSON_TAGS_MAX * 4).default([]),
    wantsToLearn: z.array(z.string().max(PERSON_TAG_MAX * 4)).max(PERSON_TAGS_MAX * 4).default([]),
    lookingFor: z.enum(PERSON_LOOKING_FOR).default("on_my_own"),
    place: z.string().max(PERSON_PLACE_MAX * 4).default(""),
  }),
});

/**
 * founder.profile.update: the profile's fields, and two values for the steps that run once when the profile is first
 * created (services/person-created.ts). Neither is a field of the profile, both are read only on the save that creates
 * it, and neither changes the answer:
 *   - `via`, the reference the person first arrived with (@foundmill/shared/via; the web hands over its cookie), for
 *     services/attribution.ts;
 *   - `ideaDraftToken`, the token of an idea drafted before sign-up: bounded, accepted and passed through. No step
 *     reads it yet (the step that claims the draft is added with that feature). A secret: never logged.
 */
export const FounderProfileUpdateInput = FounderProfilePatch.extend({
  via: z.string().max(VIA_MAX_LENGTH).optional(),
  ideaDraftToken: z.string().max(IDEA_DRAFT_TOKEN_MAX_LENGTH).optional(),
  /** "I am 18 or older", ticked on the screen that creates the profile (services/adults.ts); read on that save only. */
  confirmAdult: z.literal(true).optional(),
});

/** publicPerson.byHandle: anyone, signed in or not; the view `public_person_profiles` only; null when not public. */
export const publicPersonRouter = router({
  byHandle: publicProcedure.input(z.object({ handle: z.string().max(PAGE_SLUG_MAX * 2) })).query(({ ctx, input }) => publicPersonByHandle(ctx, input.handle)),
});
/**
 * One presence ping from an open tab of a business (retention plan, 2026-11-11). `via` and `notificationId` come from a
 * notification link's query string (`?via=email&n=<id>`) on the first ping after the founder followed it.
 */
export const PresencePingInput = z.object({
  businessId: z.guid(),
  via: z.enum(FOUNDER_RETURN_VIA).default("direct"),
  notificationId: z.guid().nullable().default(null),
});
export type PresencePingInput = z.input<typeof PresencePingInput>;

export const founderRouter = router({
  businesses: founderBusinessesRouter,
  /**
   * founder.formerProjects.list/cancel (security review P2-3): the card on the home of a former founder for the deletion
   * that waits (someone else demoted or removed them within 30 days before the request, or after it). `list` names each
   * such project with the request, the day it is due and the last moment they may cancel (that day); `cancel` cancels
   * that request, if it is still the one waiting, as them (an audit entry of theirs, every
   * founder told) and restores nothing else. Both on the service connection for the signed-in person's own id: they can
   * no longer read the project's rows themselves.
   */
  formerProjects: router({
    list: protectedProcedure.query(({ ctx }) => formerProjectCards(ctx.db, ctx.userId)),
    cancel: protectedProcedure.input(z.object({ businessId: z.guid(), requestId: z.guid() })).mutation(({ ctx, input }) => cancelDeletionAsFormerFounder(ctx, { businessId: input.businessId, userId: ctx.userId, requestId: input.requestId, via: "home" })),
  }),
  /**
   * founder.presence.ping: the signed-in person is in this business now. Runs as them (RLS: their own row, a business
   * they belong to). The first ping of a session (the first ever, or after 30 minutes away) writes
   * `founder.session_started` through the outbox, and a notification link marks that notification opened. An example
   * membership (a read-only walk around a demo) records nothing.
   */
  presence: router({
    ping: protectedProcedure.input(PresencePingInput).mutation(async ({ ctx, input }) => {
      const { membership, business } = await repos.memberships.access(ctx.db, input.businessId, ctx.userId);
      if (!membership || !business) throw new TRPCError({ code: "FORBIDDEN", message: "You do not belong to this business" });
      if (membership.source === "example") return { recorded: false as const };
      const now = new Date();
      // A return counts as from a notification only when that notification went to this founder (security review P3).
      const sent = input.notificationId && input.via !== "direct" ? await repos.notifications.get(ctx.db, business.id, input.notificationId) : null;
      const via = sent && sent.userId === ctx.userId ? input.via : "direct";
      const ping = await asUser(ctx, (tx) => repos.presence.ping(tx, business.id, ctx.userId, { now, timeZone: business.timeZone, via }));
      if (sent && via !== "direct") await repos.notifications.markOpened(ctx.db, business.id, ctx.userId, sent.id, now);
      if (ping.newSession) {
        const minutesAway = ping.previousSeenAt ? Math.max(0, Math.round((now.getTime() - Date.parse(ping.previousSeenAt)) / 60_000)) : null;
        await writeEventRow(ctx.db, { businessId: business.id, type: "founder.session_started", actor: { kind: "user", id: ctx.userId }, payload: { via, notificationId: via === "direct" ? null : (sent?.id ?? null), minutesAway, sessions: ping.sessions } });
      }
      return { recorded: true as const, newSession: ping.newSession, previousSeenAt: ping.previousSeenAt, sessionStartedAt: ping.sessionStartedAt, sessions: ping.sessions };
    }),
    /** The person's presence in the business (null before their first ping). */
    get: protectedProcedure.input(z.object({ businessId: z.guid() })).query(({ ctx, input }) => asUser(ctx, (tx) => repos.presence.get(tx, input.businessId, ctx.userId))),
  }),
  profile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      // The profile, the memberships and the open businesses in one statement: one round trip on one pooled connection.
      const { profile, memberships, businesses, adultConfirmed } = await repos.founders.account(ctx.db, ctx.userId);
      // `features.liveMode`: whether LIVE is open here (the commit screen offers Live only then). `userId` is the account ID
      // a co-founder is added by (Settings › Members); the founder can always read their own. `complete`: the profile
      // exists; `adultConfirmed`: the person confirmed they are 18 or older (0100). A client goes on past sign-up only
      // with both, and asks for the confirmation once when it is missing (`founder.adult.confirm`).
      return { userId: ctx.userId, profile, complete: profile !== null, adultConfirmed, email: ctx.email, memberships, businesses, features: { liveMode: liveModeOpen(ctx.env) } };
    }),
    /**
     * Creates the profile on the first save, updates it after. `guidanceTurnedOff` is true only on the save that created
     * the profile with an Exited or Operator experience: guidance was set off then, once, and the client says so
     * ("Guidance is off for experienced founders. Turn it on any time in Settings › Preferences."). The same save turns
     * Builder view on (0073; founder, Nov 8, 2026): they see how the platform runs the team from the start. A later edit
     * never touches either switch, whatever the experience becomes.
     * A new display name the public can read (the public profile is public, or a published project page names the
     * person as a founder) is screened first, like the profile's own text, and refused with its sentence when held
     * (services/person-profile.ts `updateFounderProfile`).
     * `via` (who or what brought the person) is recorded once, on the save that creates the profile, when it names a
     * public project page or a public person profile; the answer is the same whether it did, and a later save ignores it
     * (services/attribution.ts). It and `ideaDraftToken` go to `onPersonCreated` on that save only: each step there
     * runs in its own transaction and its own try/catch, so none can fail this save or change its answer.
     */
    update: protectedProcedure.input(FounderProfileUpdateInput).mutation(async ({ ctx, input: { via, ideaDraftToken, confirmAdult, ...input } }) => {
      const existing = await repos.founders.get(ctx.db, ctx.userId);
      if (existing) return { ...(await updateFounderProfile(ctx, input)), guidanceTurnedOff: false };
      // 18 or older, for the whole product (services/adults.ts): a new account creates its profile only with the box
      // ticked on this save, or an earlier confirmation (an invitation's accept, the network). The confirmation is
      // recorded here, before the profile, so a profile never exists without it; the step after it writes nothing then.
      await requireAdult(ctx.db, ctx.userId, confirmAdult);
      const created = FounderProfileInput.parse({ displayName: input.displayName ?? freeDisplayName(ctx.email?.split("@")[0]), ...input });
      const profile = await repos.founders.upsert(ctx.db, ctx.userId, created);
      const guidanceTurnedOff = guidanceOffByDefault(profile.experience);
      if (guidanceTurnedOff) await asUser(ctx, (tx) => repos.preferences.update(tx, ctx.userId, { guidance: "off", builderView: true }));
      await onPersonCreated(ctx, ctx.userId, { via, ideaDraftToken, confirmAdult, client: ctx.clientKind });
      return { ...profile, guidanceTurnedOff };
    }),
  }),
  /**
   * founder.adult.get/confirm: "I am 18 or older", for the whole product (0100, services/adults.ts). Signed in with a
   * confirmed address, admitted or not (`signedInProcedure`), so an invitee is asked before accepting and the phone app
   * can ask before anything else. `confirm` is for a person whose account has no confirmation yet (here before this
   * record existed, or a profile save whose step did not finish): the first confirmation stands, and a second call
   * writes nothing and answers the first time. The database sets the time.
   */
  adult: router({
    get: signedInProcedure.query(async ({ ctx }) => {
      const at = await adultConfirmedAt(ctx.db, ctx.userId);
      return { confirmed: at !== null, confirmedAt: at?.toISOString() ?? null };
    }),
    confirm: signedInProcedure.input(z.object({ confirm: z.literal(true) })).mutation(async ({ ctx }) => {
      const { confirmedAt } = await recordAdultConfirmation(ctx.db, ctx.userId);
      return { confirmed: true as const, confirmedAt: confirmedAt.toISOString() };
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
     * humans, cartoon_3d, cartoon_2d or fantasy; default humans, meaningful only while the switch is on) and `builderView`
     * (0073: show how the platform runs the team; default false).
     */
    guidance: protectedProcedure.query(({ ctx }) => asUser(ctx, async (tx) => guidancePrefsOf(await repos.preferences.get(tx, ctx.userId)))),
    /** Which kinds of push the person's phones get (every kind on until turned off) and whether amounts stay off the lock screen (0075). */
    notifications: protectedProcedure.query(({ ctx }) => asUser(ctx, async (tx) => notificationPrefsOf(await repos.preferences.get(tx, ctx.userId)))),
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
  /**
   * The person's own public profile at /u/<handle> (0080; services/person-profile.ts): the signed-in account only, its
   * own row. `update` saves (screened while the profile is public); `publish` saves and makes it public after the
   * screen; `unpublish` takes it down. A held save or publish answers `{ outcome: "held", message }` and changes nothing
   * public. `get`, `update` and `publish` are limited per account (`PUBLIC_PROFILE_OWN_LIMITS`, 30 a minute each).
   */
  publicProfile: router({
    get: protectedProcedure.query(({ ctx }) => getPublicProfile(ctx)),
    update: protectedProcedure.input(PublicProfileInput).mutation(({ ctx, input }) => updatePublicProfile(ctx, input)),
    publish: protectedProcedure.input(PublicProfileInput).mutation(({ ctx, input }) => publishPublicProfile(ctx, input)),
    unpublish: protectedProcedure.mutation(({ ctx }) => unpublishPublicProfile(ctx)),
  }),
  devices: router({
    /** The person's phones registered for push, the most recently seen first. */
    list: protectedProcedure.query(({ ctx }) => asUser(ctx, (tx) => repos.devices.list(tx, ctx.userId))),
    /**
     * Registers the phone the app runs on (after sign-in, and again on every launch to refresh `lastSeenAt` and the
     * version). Runs with the service role: a token another account held on this phone moves to the person signing in.
     */
    register: protectedProcedure.input(RegisterDeviceInput).mutation(({ ctx, input }) => repos.devices.register(ctx.db, ctx.userId, input)),
    /** Forgets this phone (sign-out). Someone else's token is not theirs to forget: `removed` is false. */
    unregister: protectedProcedure.input(UnregisterDeviceInput).mutation(({ ctx, input }) => asUser(ctx, (tx) => repos.devices.unregister(tx, ctx.userId, input.token))),
  }),
  /**
   * founder.email.get/update: the person's founder emails (retention plan, 2026-11-11): which kinds are on, the
   * morning brief's hour and zone, browser notifications, and the pause. Account-scoped like the other preferences, run
   * as the person under RLS (push switches stay in founder.preferences.notifications, 0075). founder.email.recent: the latest emails sent (or skipped) to them in one business,
   * without the HTML.
   */
  email: router({
    get: protectedProcedure.query(({ ctx }) => asUser(ctx, (tx) => repos.emailPrefs.get(tx, ctx.userId))),
    update: protectedProcedure.input(EmailPrefsPatch).mutation(({ ctx, input }) => asUser(ctx, (tx) => repos.emailPrefs.update(tx, ctx.userId, input))),
    recent: protectedProcedure.input(z.object({ businessId: z.guid(), limit: z.number().int().min(1).max(50).default(10) })).query(({ ctx, input }) => asUser(ctx, (tx) => repos.notifications.listForUser(tx, input.businessId, ctx.userId, input.limit))),
  }),
  tableViews: router({
    /** The person's saved views and open view for one table; null until they change something there. */
    get: protectedProcedure.input(TableViewsScope).query(({ ctx, input }) => asUser(ctx, (tx) => repos.tableViews.get(tx, ctx.userId, input))),
    /** Replace the person's views and open view for one table (built-in views stay in code). */
    save: protectedProcedure.input(SaveTableViewsInput).mutation(({ ctx, input }) => asUser(ctx, (tx) => repos.tableViews.save(tx, ctx.userId, input))),
  }),
});
