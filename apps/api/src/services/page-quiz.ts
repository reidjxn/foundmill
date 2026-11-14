/**
 * The optional "which one is for you" quiz on a project's public page (migration 0105; @foundmill/shared
 * `page-quiz.ts`). Off until the founder turns it on.
 *
 * - **Reading** (`pageQuiz.get`, Product read): the quiz as it stands, the counts of the current version, whether the
 *   project has enough real customers for the team to draft one, and what keeps the definition from being approved.
 * - **Drafting** (`pageQuiz.draft`, Product write, the founder's press): the Product lead drafts from the project's own
 *   customers, purchases and replies (`repos.pageQuizzes.facts`), through packages/agents `runPageQuizDraft` on the
 *   `projectPage` route (the usual credits gate and usage ledger, kind `page_quiz`, an Estimate). Too few customers is
 *   decided before any call. A refusal writes nothing and says why in one plain sentence. A draft is written on the
 *   service connection (clients never insert), audited, and is never public.
 * - **Editing** (`pageQuiz.save`, Product write): a member edits a draft; an owner or an admin also an approved one,
 *   which puts it back to draft (the table's trigger).
 * - **Approving and turning on or off** (`pageQuiz.approve`, `pageQuiz.setLive`): an owner or an admin with Product
 *   write, by their own press (no agent tool reaches these). Approval checks every field (`pageQuizProblems`: limits,
 *   links, no pressure words, the Follow form present for an offer that points to it). Each writes its event through
 *   the outbox and an audit row in the same transaction.
 * - **The public read and the count** (`publicQuiz.bySlug`, `publicQuiz.answer`): the view `public_page_quizzes` on the
 *   service connection, rate-limited like the page. An answer is scored here, against the live version, and only the
 *   result type's count goes up by one: no answers, no address, no time is kept.
 */
import { pageQuizReadiness, runPageQuizDraft, PAGE_QUIZ_USAGE_KIND, type PageQuizFacts } from "@foundmill/agents";
import { repos, type DbTx, type PageQuiz } from "@foundmill/db";
import {
  ForbiddenError,
  PAGE_QUIZ_MIN_CUSTOMERS,
  ValidationError,
  WRITE_ROLES,
  hasSectionAccess,
  pageQuizProblems,
  pageSlugProblem,
  pageUrl,
  readPageContent,
  readPageQuiz,
  scorePageQuiz,
  type Env,
  type PageQuizDefinition,
  type PageQuizEvidence,
  type PageQuizProblem,
  type PageQuizStatus,
} from "@foundmill/shared";
import { audit, emit, type BusinessContext } from "../trpc";
import type { Context } from "../context";
import { callerLimitKey } from "./pages";
import { takeOrThrow } from "./rate-limit";

export interface PageQuizView {
  quiz: {
    definition: PageQuizDefinition;
    status: PageQuizStatus;
    version: number;
    evidence: Partial<PageQuizEvidence>;
    draftedAt: Date;
    approvedAt: Date | null;
    liveAt: Date | null;
  } | null;
  /** How many visitors finished the current version with each result type: counts only, never who. */
  counts: Record<string, number>;
  /** What keeps the definition from being approved, in reading order (empty when it may go out). */
  problems: PageQuizProblem[];
  /** Real customers on record and how many the team needs to draft. */
  readiness: { customers: number; need: number; ready: boolean };
  page: { saved: boolean; live: boolean; followForm: boolean; url: string | null };
  canEdit: boolean;
  canApprove: boolean;
  isSample: boolean;
}

export type PageQuizDraftAnswer = { outcome: "drafted"; view: PageQuizView } | { outcome: "refused"; message: string; view: PageQuizView };

export const PAGE_QUIZ_APPROVE_ROLE_MESSAGE = "Only an owner or an admin can approve the quiz or turn it on or off.";
export const PAGE_QUIZ_NONE_MESSAGE = "There is no quiz yet. Ask the team to draft one from your customers first.";
export const PAGE_QUIZ_EDIT_APPROVED_MESSAGE = "Only an owner or an admin can change an approved quiz.";

const canEditQuiz = (ctx: BusinessContext): boolean => WRITE_ROLES.includes(ctx.role) && hasSectionAccess(ctx.membership, "product", "write");
const canApproveQuiz = (ctx: BusinessContext): boolean => (ctx.role === "owner" || ctx.role === "admin") && hasSectionAccess(ctx.membership, "product", "write");

/** The page as the quiz needs it: its published copy (else its draft), whether it is live, and its address. */
async function pageFacts(tx: DbTx, ctx: BusinessContext) {
  const row = await repos.pages.get(tx, ctx.businessId);
  const published = row ? readPageContent(row.published) : null;
  const content = published ?? (row ? readPageContent(row.draft, true) : null);
  return {
    content: content ?? { pitch: ctx.business.name, about: "", forWhom: "", followForm: false },
    saved: row !== null,
    live: published !== null,
    followForm: (published ?? content)?.followForm === true,
    slug: row?.slug ?? null,
    url: row ? pageUrl(ctx.env.APP_URL, row.slug) : null,
  };
}

async function viewOf(tx: DbTx, ctx: BusinessContext, row: PageQuiz | null): Promise<PageQuizView> {
  const [page, facts] = await Promise.all([pageFacts(tx, ctx), repos.pageQuizzes.facts(tx, ctx.businessId)]);
  const definition = row ? readPageQuiz(row.definition) : null;
  const counts = row ? await repos.pageQuizzes.counts(tx, ctx.businessId, row.id, row.version) : {};
  const ready = pageQuizReadiness({ customers: facts.customers, offers: facts.offers, page: { ...page.content, followForm: page.followForm } });
  return {
    quiz:
      row && definition
        ? { definition, status: row.status, version: row.version, evidence: row.evidence, draftedAt: row.draftedAt, approvedAt: row.approvedAt, liveAt: row.liveAt }
        : null,
    counts,
    problems: definition ? pageQuizProblems(definition, { followForm: page.followForm }) : [],
    readiness: { customers: facts.customers.length, need: PAGE_QUIZ_MIN_CUSTOMERS, ready: ready.ready },
    page: { saved: page.saved, live: page.live, followForm: page.followForm, url: page.url },
    canEdit: canEditQuiz(ctx),
    canApprove: canApproveQuiz(ctx),
    isSample: ctx.business.isDemo,
  };
}

/** `pageQuiz.get`. */
export async function pageQuizView(ctx: BusinessContext): Promise<PageQuizView> {
  return ctx.rls(async (tx) => viewOf(tx, ctx, await repos.pageQuizzes.get(tx, ctx.businessId)));
}

/** The Product lead (else the Chief of Staff): who drafted it, in the audit row and on the row. */
async function authorAgentId(ctx: BusinessContext): Promise<string | null> {
  const departments = await repos.departments.list(ctx.db, ctx.businessId, { includeHidden: true });
  const lead = departments.find((d) => (d.moduleKeys as string[]).includes("product"))?.leadAgentId ?? null;
  return lead ?? (await repos.agents.chiefOfStaff(ctx.db, ctx.businessId))?.id ?? null;
}

/**
 * `pageQuiz.draft`: the team drafts the quiz from the project's real customers. A sample business drafts from its own
 * sample rows (they are its records; nothing of a sample is ever public). Replaces an earlier draft (a new version, off
 * the page) only when a new one is drafted: a refusal leaves everything as it was.
 */
export async function draftPageQuiz(ctx: BusinessContext): Promise<PageQuizDraftAnswer> {
  if (!canEditQuiz(ctx)) throw new ForbiddenError("You can read the quiz but not ask for a draft.");
  const existing = await repos.pageQuizzes.get(ctx.db, ctx.businessId);
  if (existing && existing.status !== "draft" && !canApproveQuiz(ctx)) throw new ForbiddenError(PAGE_QUIZ_EDIT_APPROVED_MESSAGE);
  // The contacts' names and addresses, on the service connection: taken out of what the model reads, and refused in a
  // draft. They are never sent anywhere.
  const [stored, page, terms] = await Promise.all([repos.pageQuizzes.facts(ctx.db, ctx.businessId), ctx.rls((tx) => pageFacts(tx, ctx)), repos.pageQuizzes.personalTerms(ctx.db, ctx.businessId)]);
  const facts: PageQuizFacts = {
    businessName: ctx.business.name,
    page: { pitch: page.content.pitch, about: page.content.about, forWhom: page.content.forWhom, followForm: page.followForm },
    customers: stored.customers,
    offers: stored.offers,
    totals: stored.totals,
  };
  const result = await runPageQuizDraft(ctx.models, facts, { businessId: ctx.businessId, kind: PAGE_QUIZ_USAGE_KIND }, terms);
  if (result.outcome === "refused") {
    ctx.log?.info?.({ businessId: ctx.businessId, reason: result.reason, calls: result.calls }, "page quiz: not drafted");
    return { outcome: "refused", message: result.message, view: await pageQuizView(ctx) };
  }
  const agentId = await authorAgentId(ctx);
  await ctx.db.transaction(async (tx) => {
    const row = await repos.pageQuizzes.writeDraft(tx, ctx.businessId, { definition: result.definition, evidence: result.evidence, agentId });
    await audit(tx, ctx, { action: "page_quiz.drafted", target: { kind: "page_quiz", id: row.id }, details: { version: row.version, types: result.definition.types.length, questions: result.definition.questions.length, calls: result.calls, costMinor: result.costMinor, agentId } });
  });
  return { outcome: "drafted", view: await pageQuizView(ctx) };
}

/** A definition as the client sent it, read and tidied; a ValidationError when it is not one. */
function definitionOf(input: unknown): PageQuizDefinition {
  const def = readPageQuiz(input);
  if (!def) throw new ValidationError("That quiz could not be read. Reload the page and try again.");
  return def;
}

/** `pageQuiz.save`: an edit. Never public: an approved quiz goes back to draft. */
export async function savePageQuiz(ctx: BusinessContext, input: { definition: unknown }): Promise<PageQuizView> {
  if (!canEditQuiz(ctx)) throw new ForbiddenError("You can read the quiz but not change it.");
  const definition = definitionOf(input.definition);
  return ctx.rls(async (tx) => {
    const current = await repos.pageQuizzes.get(tx, ctx.businessId);
    if (!current) throw new ValidationError(PAGE_QUIZ_NONE_MESSAGE);
    if (current.status !== "draft" && !canApproveQuiz(ctx)) throw new ForbiddenError(PAGE_QUIZ_EDIT_APPROVED_MESSAGE);
    const row = (await repos.pageQuizzes.save(tx, ctx.businessId, { definition, userId: ctx.userId })) ?? current;
    if (row.version !== current.version) await audit(tx, ctx, { action: "page_quiz.edited", target: { kind: "page_quiz", id: row.id }, details: { version: row.version, wasStatus: current.status } });
    return viewOf(tx, ctx, row);
  });
}

const factsOf = (row: PageQuiz, definition: PageQuizDefinition) => ({ quizId: row.id, version: row.version, typeCount: definition.types.length, questionCount: definition.questions.length });

/**
 * `pageQuiz.approve`: `definition` (what the founder sees) is saved and approved together. Approving puts nothing on
 * the page; turning it on does. Refused with the first problem when a field is not ready.
 */
export async function approvePageQuiz(ctx: BusinessContext, input: { definition: unknown }): Promise<PageQuizView> {
  if (!canApproveQuiz(ctx)) throw new ForbiddenError(PAGE_QUIZ_APPROVE_ROLE_MESSAGE);
  const definition = definitionOf(input.definition);
  return ctx.rls(async (tx) => {
    const current = await repos.pageQuizzes.get(tx, ctx.businessId);
    if (!current) throw new ValidationError(PAGE_QUIZ_NONE_MESSAGE);
    const page = await pageFacts(tx, ctx);
    const problems = pageQuizProblems(definition, { followForm: page.followForm });
    if (problems.length) throw new ValidationError(problems[0]!.message, { field: problems[0]!.path, problems });
    await repos.pageQuizzes.save(tx, ctx.businessId, { definition, userId: ctx.userId });
    const row = await repos.pageQuizzes.setStatus(tx, ctx.businessId, { from: ["draft"], to: "approved", userId: ctx.userId });
    if (!row) return viewOf(tx, ctx, await repos.pageQuizzes.get(tx, ctx.businessId));
    await emit(tx, ctx, { type: "quiz.approved", payload: factsOf(row, definition) });
    await audit(tx, ctx, { action: "page_quiz.approved", target: { kind: "page_quiz", id: row.id }, details: { version: row.version } });
    return viewOf(tx, ctx, row);
  });
}

/** `pageQuiz.setLive`: turns the approved quiz on (it shows while the page is live) or off (it leaves the page at once). */
export async function setPageQuizLive(ctx: BusinessContext, input: { on: boolean }): Promise<PageQuizView> {
  if (!canApproveQuiz(ctx)) throw new ForbiddenError(PAGE_QUIZ_APPROVE_ROLE_MESSAGE);
  return ctx.rls(async (tx) => {
    const current = await repos.pageQuizzes.get(tx, ctx.businessId);
    if (!current) throw new ValidationError(PAGE_QUIZ_NONE_MESSAGE);
    if (input.on && current.status === "draft") throw new ValidationError("Approve the quiz before you turn it on.");
    const page = await pageFacts(tx, ctx);
    if (input.on && !page.slug) throw new ValidationError("Save your public page first: the quiz shows on it.");
    if (input.on) {
      // Checked again, as the page is now: a link or the Follow form may have changed since it was approved.
      const definition = readPageQuiz(current.definition);
      const problems = definition ? pageQuizProblems(definition, { followForm: page.followForm }) : [{ path: "quiz", message: "That quiz could not be read. Draft it again." }];
      if (problems.length) throw new ValidationError(problems[0]!.message, { field: problems[0]!.path, problems });
    }
    const row = await repos.pageQuizzes.setStatus(tx, ctx.businessId, input.on ? { from: ["approved"], to: "live", userId: ctx.userId } : { from: ["live"], to: "approved", userId: ctx.userId });
    if (!row) return viewOf(tx, ctx, current);
    const definition = readPageQuiz(row.definition)!;
    await emit(tx, ctx, { type: input.on ? "quiz.published" : "quiz.unpublished", payload: { ...factsOf(row, definition), slug: page.slug ?? "" } });
    await audit(tx, ctx, { action: input.on ? "page_quiz.turned_on" : "page_quiz.turned_off", target: { kind: "page_quiz", id: row.id }, details: { version: row.version, slug: page.slug } });
    return viewOf(tx, ctx, row);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The public read and the count
// ---------------------------------------------------------------------------------------------------------------------

/** What a visitor reads of a live quiz (`publicQuiz.bySlug`). */
export interface PublicPageQuizView extends PageQuizDefinition {
  slug: string;
  version: number;
  /** Whether the page carries its Follow form: an offer that points to it shows its button only then. */
  followForm: boolean;
}

/**
 * `busy`: over the answer ceilings, so the api read nothing and scored nothing. The web works the result out from the
 * quiz it already rendered (apps/web lib/public-quiz.ts `localQuizResult`), so the visitor still gets it; it is not counted.
 */
export type PublicQuizAnswer = { outcome: "result"; type: string } | { outcome: "unanswered" } | { outcome: "changed" } | { outcome: "busy" };

/**
 * Signed-out reads and answers, shared by every api replica (`ctx.limits`). The reads follow the page's own ceilings
 * with keys of their own. Every answer comes through the web's Server Action, from the web's own few addresses, so no
 * limit here is per caller (security reviews, Nov 13, 2026): it would be one bucket for every visitor at once.
 *   - `answerPerSlug`, `answerAll`: the read path's per-page and overall ceilings, on keys of their own, taken without
 *     throwing before the database is read. Over either, the answer is `busy` and the web scores it itself from the
 *     quiz it rendered: the visitor still gets their result, and nothing here touched the database.
 *   - `countPerPageHour`, `countAll`: the counting, without throwing; over either the visitor still gets their result
 *     and nothing is counted. The counts are unverified, and the founder's panel says so; nobody else sees them.
 */
export const PUBLIC_QUIZ_LIMITS = {
  perCaller: { limit: 300, windowMs: 60_000 },
  perSlug: { limit: 600, windowMs: 60_000 },
  all: { limit: 6000, windowMs: 60_000 },
  unknown: { limit: 600, windowMs: 60_000 },
  answerPerSlug: { limit: 600, windowMs: 60_000 },
  answerAll: { limit: 6000, windowMs: 60_000 },
  countPerPageHour: { limit: 600, windowMs: 60 * 60_000 },
  countAll: { limit: 3000, windowMs: 60_000 },
} as const;

export const publicQuizLimitKeys = {
  caller: (env: Pick<Env, "SESSION_TOKEN_SECRET">, address: string) => callerLimitKey(env, "public-quiz", address),
  slug: (slug: string) => `public-quiz:slug:${slug}`,
  all: "public-quiz:all",
  unknown: "public-quiz:unknown",
  answerSlug: (slug: string) => `quiz-answer:slug:${slug}`,
  answerAll: "quiz-answer:all",
  countPage: (slug: string) => `quiz-count:page:${slug}:hour`,
  countAll: "quiz-count:all",
} as const;

type PublicContext = Pick<Context, "db" | "env" | "limits"> & { clientAddress?: string | null };

/** `publicQuiz.bySlug`: the live quiz on the page at `slug`, or null (no quiz, turned off, the page not public). */
export async function publicQuizBySlug(ctx: PublicContext, slug: string): Promise<PublicPageQuizView | null> {
  const clean = slug.trim().toLowerCase();
  if (pageSlugProblem(clean)) return null;
  const L = PUBLIC_QUIZ_LIMITS;
  if (ctx.clientAddress) await takeOrThrow(ctx.limits, "Page view", [{ key: publicQuizLimitKeys.caller(ctx.env, ctx.clientAddress), rule: L.perCaller }]);
  const ticket = await takeOrThrow(ctx.limits, "Page view", [
    { key: publicQuizLimitKeys.slug(clean), rule: L.perSlug },
    { key: publicQuizLimitKeys.all, rule: L.all },
  ]);
  const quiz = await repos.pageQuizzes.public.bySlug(ctx.db, clean);
  if (!quiz) {
    await ctx.limits.refund(ticket);
    await takeOrThrow(ctx.limits, "Page view", [{ key: publicQuizLimitKeys.unknown, rule: L.unknown }]);
    return null;
  }
  return { slug: quiz.slug, version: quiz.version, followForm: quiz.followForm, ...quiz.definition };
}

/**
 * `publicQuiz.answer`: the visitor's answers scored against the live version, and that result type counted once. An
 * answer to a version that is no longer live (the founder changed or turned it off meanwhile) is `changed` and counts
 * nothing; a missing answer is `unanswered`.
 */
export async function answerPublicQuiz(ctx: PublicContext, input: { slug: string; version: number; answers: Record<string, string> }): Promise<PublicQuizAnswer> {
  const clean = input.slug.trim().toLowerCase();
  if (pageSlugProblem(clean)) return { outcome: "changed" };
  const L = PUBLIC_QUIZ_LIMITS;
  // The database is protected first; a visitor over the ceilings still gets their result, from the web.
  const ceiling = await ctx.limits.take([
    { key: publicQuizLimitKeys.answerSlug(clean), rule: L.answerPerSlug },
    { key: publicQuizLimitKeys.answerAll, rule: L.answerAll },
  ]);
  if (!ceiling.ok) return { outcome: "busy" };
  const quiz = await repos.pageQuizzes.public.bySlug(ctx.db, clean);
  if (!quiz || quiz.version !== input.version) return { outcome: "changed" };
  const type = scorePageQuiz(quiz.definition, input.answers);
  if (!type) return { outcome: "unanswered" };
  const room = await ctx.limits.take([
    { key: publicQuizLimitKeys.countPage(clean), rule: L.countPerPageHour },
    { key: publicQuizLimitKeys.countAll, rule: L.countAll },
  ]);
  // Over the ceilings the visitor still gets their result; it is just not counted.
  if (room.ok) await repos.pageQuizzes.public.recordResult(ctx.db, { slug: clean, version: quiz.version, typeKey: type });
  return { outcome: "result", type };
}
