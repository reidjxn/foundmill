/**
 * idea.generate/compare/merge/fork/ask/discard/commit — the Ideation Studio (BUILD §11.1 Door A).
 * Ideation is account-scoped and private (no business yet); every action creates an `idea_version` (AC-11.1.3).
 */
import { repos, type IdeaWithVersion } from "@foundmill/db";
import { IdeationOutput, type ConceptCard } from "@foundmill/models";
import { ARCHETYPES, Archetype, BUSINESS_MODES, GAME_MODES, ValidationError } from "@foundmill/shared";
import { z } from "zod";
import { commitIdea, squadPreview } from "../services/commit";
import { Id, protectedProcedure, router } from "../trpc";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const Verdict = z.object({ verdict_md: z.string().min(1), ranking: z.array(z.object({ idea_id: z.string(), rank: z.number().int().min(1), reason: z.string() })).min(1) });
const Answer = z.object({ answer_md: z.string().min(1), attribute_adjustments: z.array(z.object({ key: z.string(), value: z.number().int().min(1).max(20), evidence: z.string() })).default([]) });

type AttrMap = Record<string, { value: number; evidence?: string }>;
type Research = { citations: unknown[] };

/**
 * `idea_versions.research` is `{ citations: unknown[] }` (packages/db strips other keys), so version metadata
 * (crest seed, merge/fork lineage, Q&A) travels as one tagged citation entry.
 */
const META_KIND = "foundmill:meta";
const isMeta = (c: unknown): c is Record<string, unknown> => Boolean(c) && typeof c === "object" && (c as { kind?: unknown }).kind === META_KIND;
export function readMeta(research: unknown): Record<string, unknown> {
  const citations = (research as Research | undefined)?.citations ?? [];
  const found = citations.find(isMeta);
  return found ? { ...found } : {};
}
export function withMeta(research: unknown, meta: Record<string, unknown>): Research {
  const citations = ((research as Research | undefined)?.citations ?? []).filter((c) => !isMeta(c));
  return { citations: [...citations, { ...readMeta(research), ...meta, kind: META_KIND }] };
}
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);

function attributesOf(card: ConceptCard): AttrMap {
  return Object.fromEntries(card.attributes.map((a) => [a.key, { value: a.value, evidence: a.evidence }]));
}

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

async function founderBrief(ctx: { db: Parameters<typeof repos.founders.get>[0]; userId: string }) {
  const profile = await repos.founders.get(ctx.db, ctx.userId);
  return profile
    ? { experience: profile.experience, skills: profile.skills, time_commitment: profile.timeCommitment, budget_minor: profile.budgetMinor, citizenship: profile.citizenship, residence: profile.residence, target_markets: profile.targetMarkets, constraints: profile.constraints, risk_appetite: profile.riskAppetite }
    : null;
}

export const ideaRouter = router({
  list: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(50), cursor: z.string().nullish() }).optional()).query(({ ctx, input }) => repos.ideas.listForUser(ctx.db, ctx.userId, input ?? {})),

  get: protectedProcedure.input(z.object({ ideaId: Id })).query(async ({ ctx, input }) => {
    const idea = await repos.ideas.get(ctx.db, ctx.userId, input.ideaId);
    const versions = await repos.ideas.versions(ctx.db, ctx.userId, input.ideaId);
    return { idea, versions };
  }),

  /** Prompt (or empty = "surprise me within my constraints") → 6–12 concept cards (AC-11.1.2). */
  generate: protectedProcedure.input(z.object({ prompt: z.string().max(4000).default(""), archetypeHint: Archetype.optional() })).mutation(async ({ ctx, input }) => {
    const founder = await founderBrief(ctx);
    const result = await ctx.models.complete({
      route: "ideation",
      schema: IdeationOutput,
      system: "You are the Ideation agent. Draft 6-12 concept cards with 10 attributes (1-20) with evidence and at least 2 citations each, grounded in the founder's constraints.",
      messages: [{ role: "user", content: "```json\n" + JSON.stringify({ prompt: input.prompt || "surprise me within my constraints", archetype_hint: input.archetypeHint ?? null, founder }) + "\n```" }],
      attribution: { kind: "ideation" },
    });
    const ideas: IdeaWithVersion[] = [];
    for (const card of result.json.concepts) {
      ideas.push(
        await repos.ideas.create(ctx.db, ctx.userId, {
          title: card.name,
          pitch: card.pitch,
          archetype: card.archetype,
          attributes: attributesOf(card),
          starsCurrent: card.stars_current,
          starsPotential: card.stars_potential,
          research: withMeta({ citations: card.citations }, { crest_seed: card.crest_seed }),
          action: "generated",
        }),
      );
    }
    return { ideas, costMinor: result.cost.costMinorInt, costLabel: "Estimate" as const, mode: result.mode };
  }),

  /** Compare 2–4 cards: side-by-side attributes + agent verdict (AC-11.1.4). */
  compare: protectedProcedure.input(z.object({ ideaIds: z.array(Id).min(2).max(4) })).mutation(async ({ ctx, input }) => {
    const ideas = await Promise.all(input.ideaIds.map((id) => repos.ideas.get(ctx.db, ctx.userId, id)));
    const result = await ctx.models.complete({
      route: "ideation",
      schema: Verdict,
      system: "Compare the concept cards attribute by attribute and give an agent verdict with a ranking.",
      messages: [{ role: "user", content: "```json\n" + JSON.stringify({ concepts: ideas.map((i) => ({ id: i.id, title: i.title, pitch: i.pitch, attributes: i.current?.attributes ?? {} })) }) + "\n```" }],
      attribution: { kind: "ideation_compare" },
    });
    const versionIds = ideas.map((i) => i.current?.id).filter((v): v is string => Boolean(v));
    const comparison = await repos.ideas.compare(ctx.db, ctx.userId, { ideaVersionIds: versionIds, verdictMd: result.json.verdict_md });
    return { comparison, ideas, verdict: result.json };
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

  /** Ask a question about a card; the answer (and any attribute evidence) becomes a new version. */
  ask: protectedProcedure.input(z.object({ ideaId: Id, question: z.string().min(1).max(2000) })).mutation(async ({ ctx, input }) => {
    const idea = await repos.ideas.get(ctx.db, ctx.userId, input.ideaId);
    const result = await ctx.models.complete({
      route: "ideation",
      schema: Answer,
      system: "Answer the founder's question about this concept card from the research; adjust attributes only with evidence.",
      messages: [{ role: "user", content: "```json\n" + JSON.stringify({ concept: { id: idea.id, title: idea.title, pitch: idea.pitch, attributes: idea.current?.attributes ?? {}, research: idea.current?.research ?? {} }, question: input.question }) + "\n```" }],
      attribution: { kind: "ideation_ask" },
    });
    const attributes = { ...((idea.current?.attributes as AttrMap | undefined) ?? {}) };
    for (const adj of result.json.attribute_adjustments) if (attributes[adj.key]) attributes[adj.key] = { value: adj.value, evidence: adj.evidence };
    const meta = readMeta(idea.current?.research);
    const qa = Array.isArray(meta.qa) ? meta.qa : [];
    const version = await repos.ideas.addVersion(ctx.db, ctx.userId, idea.id, { action: "edited", attributes, research: withMeta(idea.current?.research, { qa: [...qa, { question: input.question, answer: result.json.answer_md }] }), parentVersionId: idea.current?.id ?? null });
    return { version, answer: result.json.answer_md };
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
        currency: z.string().length(3).default("EUR"),
        spendCapMinor: z.number().int().nonnegative().nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await repos.founders.get(ctx.db, ctx.userId);
      if (!profile) throw new ValidationError("Complete your founder profile before taking charge of a business");
      return commitIdea(ctx.db, ctx.temporal, ctx.userId, input);
    }),
});
