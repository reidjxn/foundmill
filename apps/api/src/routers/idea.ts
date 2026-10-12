/**
 * idea.generate/compare/merge/fork/ask/discard/commit — the Ideation Studio (BUILD §11.1 Door A).
 * Ideation is account-scoped and private (no business yet); every action creates an `idea_version` (AC-11.1.3).
 */
import { repos, type IdeaWithVersion } from "@foundmill/db";
import { HOUSE_STYLE } from "@foundmill/agents";
import { ARCHETYPES, Archetype, BUSINESS_MODES, GAME_MODES, ValidationError } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { commitIdea, squadPreview } from "../services/commit";
import { conceptPersona, conceptStarters, replyAboutConcept } from "../services/conversation";
import { linkableImportJob } from "../services/foundations";
import { draftEventStream, draftIdeas, isMeta, readMeta, withMeta, type DraftEvent } from "../services/ideation";
import { importJobKey } from "../services/import";
import { requireAdultToGoLive } from "../services/live";
import { LogoChoice, takeLogoCheck } from "../services/logo";
import { ideaLogoRouter } from "./logo";
import type { Context } from "../context";
import { Id, internalErrorMessage, protectedProcedure, router, toTRPCError } from "../trpc";

export { readMeta, withMeta } from "../services/ideation";
export type { DraftEvent } from "../services/ideation";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const Verdict = z.object({ verdict_md: z.string().min(1), ranking: z.array(z.object({ idea_id: z.string(), rank: z.number().int().min(1), reason: z.string() })).min(1) });

type AttrMap = Record<string, { value: number; evidence?: string }>;
type Research = { citations: unknown[] };

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);

function mergeAttributes(sources: IdeaWithVersion[]): AttrMap {
  const out: AttrMap = {};
  const keys = new Set(sources.flatMap((s) => Object.keys((s.current?.attributes as AttrMap | undefined) ?? {})));
  for (const key of keys) {
    const vals = sources.map((s) => ((s.current?.attributes as AttrMap | undefined) ?? {})[key]).filter((v): v is { value: number; evidence?: string } => Boolean(v));
    if (!vals.length) continue;
    out[key] = { value: Math.round(vals.reduce((a, v) => a + v.value, 0) / vals.length), evidence: vals.map((v) => v.evidence).filter(Boolean).join(" / ") };
  }
  return out;
}

/** "market_pull" → "market pull" (the card's own words for its attributes). */
const attributeWords = (key: string): string => key.replace(/_/g, " ").replace(/\bagent executability\b/, "agent-executability");

/**
 * Why a card ranks where it does when the model gave no ranking: where it leads the other cards outright and where it
 * is weakest, from the cards' own ratings (never "no model ranking", never invented).
 */
export function attributeReason(idea: Pick<IdeaWithVersion, "current">, others: readonly Pick<IdeaWithVersion, "current">[]): string {
  const attrs = (idea.current?.attributes as AttrMap | undefined) ?? {};
  const keys = Object.keys(attrs).filter((k) => typeof attrs[k]?.value === "number");
  if (keys.length === 0) return "Placed by its star ratings; this card has no attribute ratings yet.";
  const otherValue = (o: Pick<IdeaWithVersion, "current">, k: string) => ((o.current?.attributes as AttrMap | undefined) ?? {})[k]?.value;
  const margin = (k: string) => attrs[k]!.value - Math.max(...others.map((o) => otherValue(o, k) ?? -Infinity));
  const leads = keys.filter((k) => margin(k) > 0).sort((a, b) => margin(b) - margin(a)).slice(0, 2);
  const weakest = [...keys].sort((a, b) => attrs[a]!.value - attrs[b]!.value)[0]!;
  const first = leads.length ? `Leads on ${leads.map((k) => `${attributeWords(k)} (${attrs[k]!.value})`).join(" and ")}` : "Leads on no attribute outright";
  const last = leads.includes(weakest) ? "" : `; weakest on ${attributeWords(weakest)} (${attrs[weakest]!.value})`;
  return `${first}${last}.`;
}

export { IDEATION_CARD_MAX_TOKENS, IDEATION_SLATE_MAX_TOKENS } from "@foundmill/agents";
/** Output budget for Import's single card (one card call, like each card of a set). */
export { IDEATION_CARD_MAX_TOKENS as SINGLE_CONCEPT_MAX_TOKENS } from "@foundmill/agents";

const GenerateInput = z.object({ prompt: z.string().max(4000).default(""), archetypeHint: Archetype.optional(), single: z.boolean().default(false), importJobId: z.string().min(8).max(8192).optional() });
type GenerateInput = z.infer<typeof GenerateInput>;

/** The Import job a draft may record (Import's "Continue to Commit"), verified; null when none was given. */
function importJobOf(ctx: Pick<Context, "env">, userId: string, input: GenerateInput): string | null {
  if (!input.importJobId) return null;
  const importJobId = linkableImportJob(importJobKey(ctx.env), input.importJobId, userId);
  if (!importJobId) throw new ValidationError("That import job cannot be linked to a new business");
  return importJobId;
}

export const ideaRouter = router({
  /** Logo before commit: check an upload, or generate marks for the idea (the choice travels with `commit`). */
  logo: ideaLogoRouter,

  list: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50), cursor: z.string().nullish() }).optional()).query(({ ctx, input }) => repos.ideas.listForUser(ctx.db, ctx.userId, input ?? {})),

  get: protectedProcedure.input(z.object({ ideaId: Id })).query(async ({ ctx, input }) => {
    const idea = await repos.ideas.get(ctx.db, ctx.userId, input.ideaId);
    const versions = await repos.ideas.versions(ctx.db, ctx.userId, input.ideaId);
    return { idea, versions };
  }),

  /**
   * Prompt (or empty = "surprise me within my constraints") → 6–12 concept cards (AC-11.1.2), answered when the whole set
   * is saved. `importJobId` is Import's "Continue to Commit": the job the single card describes, recorded on the idea so
   * commit links the business to it. The Studio uses `draft` instead, which streams the same draft card by card.
   */
  generate: protectedProcedure.input(GenerateInput).mutation(async ({ ctx, input, signal }) => {
    const importJobId = importJobOf(ctx, ctx.userId, input);
    const result = await draftIdeas({ db: ctx.db, models: ctx.models, userId: ctx.userId, log: ctx.log }, { ...input, importJobId }, { signal });
    return { ideas: result.ideas, costMinor: result.costMinor, costLabel: result.costLabel, mode: result.mode };
  }),

  /**
   * The Studio's draft, streamed (tRPC async generator over `httpBatchStreamLink`): who is drafting, each concept's name
   * as the slate arrives, then each card the moment it is saved, then `done`. Stopping the stream (the founder's Stop,
   * or a closed tab) aborts the model calls; cards already saved stay in the deck.
   */
  draft: protectedProcedure.input(GenerateInput).mutation(async function* ({ ctx, input, signal }): AsyncGenerator<DraftEvent, void, undefined> {
    try {
      const importJobId = importJobOf(ctx, ctx.userId, input);
      yield* draftEventStream((emit, abort) => draftIdeas({ db: ctx.db, models: ctx.models, userId: ctx.userId, log: ctx.log }, { ...input, importJobId }, { signal: abort, emit }), signal);
    } catch (err) {
      // Errors thrown mid-stream skip the error-mapping middleware: map them the same way here.
      const mapped = toTRPCError(err);
      if (mapped.code !== "INTERNAL_SERVER_ERROR") throw mapped;
      ctx.log.error({ path: "idea.draft", err: mapped.cause ?? mapped, requestId: ctx.requestId }, "procedure failed");
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: internalErrorMessage(mapped.message, ctx.env.APP_ENV, ctx.requestId), cause: mapped.cause });
    }
  }),

  /** Compare 2–4 cards: side-by-side attributes + agent verdict (AC-11.1.4). */
  compare: protectedProcedure.input(z.object({ ideaIds: z.array(Id).min(2).max(4) })).mutation(async ({ ctx, input }) => {
    const ideas = await Promise.all(input.ideaIds.map((id) => repos.ideas.get(ctx.db, ctx.userId, id)));
    const result = await ctx.models.complete({
      route: "ideation",
      schema: Verdict,
      system: `Compare the concept cards attribute by attribute and give an agent verdict with a ranking. ${HOUSE_STYLE}`,
      messages: [{ role: "user", content: "```json\n" + JSON.stringify({ concepts: ideas.map((i) => ({ id: i.id, title: i.title, pitch: i.pitch, attributes: i.current?.attributes ?? {} })) }) + "\n```" }],
      attribution: { kind: "ideation_compare" },
    });
    const versionIds = ideas.map((i) => i.current?.id).filter((v): v is string => Boolean(v));
    const comparison = await repos.ideas.compare(ctx.db, ctx.userId, { ideaVersionIds: versionIds, verdictMd: result.json.verdict_md });
    // A ranking that does not name the compared ideas (the mock model synthesises one from the schema) is replaced by the cards' own stars, so the Compare screen always has a leader to commit.
    const ranking = result.json.ranking.every((r) => ideas.some((i) => i.id === r.idea_id))
      ? result.json.ranking
      : [...ideas].sort((a, b) => num(b.current?.starsPotential) - num(a.current?.starsPotential) || num(b.current?.starsCurrent) - num(a.current?.starsCurrent)).map((i, n) => ({ idea_id: i.id, rank: n + 1, reason: attributeReason(i, ideas.filter((o) => o.id !== i.id)) }));
    return { comparison, ideas, verdict: { ...result.json, ranking } };
  }),

  /** Merge 2–4 cards into a new idea; the sources get a `merged` version pointing at it. */
  merge: protectedProcedure.input(z.object({ ideaIds: z.array(Id).min(2).max(4), title: z.string().min(1).max(120).optional() })).mutation(async ({ ctx, input }) => {
    const sources = await Promise.all(input.ideaIds.map((id) => repos.ideas.get(ctx.db, ctx.userId, id)));
    const title = input.title ?? sources.map((s) => s.title).join(" × ").slice(0, 120);
    const merged = await repos.ideas.create(ctx.db, ctx.userId, {
      title,
      pitch: sources.map((s) => s.pitch).filter(Boolean).join("\n\n"),
      archetype: sources[0]?.archetype ?? null,
      attributes: mergeAttributes(sources),
      starsCurrent: Math.max(...sources.map((s) => num(s.current?.starsCurrent))),
      starsPotential: Math.max(...sources.map((s) => num(s.current?.starsPotential))),
      research: withMeta({ citations: sources.flatMap((s) => ((s.current?.research as Research | undefined)?.citations ?? []).filter((c) => !isMeta(c))) }, { merged_from: sources.map((s) => s.id) }),
      action: "merged",
    });
    for (const s of sources) await repos.ideas.addVersion(ctx.db, ctx.userId, s.id, { action: "merged", research: withMeta(s.current?.research, { merged_into: merged.id }), parentVersionId: s.current?.id ?? null });
    return merged;
  }),

  /** Fork: a new idea seeded from one card with edits; the source gets a `forked` version. */
  fork: protectedProcedure.input(z.object({ ideaId: Id, title: z.string().min(1).max(120).optional(), pitch: z.string().max(4000).optional() })).mutation(async ({ ctx, input }) => {
    const source = await repos.ideas.get(ctx.db, ctx.userId, input.ideaId);
    const fork = await repos.ideas.create(ctx.db, ctx.userId, {
      title: input.title ?? `${source.title} (fork)`.slice(0, 120),
      pitch: input.pitch ?? source.pitch,
      archetype: source.archetype,
      attributes: (source.current?.attributes as AttrMap | undefined) ?? {},
      starsCurrent: num(source.current?.starsCurrent),
      starsPotential: num(source.current?.starsPotential),
      research: withMeta(source.current?.research, { forked_from: source.id }),
      action: "forked",
    });
    await repos.ideas.addVersion(ctx.db, ctx.userId, source.id, { action: "forked", research: withMeta(source.current?.research, { forked_to: fork.id }), parentVersionId: source.current?.id ?? null });
    return fork;
  }),

  /**
   * The Ask sheet before the first question (no model call): the Research agent who answers and the starters, so the
   * founder can ask with one press.
   */
  askDesk: protectedProcedure.input(z.object({ ideaId: Id })).query(async ({ ctx, input }) => {
    const idea = await repos.ideas.get(ctx.db, ctx.userId, input.ideaId);
    return { persona: conceptPersona(idea.current?.title ?? idea.title), starters: conceptStarters() };
  }),

  /**
   * Ask the Research agent about a card (audit-conversation §4 "Ask on a concept"): a typed question or one of its quick
   * replies → `replyAboutConcept` (the conversation route, house rules first; the card's own text travels only as
   * untrusted data). The answer becomes a new version (its Q&A in `meta.qa`); `answer` keeps the single-answer shape,
   * `bubbles` / `quickReplies` / `persona` / `reaction` are the conversation.
   */
  ask: protectedProcedure
    .input(
      z
        .object({ ideaId: Id, question: z.string().trim().min(1).max(2000).optional(), quickReplyId: z.string().regex(/^[a-z0-9_-]{1,24}$/).optional() })
        .refine((v) => (v.question ? 1 : 0) + (v.quickReplyId ? 1 : 0) === 1, { message: "Ask a question or pick a quick reply", path: ["question"] }),
    )
    .mutation(async ({ ctx, input }) => {
      const idea = await repos.ideas.get(ctx.db, ctx.userId, input.ideaId);
      const before = (idea.current?.attributes as AttrMap | undefined) ?? {};
      const meta = readMeta(idea.current?.research);
      const qa = Array.isArray(meta.qa) ? (meta.qa as unknown[]) : [];
      const history = qa.flatMap((q) => (q && typeof q === "object" && typeof (q as { question?: unknown }).question === "string" && typeof (q as { answer?: unknown }).answer === "string" ? [{ question: (q as { question: string }).question, answer: (q as { answer: string }).answer }] : [])).slice(-6);
      const reply = await replyAboutConcept(ctx.models, {
        concept: { id: idea.id, title: idea.current?.title ?? idea.title, pitch: idea.current?.pitch ?? idea.pitch, attributes: before },
        question: input.question,
        quickReplyId: input.quickReplyId,
        history,
        userId: ctx.userId,
      });
      const question = input.question ?? conceptStarters().find((q) => q.id === input.quickReplyId)?.say ?? "";
      // The conversation route answers from the card; it never moves a rating, so the attributes carry over unchanged.
      const version = await repos.ideas.addVersion(ctx.db, ctx.userId, idea.id, {
        action: "edited",
        attributes: before,
        research: withMeta(idea.current?.research, { qa: [...qa, { question, answer: reply.answerMd, bubbles: reply.bubbles, quick_replies: reply.quickReplies, quick_reply_id: input.quickReplyId ?? null, reaction: reply.reaction }] }),
        parentVersionId: idea.current?.id ?? null,
      });
      return { version, answer: reply.answerMd, question, bubbles: reply.bubbles, quickReplies: reply.quickReplies, reaction: reply.reaction, persona: reply.persona };
    }),

  /** Discard (reversible: archived, not deleted). */
  discard: protectedProcedure.input(z.object({ ideaId: Id })).mutation(({ ctx, input }) => repos.ideas.discard(ctx.db, ctx.userId, input.ideaId)),

  /** What "Take charge" will seed for an archetype (Commit screen preview). */
  preview: protectedProcedure.input(z.object({ archetype: Archetype })).query(({ input }) => squadPreview(input.archetype)),

  /** Take charge (AC-11.1.6, AC-11.1.7: default business mode is Assisted). */
  commit: protectedProcedure
    .input(
      z.object({
        ideaId: Id,
        name: z.string().trim().min(1).max(120),
        gameMode: z.enum(GAME_MODES).default("personal"),
        archetype: z.enum(ARCHETYPES),
        businessMode: z.enum(BUSINESS_MODES).default("assisted"),
        kit: z.object({ primary: Hex, secondary: Hex }).optional(),
        /** The chosen logo (uploaded or generated); checked before anything is created. Null or absent: the initials mark. */
        logo: LogoChoice.nullable().optional(),
        currency: z.string().length(3).default("EUR"),
        spendCapMinor: z.number().int().nonnegative().nullable().default(null),
        /** The founder's 18+ confirmation, asked when they take charge of a LIVE business (the network is for adults). */
        confirmAdult: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await repos.founders.get(ctx.db, ctx.userId);
      if (!profile) throw new ValidationError("Complete your founder profile before taking charge of a business");
      // A LIVE business is on the network from its first minute, so taking charge of one asks what Go live asks.
      if (input.gameMode === "live") await requireAdultToGoLive(ctx.db, ctx.userId, input.confirmAdult);
      // A logo is an upload check like any other (the SVG check is CPU work).
      if (input.logo) takeLogoCheck(ctx.userId);
      return commitIdea(ctx.db, ctx.temporal, ctx.userId, input, () => importJobKey(ctx.env));
    }),
});
