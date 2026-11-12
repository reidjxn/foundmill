/**
 * account_preferences (0022, 0064) — account-scoped (userId first): how one signed-in person reads dates and times, in
 * every business, and the guided layer's preferences (docs/UX_AUDIT_AND_PLAN.md §6.3): the guidance switch, the text
 * size, which screens' explainers were dismissed, which tours were done and whether the first-week checklist was put
 * away; (0067) whether agents show a persona's first name and AI-generated face (anthropomorphic agents, off by
 * default; off shows agents exactly as before); and (0069) which character style those names and faces are drawn in
 * (humans by default; ignored while the switch is off); and (0073) Builder view (off by default). Routers founder.preferences.get/guidance/update. A person with no
 * row reads the defaults (US dates, 12-hour times, guidance on, standard text, nothing seen), so reading never writes;
 * the first change creates the row.
 */
import {
  AGENT_STYLES,
  DEFAULT_AGENT_STYLE,
  DEFAULT_DATE_FORMAT_PREFS,
  DEFAULT_EMAIL_NOTIFICATION_PREFS,
  DEFAULT_NOTIFICATION_PREFS,
  DateFormatPreference,
  EMAIL_NOTIFICATION_KINDS,
  NOTIFICATION_KINDS,
  TimeFormatPreference,
  type AgentStyle,
  type DateFormatPrefs,
  type EmailNotificationPrefs,
  type NotificationPrefs,
} from "@foundmill/shared";
import { FOUNDER_NOTIFICATION_LIMITS, isValidTimeZone } from "@foundmill/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { accountPreferences, GUIDANCE_MODES, TEXT_SIZES, type GuidanceMode, type SeenMap, type TextSize } from "../schema";
import { defined, maybeOne, one, parseInput, type Executor } from "./_shared";

/** The guided layer's preferences, as the API answers them (`checklistDismissedAt` an ISO instant or null). */
export interface GuidancePrefs {
  guidance: GuidanceMode;
  textSize: TextSize;
  /** Screen ids whose explainer was dismissed with "Got it". */
  explainersSeen: SeenMap;
  /** Tour ids completed or skipped. */
  toursDone: SeenMap;
  /** When the first-week checklist was dismissed; null while it shows. */
  checklistDismissedAt: string | null;
  /** Anthropomorphic agents (0067): agents show a persona's first name and face, beside their position. Default off. */
  anthropomorphicAgents: boolean;
  /** The character style of those names and faces (0069): humans, 3D cartoon, 2D cartoon or fantasy. Default humans. */
  agentStyle: AgentStyle;
  /**
   * Builder view (0073): show how the platform runs the team (cycle numbers, tokens, ETAs, test counts, the Code, Health
   * and Hierarchy tabs, ratings out of 20, technical columns). Default off: hidden, never rewritten.
   */
  builderView: boolean;
}

/**
 * The mobile app's notification preferences (0073, docs/mobile): which kinds of push the person's phones get (every
 * kind on until turned off; the stored map holds only what was chosen) and whether amounts stay off the lock screen.
 */
export interface NotificationPreferences {
  notifications: NotificationPrefs;
  hideAmountsOnLockScreen: boolean;
  /**
   * Which kinds of email Foundmill sends the person (packages 1.5 and 5.1; Settings › Preferences, and the link in every
   * such email turns its kind off). Stored under `email` in the same `notifications` map; every kind on until turned off.
   */
  email: EmailNotificationPrefs;
}

/** Everything on the row a person can choose: the date and time format, the guided layer's preferences and the notification preferences. */
export interface AccountPreferencesView extends DateFormatPrefs, GuidancePrefs, NotificationPreferences {}

/** What everyone reads until they choose: guidance on, standard text, nothing seen, the checklist showing, agents as agents (humans when turned on). */
export const DEFAULT_GUIDANCE_PREFS: Readonly<GuidancePrefs> = Object.freeze({ guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null, anthropomorphicAgents: false, agentStyle: DEFAULT_AGENT_STYLE, builderView: false });

/** Every kind of push and of email on, amounts shown. */
export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> = Object.freeze({ notifications: { ...DEFAULT_NOTIFICATION_PREFS }, hideAmountsOnLockScreen: false, email: { ...DEFAULT_EMAIL_NOTIFICATION_PREFS } });

export const DEFAULT_ACCOUNT_PREFERENCES: Readonly<AccountPreferencesView> = Object.freeze({ ...DEFAULT_DATE_FORMAT_PREFS, ...DEFAULT_GUIDANCE_PREFS, ...DEFAULT_NOTIFICATION_PREFERENCES });

/** Ids to remember as seen or done, each set to true ("Got it" on Home: `{ home: true }`); at most 50 in one change. */
const SeenMarks = z.record(z.string().trim().min(1).max(120), z.literal(true)).refine((m) => Object.keys(m).length <= 50, { message: "At most 50 screens or tours in one change" });

/** The kinds of push to turn on or off in one change (`{ customer: false }`); only the known kinds, at least one. */
const NotificationMarks = z.partialRecord(z.enum(NOTIFICATION_KINDS), z.boolean()).refine((m) => Object.keys(m).length > 0, { message: "Name at least one kind of notification" });

/** The kinds of email to turn on or off in one change (`{ decision_waiting: false }`); only the known kinds, at least one. */
const EmailNotificationMarks = z.partialRecord(z.enum(EMAIL_NOTIFICATION_KINDS), z.boolean()).refine((m) => Object.keys(m).length > 0, { message: "Name at least one kind of email" });

/** The stored map (only what was chosen) merged over the defaults, in the kinds' own order. */
export function notificationPrefsOf(stored: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  const out = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const kind of NOTIFICATION_KINDS) if (typeof stored?.[kind] === "boolean") out[kind] = stored[kind];
  return out;
}

/** The stored `email` map merged over the defaults (every kind on until turned off). */
export function emailNotificationPrefsOf(stored: unknown): EmailNotificationPrefs {
  const out = { ...DEFAULT_EMAIL_NOTIFICATION_PREFS };
  const map = stored && typeof stored === "object" ? (stored as Partial<Record<string, unknown>>) : {};
  for (const kind of EMAIL_NOTIFICATION_KINDS) if (typeof map[kind] === "boolean") out[kind] = map[kind];
  return out;
}

/**
 * A change to any of the preferences; at least one must be given. The maps merge into what is stored (a key is only
 * ever added); `checklistDismissed` true stamps now, false shows the checklist again; `reset` ("Show the first-week
 * checklist again", "Replay the tour") clears both maps and the dismissal, and cannot travel with new marks.
 */
export const AccountPreferencesPatch = z
  .object({
    date: DateFormatPreference.optional(),
    time: TimeFormatPreference.optional(),
    guidance: z.enum(GUIDANCE_MODES).optional(),
    textSize: z.enum(TEXT_SIZES).optional(),
    explainersSeen: SeenMarks.optional(),
    toursDone: SeenMarks.optional(),
    checklistDismissed: z.boolean().optional(),
    anthropomorphicAgents: z.boolean().optional(),
    agentStyle: z.enum(AGENT_STYLES).optional(),
    notifications: NotificationMarks.optional(),
    email: EmailNotificationMarks.optional(),
    hideAmountsOnLockScreen: z.boolean().optional(),
    builderView: z.boolean().optional(),
    reset: z.literal(true).optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: "Choose something to change" })
  .refine((p) => !p.reset || (p.explainersSeen === undefined && p.toursDone === undefined && p.checklistDismissed === undefined), {
    message: "A reset clears what was seen; it cannot also mark a screen, a tour or the checklist",
  });
export type AccountPreferencesPatch = z.input<typeof AccountPreferencesPatch>;

const columns = {
  date: accountPreferences.dateFormat,
  time: accountPreferences.timeFormat,
  guidance: accountPreferences.guidance,
  textSize: accountPreferences.textSize,
  explainersSeen: accountPreferences.explainersSeen,
  toursDone: accountPreferences.toursDone,
  checklistDismissedAt: accountPreferences.checklistDismissedAt,
  anthropomorphicAgents: accountPreferences.anthropomorphicAgents,
  agentStyle: accountPreferences.agentStyle,
  notifications: accountPreferences.notifications,
  hideAmountsOnLockScreen: accountPreferences.hideAmountsOnLockScreen,
  builderView: accountPreferences.builderView,
};

type Row = Pick<typeof accountPreferences.$inferSelect, "guidance" | "textSize" | "explainersSeen" | "toursDone" | "checklistDismissedAt" | "anthropomorphicAgents" | "agentStyle" | "notifications" | "hideAmountsOnLockScreen" | "builderView"> & DateFormatPrefs;

function view(row: Row): AccountPreferencesView {
  return {
    date: row.date,
    time: row.time,
    guidance: row.guidance,
    textSize: row.textSize,
    explainersSeen: row.explainersSeen ?? {},
    toursDone: row.toursDone ?? {},
    checklistDismissedAt: row.checklistDismissedAt ? row.checklistDismissedAt.toISOString() : null,
    anthropomorphicAgents: row.anthropomorphicAgents ?? false,
    agentStyle: row.agentStyle ?? DEFAULT_AGENT_STYLE,
    notifications: notificationPrefsOf(row.notifications),
    hideAmountsOnLockScreen: row.hideAmountsOnLockScreen ?? false,
    email: emailNotificationPrefsOf(row.notifications?.email),
    builderView: row.builderView ?? false,
  };
}

/** `stored || given`: the keys of a change added to a jsonb map in place (a notification kind given again is overwritten). */
const merged = (column: typeof accountPreferences.explainersSeen | typeof accountPreferences.toursDone | typeof accountPreferences.notifications, marks: SeenMap | Partial<NotificationPrefs>) => sql`${column} || ${JSON.stringify(marks)}::jsonb`;

export const preferencesRepo = {
  /** The person's preferences, or the defaults when they never chose. */
  async get(db: Executor, userId: string): Promise<AccountPreferencesView> {
    const row = maybeOne(await db.select(columns).from(accountPreferences).where(eq(accountPreferences.userId, userId)).limit(1));
    return row ? view(row) : { ...DEFAULT_ACCOUNT_PREFERENCES };
  },

  /** Changes what was given and keeps the rest (creating the row on the first change); returns the result. */
  async update(db: Executor, userId: string, patch: AccountPreferencesPatch): Promise<AccountPreferencesView> {
    const v = parseInput(AccountPreferencesPatch, patch, "preferences");
    const dismissedAt = v.checklistDismissed === undefined ? undefined : v.checklistDismissed ? new Date() : null;
    const scalars = defined({ dateFormat: v.date, timeFormat: v.time, guidance: v.guidance, textSize: v.textSize, anthropomorphicAgents: v.anthropomorphicAgents, agentStyle: v.agentStyle, hideAmountsOnLockScreen: v.hideAmountsOnLockScreen, builderView: v.builderView });
    // A first row starts from the defaults, so a reset has nothing to clear and a mark is the whole map.
    const notifications = v.notifications || v.email ? { ...(v.notifications ?? {}), ...(v.email ? { email: v.email } : {}) } : undefined;
    const insert = { userId, ...scalars, ...defined({ explainersSeen: v.explainersSeen, toursDone: v.toursDone, checklistDismissedAt: dismissedAt, notifications }) };
    // The push kinds are keys of the map; the email kinds merge into its `email` map, so one never clears the other.
    const column = accountPreferences.notifications;
    const pushMerged = v.notifications ? merged(column, v.notifications) : sql`${column}`;
    const notificationsSet = v.email ? sql`${pushMerged} || jsonb_build_object('email', coalesce(${column} -> 'email', '{}'::jsonb) || ${JSON.stringify(v.email)}::jsonb)` : v.notifications ? pushMerged : undefined;
    const set = {
      ...scalars,
      ...(v.explainersSeen ? { explainersSeen: merged(accountPreferences.explainersSeen, v.explainersSeen) } : {}),
      ...(v.toursDone ? { toursDone: merged(accountPreferences.toursDone, v.toursDone) } : {}),
      ...(notificationsSet ? { notifications: notificationsSet } : {}),
      ...(dismissedAt !== undefined ? { checklistDismissedAt: dismissedAt } : {}),
      ...(v.reset ? { explainersSeen: {}, toursDone: {}, checklistDismissedAt: null } : {}),
    };
    const rows = await db.insert(accountPreferences).values(insert).onConflictDoUpdate({ target: accountPreferences.userId, set }).returning(columns);
    return view(one(rows, "preferences", userId));
  },

  /** Team call (0082): whether this person's one-to-one calls are shared with the project (default false: private). */
  async shareOneToOneCalls(db: Executor, userId: string): Promise<boolean> {
    const row = maybeOne(await db.select({ v: accountPreferences.shareOneToOneCalls }).from(accountPreferences).where(eq(accountPreferences.userId, userId)).limit(1));
    return row?.v ?? false;
  },

  /**
   * Changes the signed-in person's one-to-one call sharing and, in the same statement, the visibility of every
   * one-to-one call they made in a business they still belong to (`fm_set_share_one_to_one_calls`, security definer,
   * keyed on `auth.uid()`). Run it as the person (`withRls`): it changes nobody else's calls. Returns the calls changed.
   */
  async setShareOneToOneCalls(db: Executor, share: boolean): Promise<{ share: boolean; calls: number }> {
    const v = parseInput(z.boolean(), share, "one-to-one call sharing");
    const rows = (await db.execute(sql`select fm_set_share_one_to_one_calls(${v}) as calls`)) as unknown as { calls: number }[] | { rows: { calls: number }[] };
    const list = Array.isArray(rows) ? rows : rows.rows;
    return { share: v, calls: Number(list[0]?.calls ?? 0) };
  },
};

// ---------------------------------------------------------------------------------------------------
// 0083 — founder email (retention plan, 2026-11-11): kept apart from the view above so the guided layer's
// answers do not change shape. Same row, same policy (`user_id = auth.uid()`).
// ---------------------------------------------------------------------------------------------------

/** What Settings › Preferences › Email shows and the notifier reads. */
export interface EmailPrefs {
  /** Every kind, the person's choice over the default: `notifications.email`, the platform's one map. */
  email: EmailNotificationPrefs;
  /** The morning brief's hour (0–23) in `timeZone`. */
  briefHour: number;
  /** The zone the brief's hour is read in; null: the business's. */
  timeZone: string | null;
  browserNotifications: boolean;
  /** Every email paused from an email's footer (or Settings); null: not paused. */
  emailsPausedAt: string | null;
}

export const DEFAULT_EMAIL_PREFS: Readonly<EmailPrefs> = Object.freeze({
  email: { ...DEFAULT_EMAIL_NOTIFICATION_PREFS },
  briefHour: FOUNDER_NOTIFICATION_LIMITS.defaultBriefHour,
  timeZone: null,
  browserNotifications: false,
  emailsPausedAt: null,
});

export const EmailPrefsPatch = z
  .object({
    email: z.partialRecord(z.enum(EMAIL_NOTIFICATION_KINDS), z.boolean()).optional(),
    briefHour: z.number().int().min(0).max(23).optional(),
    timeZone: z.string().trim().max(64).refine((tz) => isValidTimeZone(tz), "Choose a real time zone").nullable().optional(),
    browserNotifications: z.boolean().optional(),
    emailsPaused: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: "Choose something to change" });
export type EmailPrefsPatch = z.input<typeof EmailPrefsPatch>;

const emailColumns = {
  notifications: accountPreferences.notifications,
  briefHour: accountPreferences.briefHour,
  timeZone: accountPreferences.timeZone,
  browserNotifications: accountPreferences.browserNotifications,
  emailsPausedAt: accountPreferences.emailsPausedAt,
};

function emailView(row: { notifications: { email?: unknown } | null; briefHour: number; timeZone: string | null; browserNotifications: boolean; emailsPausedAt: Date | null }): EmailPrefs {
  return { email: emailNotificationPrefsOf(row.notifications?.email), briefHour: row.briefHour, timeZone: row.timeZone, browserNotifications: row.browserNotifications, emailsPausedAt: row.emailsPausedAt ? row.emailsPausedAt.toISOString() : null };
}

export const emailPrefsRepo = {
  async get(db: Executor, userId: string): Promise<EmailPrefs> {
    const row = maybeOne(await db.select(emailColumns).from(accountPreferences).where(eq(accountPreferences.userId, userId)).limit(1));
    return row ? emailView(row) : { ...DEFAULT_EMAIL_PREFS, email: { ...DEFAULT_EMAIL_PREFS.email } };
  },

  /** Many people at once (the notifier, service role); people with no row read the defaults. */
  async getMany(db: Executor, userIds: readonly string[]): Promise<Map<string, EmailPrefs>> {
    const out = new Map<string, EmailPrefs>();
    if (userIds.length === 0) return out;
    const rows = await db.select({ userId: accountPreferences.userId, ...emailColumns }).from(accountPreferences).where(inArray(accountPreferences.userId, [...userIds]));
    for (const id of userIds) out.set(id, { ...DEFAULT_EMAIL_PREFS, email: { ...DEFAULT_EMAIL_PREFS.email } });
    for (const r of rows) out.set(r.userId, emailView(r));
    return out;
  },

  /**
   * Changes what was given; creates the row on the first change. The switches go through `preferencesRepo.update` (the
   * same merge into `notifications.email` that founder.preferences.update makes), so there is one place they are written.
   */
  async update(db: Executor, userId: string, patch: EmailPrefsPatch): Promise<EmailPrefs> {
    const v = parseInput(EmailPrefsPatch, patch, "email preferences");
    if (v.email && Object.keys(v.email).length > 0) await preferencesRepo.update(db, userId, { email: v.email });
    const pausedAt = v.emailsPaused === undefined ? undefined : v.emailsPaused ? new Date() : null;
    const scalars = defined({ briefHour: v.briefHour, timeZone: v.timeZone, browserNotifications: v.browserNotifications, emailsPausedAt: pausedAt });
    if (Object.keys(scalars).length > 0) await db.insert(accountPreferences).values({ userId, ...scalars }).onConflictDoUpdate({ target: accountPreferences.userId, set: scalars });
    return emailPrefsRepo.get(db, userId);
  },

  /** Pauses every email (an email footer's link, service role after the token is checked). */
  async pauseEmails(db: Executor, userId: string, at: Date = new Date()): Promise<void> {
    await db.insert(accountPreferences).values({ userId, emailsPausedAt: at }).onConflictDoUpdate({ target: accountPreferences.userId, set: { emailsPausedAt: at } });
  },
};
