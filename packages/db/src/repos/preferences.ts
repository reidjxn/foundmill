/**
 * account_preferences (0022, 0064) — account-scoped (userId first): how one signed-in person reads dates and times, in
 * every business, and the guided layer's preferences (docs/UX_AUDIT_AND_PLAN.md §6.3): the guidance switch, the text
 * size, which screens' explainers were dismissed, which tours were done and whether the first-week checklist was put
 * away; (0067) whether agents show a persona's first name and AI-generated face (anthropomorphic agents, off by
 * default; off shows agents exactly as before); and (0069) which character style those names and faces are drawn in
 * (humans by default; ignored while the switch is off). Routers founder.preferences.get/guidance/update. A person with no
 * row reads the defaults (US dates, 12-hour times, guidance on, standard text, nothing seen), so reading never writes;
 * the first change creates the row.
 */
import { AGENT_STYLES, DEFAULT_AGENT_STYLE, DEFAULT_DATE_FORMAT_PREFS, DEFAULT_NOTIFICATION_PREFS, DateFormatPreference, NOTIFICATION_KINDS, TimeFormatPreference, type AgentStyle, type DateFormatPrefs, type NotificationPrefs } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
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
}

/**
 * The mobile app's notification preferences (0073, docs/mobile): which kinds of push the person's phones get (every
 * kind on until turned off; the stored map holds only what was chosen) and whether amounts stay off the lock screen.
 */
export interface NotificationPreferences {
  notifications: NotificationPrefs;
  hideAmountsOnLockScreen: boolean;
}

/** Everything on the row a person can choose: the date and time format, the guided layer's preferences and the notification preferences. */
export interface AccountPreferencesView extends DateFormatPrefs, GuidancePrefs, NotificationPreferences {}

/** What everyone reads until they choose: guidance on, standard text, nothing seen, the checklist showing, agents as agents (humans when turned on). */
export const DEFAULT_GUIDANCE_PREFS: Readonly<GuidancePrefs> = Object.freeze({ guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null, anthropomorphicAgents: false, agentStyle: DEFAULT_AGENT_STYLE });

/** Every kind of push on, amounts shown. */
export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> = Object.freeze({ notifications: { ...DEFAULT_NOTIFICATION_PREFS }, hideAmountsOnLockScreen: false });

export const DEFAULT_ACCOUNT_PREFERENCES: Readonly<AccountPreferencesView> = Object.freeze({ ...DEFAULT_DATE_FORMAT_PREFS, ...DEFAULT_GUIDANCE_PREFS, ...DEFAULT_NOTIFICATION_PREFERENCES });

/** Ids to remember as seen or done, each set to true ("Got it" on Home: `{ home: true }`); at most 50 in one change. */
const SeenMarks = z.record(z.string().trim().min(1).max(120), z.literal(true)).refine((m) => Object.keys(m).length <= 50, { message: "At most 50 screens or tours in one change" });

/** The kinds of push to turn on or off in one change (`{ customer: false }`); only the known kinds, at least one. */
const NotificationMarks = z.partialRecord(z.enum(NOTIFICATION_KINDS), z.boolean()).refine((m) => Object.keys(m).length > 0, { message: "Name at least one kind of notification" });

/** The stored map (only what was chosen) merged over the defaults, in the kinds' own order. */
export function notificationPrefsOf(stored: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  const out = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const kind of NOTIFICATION_KINDS) if (typeof stored?.[kind] === "boolean") out[kind] = stored[kind];
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
    hideAmountsOnLockScreen: z.boolean().optional(),
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
};

type Row = Pick<typeof accountPreferences.$inferSelect, "guidance" | "textSize" | "explainersSeen" | "toursDone" | "checklistDismissedAt" | "anthropomorphicAgents" | "agentStyle" | "notifications" | "hideAmountsOnLockScreen"> & DateFormatPrefs;

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
    const scalars = defined({ dateFormat: v.date, timeFormat: v.time, guidance: v.guidance, textSize: v.textSize, anthropomorphicAgents: v.anthropomorphicAgents, agentStyle: v.agentStyle, hideAmountsOnLockScreen: v.hideAmountsOnLockScreen });
    // A first row starts from the defaults, so a reset has nothing to clear and a mark is the whole map.
    const insert = { userId, ...scalars, ...defined({ explainersSeen: v.explainersSeen, toursDone: v.toursDone, checklistDismissedAt: dismissedAt, notifications: v.notifications }) };
    const set = {
      ...scalars,
      ...(v.explainersSeen ? { explainersSeen: merged(accountPreferences.explainersSeen, v.explainersSeen) } : {}),
      ...(v.toursDone ? { toursDone: merged(accountPreferences.toursDone, v.toursDone) } : {}),
      ...(v.notifications ? { notifications: merged(accountPreferences.notifications, v.notifications) } : {}),
      ...(dismissedAt !== undefined ? { checklistDismissedAt: dismissedAt } : {}),
      ...(v.reset ? { explainersSeen: {}, toursDone: {}, checklistDismissedAt: null } : {}),
    };
    const rows = await db.insert(accountPreferences).values(insert).onConflictDoUpdate({ target: accountPreferences.userId, set }).returning(columns);
    return view(one(rows, "preferences", userId));
  },
};
