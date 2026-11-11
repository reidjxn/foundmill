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
 *   phone numbers), the display name included. A held profile is not made public, and a public one keeps what it showed;
 *   the answer says why in one sentence (`PERSON_HOLD_MESSAGES`). No model is called.
 * - **Audit**: none. The audit log and the events are business-scoped (`audit_log.business_id`), and this is the
 *   account's own; like `founder.preferences`, nothing is written there.
 * - **The public read** (`publicPersonByHandle`, unauthenticated): the view `public_person_profiles` on the service
 *   connection, so only its columns leave; null for an unknown handle or a profile that is not public.
 */
import { communityScreenLocalFlags } from "@foundmill/agents";
import { createHash } from "node:crypto";
import { repos, type PersonProfileRow, type PublicPersonProject } from "@foundmill/db";
import {
  AppError,
  ConflictError,
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
import { takeOrThrow } from "./rate-limit";

type AccountContext = Pick<Context, "db" | "env"> & { userId: string };

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

/** A new handle checked: the address rule, then whether another person holds it. Undefined keeps the stored one. */
async function checkHandle(ctx: AccountContext, raw: string | undefined): Promise<string | undefined> {
  if (raw === undefined) return undefined;
  const handle = raw.trim().toLowerCase();
  const problem = personHandleProblem(handle);
  if (problem) throw new ValidationError(problem, { field: "handle" });
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
  const content = parseContent(input.content);
  const existing = await current(ctx);
  const handle = (await checkHandle(ctx, input.handle)) ?? (existing.handle ? undefined : await suggestedHandle(ctx, existing.displayName));
  if (existing.public) {
    const reason = profileHoldReason(content, existing.displayName);
    if (reason) return { outcome: "held", reason, message: PERSON_HOLD_MESSAGES[reason], profile: await viewOf(ctx, existing) };
  }
  return { outcome: "saved", profile: await viewOf(ctx, await repos.personProfiles.save(ctx.db, ctx.userId, { handle, content })) };
}

/**
 * `founder.publicProfile.publish`: saves `content` (what the person sees in the preview) and makes the profile public,
 * after the screen. A held profile stays as it was: a private one keeps the person's words, private; a public one keeps
 * showing what it showed.
 */
export async function publishPublicProfile(ctx: AccountContext, input: ProfileInput): Promise<PublishProfileResult> {
  const content = parseContent(input.content);
  const existing = await current(ctx);
  const handle = (await checkHandle(ctx, input.handle)) ?? (existing.handle ? undefined : await suggestedHandle(ctx, existing.displayName));
  const reason = profileHoldReason(content, existing.displayName);
  if (reason) {
    const row = existing.public ? existing : await repos.personProfiles.save(ctx.db, ctx.userId, { handle, content });
    return { outcome: "held", reason, message: PERSON_HOLD_MESSAGES[reason], profile: await viewOf(ctx, row) };
  }
  const row = await ctx.db.transaction(async (tx) => {
    await repos.personProfiles.save(tx, ctx.userId, { handle, content });
    return repos.personProfiles.publish(tx, ctx.userId);
  });
  return { outcome: "published", profile: await viewOf(ctx, row) };
}

/** `founder.publicProfile.unpublish`: takes the profile down (everything written stays). A private profile is unchanged. */
export async function unpublishPublicProfile(ctx: AccountContext): Promise<PublicProfileView> {
  const row = (await repos.personProfiles.unpublish(ctx.db, ctx.userId)) ?? (await current(ctx));
  return viewOf(ctx, row);
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
 * Signed-out reads of person pages, shared by every api replica (`ctx.limits`): ceilings that keep a flood off the
 * database (the api sees the web server, not the reader), one per handle and one across all of them, like the pages'.
 */
export const PUBLIC_PERSON_LIMITS = {
  perHandle: { limit: 600, windowMs: 60_000 },
  all: { limit: 6000, windowMs: 60_000 },
} as const;

/** `publicPerson.byHandle`: the public profile at `handle`, or null for an unknown handle or a profile that is not public. */
export async function publicPersonByHandle(ctx: Pick<Context, "db" | "env" | "limits">, handle: string): Promise<PublicPersonView | null> {
  const clean = handle.trim().toLowerCase();
  if (personHandleProblem(clean)) return null;
  await takeOrThrow(ctx.limits, "Profile view", [
    { key: `public-person:handle:${clean}`, rule: PUBLIC_PERSON_LIMITS.perHandle },
    { key: "public-person:all", rule: PUBLIC_PERSON_LIMITS.all },
  ]);
  const person = await repos.personProfiles.public.byHandle(ctx.db, clean);
  if (!person) return null;
  return {
    handle: person.handle,
    url: personUrl(ctx.env.APP_URL, person.handle),
    displayName: person.displayName,
    ...person.content,
    publishedAt: person.publishedAt,
    projects: person.projects.map((p) => ({ ...p, path: pagePath(p.slug) })),
  };
}
