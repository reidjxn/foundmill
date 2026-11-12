/**
 * A person's own public profile (docs/THESIS_REVIEW.md package 2.3, first part; migration 0080 on `founder_profiles`):
 * a page about the person at `/u/<handle>` that exists without any project and is public only when the person
 * publishes it. Nothing here asks a person building on their own for anything about people: "Building on my own" is the
 * default answer to "What are you here for?" and the page then says nothing about it.
 *
 * - **The person's own** (`founder.publicProfile.get/update/publish/unpublish`, the signed-in account only): reads and
 *   writes the account's own row on the service connection, filtered by the caller's id (the founders repo does the
 *   same). The table's guard trigger refuses a signed-in client that makes a profile public, or changes a public one,
 *   straight through PostgREST, so the screen below cannot be stepped around.
 * - **The address** is the stored handle, or before one is saved a suggestion from the display name (with a short
 *   suffix from a hash of the account id when another person holds it); the first save stores it.
 * - **Screening**: before a profile goes public, and on every save while it is public, the text goes through the same
 *   deterministic checks as a project page (`communityScreenLocalFlags`: markup and script links, email addresses,
 *   phone numbers, after NFKC and with format characters removed), the display name included. What is screened is the
 *   row locked for the write that follows (`repos.personProfiles.lock`, `select … for update` in the same
 *   transaction), so a name changed in between cannot go out unscreened. A held profile is not made public, and a
 *   public one keeps what it showed; the answer says why in one sentence (`PERSON_HOLD_MESSAGES`). No model is called.
 * - **The display name** is changed in "Your profile" (`founder.profile.update`, `updateFounderProfile` below): while
 *   the public profile is public, or a published project page names the person as one of its founders, the new name is
 *   screened the same way, on the locked row, and a held one is refused with the same sentence.
 * - **The address** (`checkHandle`): the page rule, nothing that poses as the product (`isReservedName` with hyphens
 *   read as spaces, or APP_NAME anywhere in it), and not another person's, including a handle someone left less than
 *   `PERSON_HANDLE_HOLD_DAYS` ago (it stays theirs).
 * - **Limits**: the person's own `get`, `update` and `publish` are limited per account (`PUBLIC_PROFILE_OWN_LIMITS`), so
 *   a signed-in script cannot probe handles at speed.
 * - **Events**: a profile going public writes `profile.published`, and taking it down writes `profile.unpublished`,
 *   to the person's own account events (`account_events`, `writeAccountEvent` from @foundmill/events; docs/ARCHITECTURE.md
 *   §5 "Account events"), in the same transaction as the change and once per change of state: a save or a second
 *   publish while it is already public writes nothing. The payload is the handle and nothing else. Nothing is written to
 *   a business's events or audit log (`audit_log.business_id`): this is the account's own, and no project's members
 *   read it.
 * - **An address shaped like an id** (`handleLooksLikeAnId`: the 8-4-4-4-12 shape of an internal id) is refused like
 *   one that poses as the product: a public address must never be mistaken for, or be, an account's id.
 * - **The public read** (`publicPersonByHandle`, unauthenticated): the view `public_person_profiles` on the service
 *   connection (the view is the service role's only), so only its columns leave; null for an unknown handle or a
 *   profile that is not public. Limited per caller, then per handle and across all handles; a lookup that finds nothing
 *   gives those back and draws from a ceiling of its own (`PUBLIC_PERSON_LIMITS`).
 */
import { communityScreenLocalFlags } from "@foundmill/agents";
import { APP_NAME, isReservedName } from "@foundmill/config";
import { createHash } from "node:crypto";
import { repos, type FounderProfile, type FounderProfilePatch, type PersonProfileRow, type PublicPersonProject } from "@foundmill/db";
import { writeAccountEvent } from "@foundmill/events";
import {
  AppError,
  ConflictError,
  EMPTY_PERSON_PROFILE,
  PERSON_HANDLE_RESERVED,
  PERSON_HANDLE_TAKEN,
  PERSON_HOLD_MESSAGES,
  PersonProfileContent,
  ValidationError,
  pagePath,
  personHandleProblem,
  personProfileProblems,
  personUrl,
  suffixPageSlug,
  suggestPersonHandle,
  type PersonHoldReason,
  type PersonLookingFor,
  type PersonProfileContent as ProfileContent,
} from "@foundmill/shared";
import type { Context } from "../context";
import { callerLimitKey } from "./pages";
import { takeOrThrow, type WindowLimit } from "./rate-limit";

type AccountContext = Pick<Context, "db" | "env" | "limits"> & { userId: string };

/**
 * The person's own reads and changes (`founder.publicProfile.get`, `update`, `publish`), per account and per procedure:
 * generous for a person at the editor (a read on focus, a save per press), too few to probe handles at speed.
 */
export const PUBLIC_PROFILE_OWN_LIMITS: Readonly<Record<"get" | "update" | "publish", WindowLimit>> = {
  get: { limit: 30, windowMs: 60_000 },
  update: { limit: 30, windowMs: 60_000 },
  publish: { limit: 30, windowMs: 60_000 },
};

async function takeOwn(ctx: AccountContext, what: keyof typeof PUBLIC_PROFILE_OWN_LIMITS): Promise<void> {
  await takeOrThrow(ctx.limits, "Public profile", [{ key: `public-profile:${what}:${ctx.userId}`, rule: PUBLIC_PROFILE_OWN_LIMITS[what] }]);
}

/** What the edit screen reads (`founder.publicProfile.get`) and every change answers. */
export interface PublicProfileView {
  /** The address: the stored handle, or the suggestion the first save will store. */
  handle: string;
  /** The full public URL (`APP_URL` + `/u/<handle>`). */
  url: string;
  /** False until the person saved once: `handle` is then a suggestion. */
  saved: boolean;
  /** The name the page shows (from the person's profile; changed in Your profile). */
  displayName: string;
  content: ProfileContent;
  public: boolean;
  /** When it last went public (kept after it is taken down). */
  publishedAt: Date | null;
  /** The project pages the public page lists (published, owned by the person, naming its founders). */
  projects: PublicPersonProject[];
}

export type SaveProfileResult = { outcome: "saved"; profile: PublicProfileView } | { outcome: "held"; reason: PersonHoldReason; message: string; profile: PublicProfileView };
export type PublishProfileResult = { outcome: "published"; profile: PublicProfileView } | { outcome: "held"; reason: PersonHoldReason; message: string; profile: PublicProfileView };

/** The sentence for an account that has not finished its profile (the onboarding gate normally prevents it). */
export const PROFILE_MISSING_MESSAGE = "Finish your profile first, then you can make it public.";
const missing = () => new AppError("profile_missing", PROFILE_MISSING_MESSAGE, 409);

/** A short, stable suffix that says nothing about the account (four characters of a hash of its id). */
const accountSuffix = (userId: string): string => createHash("sha256").update(`foundmill/person-handle/v1\n${userId}`).digest("hex").slice(0, 4);

/** The address a first save stores: the display name made into a handle, suffixed when another person holds it. */
export async function suggestedHandle(ctx: AccountContext, displayName: string): Promise<string> {
  const plain = suggestPersonHandle(displayName);
  if (!(await repos.personProfiles.handleTaken(ctx.db, ctx.userId, plain))) return plain;
  const suffixed = suffixPageSlug(plain, accountSuffix(ctx.userId));
  return (await repos.personProfiles.handleTaken(ctx.db, ctx.userId, suffixed)) ? suffixPageSlug(plain, accountSuffix(`${ctx.userId}:2`)) : suffixed;
}

async function viewOf(ctx: AccountContext, row: PersonProfileRow): Promise<PublicProfileView> {
  const [handle, projects] = await Promise.all([row.handle ? Promise.resolve(row.handle) : suggestedHandle(ctx, row.displayName), repos.personProfiles.projectsShown(ctx.db, ctx.userId)]);
  return { handle, url: personUrl(ctx.env.APP_URL, handle), saved: row.handle !== null, displayName: row.displayName, content: row.content, public: row.public, publishedAt: row.publishedAt, projects };
}

/** The first deterministic hold among the profile's texts and the name (markup before personal data), or null. */
export function profileHoldReason(content: ProfileContent, displayName: string): PersonHoldReason | null {
  const flags = communityScreenLocalFlags([displayName, content.headline, content.about, content.place, ...content.strengths, ...content.wantsToLearn].join("\n\n"));
  if (flags.includes("markup")) return "markup";
  if (flags.includes("personal_data")) return "personal_data";
  return null;
}

/** The fields as given, tidied and within their limits; a validation error naming the first field over one. */
function parseContent(content: unknown): ProfileContent {
  const parsed = PersonProfileContent.safeParse(content ?? {});
  if (parsed.success) return parsed.data;
  // Name the field in the person's words where the shared rules can.
  const problems = personProfileProblems({ headline: "", about: "", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", place: "", ...(content as Partial<ProfileContent>) });
  const first = Object.entries(problems)[0];
  throw new ValidationError(first?.[1] ?? "Check the profile's fields and try again.", { field: first?.[0], problems });
}

/**
 * Whether a handle poses as the product or its staff: the reserved-name rule of display names with hyphens read as
 * spaces ("foundmill-support", "admin-desk", look-alike letters too), or the product's name anywhere in it.
 */
export function handlePosesAsPlatform(handle: string): boolean {
  return isReservedName(handle.replace(/-/g, " ")) || handle.toLowerCase().includes(APP_NAME.toLowerCase());
}

/**
 * Whether a handle has the shape of an internal id (8-4-4-4-12 letters a to f and digits). The address rule allows it
 * (letters, digits and hyphens), but a public address is never an id: the events about a profile carry the handle, and
 * an account event's payload never carries anything shaped like an account's id (the two-person rule).
 */
export function handleLooksLikeAnId(handle: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(handle);
}

/**
 * A new handle checked: the address rule, nothing that poses as the product or is shaped like an id, then whether
 * another person holds it (or left it less than `PERSON_HANDLE_HOLD_DAYS` ago). Undefined keeps the stored one.
 */
async function checkHandle(ctx: AccountContext, raw: string | undefined): Promise<string | undefined> {
  if (raw === undefined) return undefined;
  const handle = raw.trim().toLowerCase();
  const problem = personHandleProblem(handle);
  if (problem) throw new ValidationError(problem, { field: "handle" });
  if (handlePosesAsPlatform(handle) || handleLooksLikeAnId(handle)) throw new ValidationError(PERSON_HANDLE_RESERVED, { field: "handle" });
  if (await repos.personProfiles.handleTaken(ctx.db, ctx.userId, handle)) throw new ConflictError(PERSON_HANDLE_TAKEN, { field: "handle" });
  return handle;
}

async function current(ctx: AccountContext): Promise<PersonProfileRow> {
  const row = await repos.personProfiles.get(ctx.db, ctx.userId);
  if (!row) throw missing();
  return row;
}

/** `founder.publicProfile.get`: the profile as it stands (nothing is written). */
export async function getPublicProfile(ctx: AccountContext): Promise<PublicProfileView> {
  await takeOwn(ctx, "get");
  return viewOf(ctx, await current(ctx));
}

export interface ProfileInput {
  /** A new address; absent keeps the stored one (or, on the first save, stores the suggestion). */
  handle?: string;
  content: unknown;
}

/**
 * `founder.publicProfile.update`: saves what the person wrote. While the profile is private nothing is screened (nothing
 * is public). While it is public the save is what the public sees at once, so it is screened first: a held save
 * changes nothing and says why.
 */
export async function updatePublicProfile(ctx: AccountContext, input: ProfileInput): Promise<SaveProfileResult> {
  await takeOwn(ctx, "update");
  const content = parseContent(input.content);
  const existing = await current(ctx);
  const handle = (await checkHandle(ctx, input.handle)) ?? (existing.handle ? undefined : await suggestedHandle(ctx, existing.displayName));
  // Screened on the row as it is locked for the save: a profile published, or a name changed, in between is seen.
  const result = await ctx.db.transaction(async (tx) => {
    const locked = await repos.personProfiles.lock(tx, ctx.userId);
    if (!locked) throw missing();
    const reason = locked.public ? profileHoldReason(content, locked.displayName) : null;
    if (reason) return { reason, row: locked };
    return { reason: null, row: await repos.personProfiles.save(tx, ctx.userId, { handle, content }) };
  });
  if (result.reason) return { outcome: "held", reason: result.reason, message: PERSON_HOLD_MESSAGES[result.reason], profile: await viewOf(ctx, result.row) };
  return { outcome: "saved", profile: await viewOf(ctx, result.row) };
}

/**
 * `founder.publicProfile.publish`: saves `content` (what the person sees in the preview) and makes the profile public,
 * after the screen. A held profile stays as it was: a private one keeps the person's words, private; a public one keeps
 * showing what it showed.
 */
export async function publishPublicProfile(ctx: AccountContext, input: ProfileInput): Promise<PublishProfileResult> {
  await takeOwn(ctx, "publish");
  const content = parseContent(input.content);
  const existing = await current(ctx);
  const handle = (await checkHandle(ctx, input.handle)) ?? (existing.handle ? undefined : await suggestedHandle(ctx, existing.displayName));
  // The screen reads the row locked for the publish (the display name as it is now, not as it was read above), so a
  // name changed in "Your profile" between the two cannot go public unscreened.
  const result = await ctx.db.transaction(async (tx) => {
    const locked = await repos.personProfiles.lock(tx, ctx.userId);
    if (!locked) throw missing();
    const reason = profileHoldReason(content, locked.displayName);
    if (reason) return { reason, row: locked.public ? locked : await repos.personProfiles.save(tx, ctx.userId, { handle, content }) };
    const saved = await repos.personProfiles.save(tx, ctx.userId, { handle, content });
    // An address that was stored, or suggested from a name, before the id rule: it cannot go public. Nothing is saved.
    if (saved.handle && handleLooksLikeAnId(saved.handle)) throw new ValidationError(PERSON_HANDLE_RESERVED, { field: "handle" });
    const row = await repos.personProfiles.publish(tx, ctx.userId);
    // The change from private to public, once, with the row it describes (the lock above makes this the only writer).
    if (!locked.public && row.handle) {
      await writeAccountEvent(tx, { userId: ctx.userId, type: "profile.published", actor: { kind: "user", id: ctx.userId }, payload: { handle: row.handle }, ...(row.publishedAt ? { occurredAt: row.publishedAt } : {}) });
    }
    return { reason: null, row };
  });
  if (result.reason) return { outcome: "held", reason: result.reason, message: PERSON_HOLD_MESSAGES[result.reason], profile: await viewOf(ctx, result.row) };
  return { outcome: "published", profile: await viewOf(ctx, result.row) };
}

/**
 * `founder.profile.update` for an account that has a profile: the change, with the display name screened first when the
 * public can read it (the public profile is public, or a published project page names the person as a founder). The row
 * is locked for the change, so a publish in between waits for it and then screens the new name itself. A held name is
 * refused with the profile's sentence (`PERSON_HOLD_MESSAGES`); nothing changes.
 */
export async function updateFounderProfile(ctx: Pick<Context, "db"> & { userId: string }, patch: FounderProfilePatch): Promise<FounderProfile> {
  return ctx.db.transaction(async (tx) => {
    const locked = await repos.personProfiles.lock(tx, ctx.userId);
    const name = typeof patch.displayName === "string" ? patch.displayName.trim() : undefined;
    if (locked && name !== undefined && name !== locked.displayName) {
      const shown = locked.public || (await repos.personProfiles.projectsShown(tx, ctx.userId)).length > 0;
      // A public profile is screened with what it shows; a name shown only on a page, on its own.
      const reason = shown ? profileHoldReason(locked.public ? locked.content : EMPTY_PERSON_PROFILE, name) : null;
      if (reason) throw new ValidationError(PERSON_HOLD_MESSAGES[reason], { field: "displayName", reason });
    }
    return repos.founders.update(tx, ctx.userId, patch);
  });
}

/**
 * `founder.publicProfile.unpublish`: takes the profile down (everything written stays). A private profile is unchanged,
 * and writes no event. Taking a profile down never waits on, or fails for, its event: the one handle the event could
 * not carry (an address shaped like an id, stored before that rule) is taken down without one.
 */
export async function unpublishPublicProfile(ctx: AccountContext): Promise<PublicProfileView> {
  const taken = await ctx.db.transaction(async (tx) => {
    // `unpublish` changes the row only while it is public, so two calls at once write one event between them.
    const row = await repos.personProfiles.unpublish(tx, ctx.userId);
    if (row?.handle && !handleLooksLikeAnId(row.handle)) {
      await writeAccountEvent(tx, { userId: ctx.userId, type: "profile.unpublished", actor: { kind: "user", id: ctx.userId }, payload: { handle: row.handle } });
    }
    return row;
  });
  return viewOf(ctx, taken ?? (await current(ctx)));
}

/** What anyone may read of a public profile (`publicPerson.byHandle`). */
export interface PublicPersonView {
  handle: string;
  url: string;
  displayName: string;
  headline: string;
  about: string;
  strengths: string[];
  wantsToLearn: string[];
  lookingFor: PersonLookingFor;
  place: string;
  publishedAt: Date;
  /** The person's public project pages: `path` is `/p/<slug>`. */
  projects: (PublicPersonProject & { path: string })[];
}

/**
 * Signed-out reads of person pages, shared by every api replica (`ctx.limits`), in the order `publicPersonByHandle`
 * takes them:
 *   - `perCaller`: by the address the api itself sees (`ctx.clientAddress`, the Follow form's `clientAddressOf`). A page
 *     rendered by the web comes from the web's egress addresses, so every reader of the web shares a few buckets here:
 *     generous, and it is what stops a caller hitting the api directly from emptying the ceilings below alone.
 *   - `perHandle` and `all`: ceilings that keep a flood off the database, one per handle and one across all of them.
 *   - `unknown`: a lookup that finds nothing (an unknown handle, or a profile that is not public) gives its `perHandle`
 *     and `all` hits back and draws from this ceiling instead, so random handles cannot use up what real pages read from.
 */
export const PUBLIC_PERSON_LIMITS = {
  perCaller: { limit: 300, windowMs: 60_000 },
  perHandle: { limit: 600, windowMs: 60_000 },
  all: { limit: 6000, windowMs: 60_000 },
  unknown: { limit: 600, windowMs: 60_000 },
} as const;

export const publicPersonLimitKeys = {
  caller: (env: Context["env"], address: string) => callerLimitKey(env, "public-person", address),
  handle: (handle: string) => `public-person:handle:${handle}`,
  all: "public-person:all",
  unknown: "public-person:unknown",
} as const;

/** `publicPerson.byHandle`: the public profile at `handle`, or null for an unknown handle or a profile that is not public. */
export async function publicPersonByHandle(ctx: Pick<Context, "db" | "env" | "limits"> & { clientAddress?: string | null }, handle: string): Promise<PublicPersonView | null> {
  const clean = handle.trim().toLowerCase();
  if (personHandleProblem(clean)) return null;
  if (ctx.clientAddress) await takeOrThrow(ctx.limits, "Profile view", [{ key: publicPersonLimitKeys.caller(ctx.env, ctx.clientAddress), rule: PUBLIC_PERSON_LIMITS.perCaller }]);
  const ticket = await takeOrThrow(ctx.limits, "Profile view", [
    { key: publicPersonLimitKeys.handle(clean), rule: PUBLIC_PERSON_LIMITS.perHandle },
    { key: publicPersonLimitKeys.all, rule: PUBLIC_PERSON_LIMITS.all },
  ]);
  const person = await repos.personProfiles.public.byHandle(ctx.db, clean);
  if (!person) {
    await ctx.limits.refund(ticket);
    await takeOrThrow(ctx.limits, "Profile view", [{ key: publicPersonLimitKeys.unknown, rule: PUBLIC_PERSON_LIMITS.unknown }]);
    return null;
  }
  return {
    handle: person.handle,
    url: personUrl(ctx.env.APP_URL, person.handle),
    displayName: person.displayName,
    ...person.content,
    publishedAt: person.publishedAt,
    projects: person.projects.map((p) => ({ ...p, path: pagePath(p.slug) })),
  };
}
