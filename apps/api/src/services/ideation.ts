/**
 * Drafting concepts for the Ideation Studio (BUILD §11.1 Door A; AC-11.1.2; audit P2 "stream cards, then fan out").
 *
 * A set is drafted in two overlapping steps instead of one long call that shows nothing until all twelve cards exist:
 *   1. The slate (route `ideationSlate`, low effort): 6–12 names, archetypes and one-line angles, streamed item by item.
 *   2. One card per slate item (route `ideation`), started the moment its slate item arrives, at most
 *      `IDEATION_CARD_CONCURRENCY` at a time. Every call shares the same cached system prefix (house rules, the Ideation
 *      agent's instructions, the founder profile; packages/agents `ideationSystem`), so the cards read what the slate wrote.
 * Each card is written to the database the moment it is ready and reported through `emit` (the Studio's stream); cards
 * that finish while a write is in flight are written together in the next batch (`repos.ideas.createMany`: three
 * statements per batch instead of three per card). A card that fails is retried on its own once; the rest of the set is
 * unaffected. The finished set must still hold 6–12 concepts (AC-11.1.2): fewer is reported as an error, and the cards
 * already drafted stay in the founder's deck.
 *
 * Import's single card (`single`) is one card call on the same prefix.
 */
import { recordFirstIdeas } from "./funnel-facts";
import { buildFounderCardRequest, buildIdeationCardRequest, buildIdeationSlateRequest, buildSingleConceptRequest, FULL_SKILLS_BASIS, IDEATION_AGENT_NAME, IDEATION_MAX_CONCEPTS, IDEATION_MIN_CONCEPTS, QUICK_SKILLS_BASIS, type IdeationBrief } from "@foundmill/agents";
import { fitBasisOf } from "@foundmill/config";
import { repos, type CreateIdeaInput, type IdeaWithVersion } from "@foundmill/db";
import { isModelBillingError, ModelAbortedError, ModelOutputError, streamStructured, type ConceptCard, type IdeationSlateItem, type ModelClient, type ModelMode } from "@foundmill/models";
import { AppError, type Archetype } from "@foundmill/shared";
import { takeOrThrow, type LimitEntry, type LimitTicket, type RateLimitStore, type WindowLimit } from "./rate-limit";

/** Cards written at once (the rest wait for a free slot). Six keeps a twelve-card set to two waves without a burst of twelve. */
export const IDEATION_CARD_CONCURRENCY = 6;
/** Attempts per card: the first, and one retry of that card alone. */
export const IDEATION_CARD_ATTEMPTS = 2;
export const SURPRISE_PROMPT = "surprise me within my constraints";

export const IDEATION_TOO_LONG_MESSAGE = "The Ideation agent ran out of room before finishing the concepts. Try again, or narrow the brief.";

type Db = Parameters<typeof repos.ideas.createMany>[0];

// ---------------------------------------------------------------------------------------------------------------------
// Allowance: a set is a slate plus up to twelve card calls (each retried once) on the platform key, and Ideation needs
// no business, so any signed-in account could otherwise draft in a loop. Every draft (a set, Import's single card, a
// card drafted ahead for Import) and every Compare spends one. The windows live in the api's limit store (Redis across
// replicas, rate-limit.ts), like the logo and conversation allowances.
// ---------------------------------------------------------------------------------------------------------------------

const HOUR = 60 * 60_000;
export const IDEATION_LIMITS = {
  /** A founder drafting, reading and drafting again stays well inside this; a script or a stuck button does not. */
  hour: { limit: 20, windowMs: HOUR },
  day: { limit: 60, windowMs: 24 * HOUR },
} as const satisfies Record<string, WindowLimit>;

/** The windows one draft spends for `userId`. */
export const ideationAllowanceEntries = (userId: string): LimitEntry[] => [
  { key: `ideation:hour:${userId}`, rule: IDEATION_LIMITS.hour },
  { key: `ideation:day:${userId}`, rule: IDEATION_LIMITS.day },
];

/** Spends one draft from the founder's allowance, or throws TOO_MANY_REQUESTS (nothing is drafted). */
export function takeIdeationAllowance(limits: RateLimitStore, userId: string): Promise<LimitTicket> {
  return takeOrThrow(limits, "Drafting", ideationAllowanceEntries(userId));
}

// ---------------------------------------------------------------------------------------------------------------------
// Version metadata (moved here from routers/idea.ts, which re-exports it)
// ---------------------------------------------------------------------------------------------------------------------

type Research = { citations: unknown[] };
/**
 * `idea_versions.research` is `{ citations: unknown[] }` (packages/db strips other keys), so version metadata
 * (logo seed, merge/fork lineage, Q&A) travels as one tagged citation entry.
 */
export const META_KIND = "foundmill:meta";
export const isMeta = (c: unknown): c is Record<string, unknown> => Boolean(c) && typeof c === "object" && (c as { kind?: unknown }).kind === META_KIND;
export function readMeta(research: unknown): Record<string, unknown> {
  const citations = (research as Research | undefined)?.citations ?? [];
  const found = citations.find(isMeta);
  return found ? { ...found } : {};
}
export function withMeta(research: unknown, meta: Record<string, unknown>): Research {
  const citations = ((research as Research | undefined)?.citations ?? []).filter((c) => !isMeta(c));
  return { citations: [...citations, { ...readMeta(research), ...meta, kind: META_KIND }] };
}

/** A drafted card as the idea row and first version the Studio stores (clipped to the row's limits, so one long card never fails a batch). */
export function ideaFromCard(card: ConceptCard, meta: Record<string, unknown> = {}, action: CreateIdeaInput["action"] = "generated"): CreateIdeaInput {
  return {
    title: card.name.slice(0, 120),
    pitch: card.pitch.slice(0, 4000),
    archetype: card.archetype,
    attributes: Object.fromEntries(card.attributes.map((a) => [a.key, { value: a.value, evidence: a.evidence }])),
    starsCurrent: card.stars_current,
    starsPotential: card.stars_potential,
    research: withMeta({ citations: card.citations }, { crest_seed: card.crest_seed, ...meta }),
    action,
  };
}

/**
 * What every card the studio saves remembers about where it came from (first-time founder report, Nov 8, 2026):
 * `brief`, the founder's own words when the card was drafted (the foundations build on them first), and `sample` when
 * the mock model wrote the card, so every screen that shows it can say so instead of passing sample prose off as the
 * team's judgment.
 */
export function cardProvenance(models: Pick<ModelClient, "mode">, brief: string | null | undefined): Record<string, unknown> {
  const words = brief?.trim();
  return { ...(words && words !== SURPRISE_PROMPT ? { brief: words.slice(0, 4000) } : {}), ...(models.mode === "mock" ? { sample: true } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Events (the Studio's stream; also what tests read)
// ---------------------------------------------------------------------------------------------------------------------

export type DraftEvent =
  /** The draft began; `agent` is who the Studio says is drafting. */
  | { type: "started"; agent: string; single: boolean; mode: ModelMode }
  /** A slate item arrived: the concept at `index` has a name before its card exists. */
  | { type: "outline"; index: number; name: string; archetype: Archetype }
  /** The slate is complete: the set will hold `total` concepts. */
  | { type: "outlined"; total: number }
  /** A card call started (attempt 2 is the retry). */
  | { type: "writing"; index: number; attempt: number }
  /** A card is drafted and saved: the idea row, ready to show. */
  | { type: "idea"; index: number; idea: IdeaWithVersion }
  /** A card failed every attempt; the rest of the set carries on. */
  | { type: "card_failed"; index: number; name: string; message: string }
  /** The set is finished (6–12 saved). */
  | { type: "done"; ideas: IdeaWithVersion[]; total: number; failed: number; costMinor: number; costLabel: "Estimate"; mode: ModelMode; elapsedMs: number };

export interface DraftInput {
  prompt: string;
  archetypeHint?: Archetype;
  single: boolean;
  /** Import's job (already verified by the caller), recorded on the idea so commit links the business to it. */
  importJobId: string | null;
}

export interface DraftDeps {
  db: Db;
  models: ModelClient;
  /** The api's allowance windows (`ctx.limits`): every draft spends one (`takeIdeationAllowance`). */
  limits: RateLimitStore;
  userId: string;
  log?: { warn(obj: unknown, msg?: string): void };
}

export interface DraftOptions {
  signal?: AbortSignal;
  emit?: (event: DraftEvent) => void;
  concurrency?: number;
  cardAttempts?: number;
  now?: () => number;
}

export interface DraftResult {
  /** Saved ideas in slate order. */
  ideas: IdeaWithVersion[];
  costMinor: number;
  costLabel: "Estimate";
  mode: ModelMode;
  failed: number;
}

/**
 * The founder profile as the Ideation agent reads it (null when they skipped it). `skills_basis` says what the skill
 * ratings rest on (WP-14 T2): the first profile's quick answers, or the ratings the person set in the long profile.
 */
export async function founderBrief(db: Parameters<typeof repos.founders.get>[0], userId: string): Promise<Record<string, unknown> | null> {
  const profile = await repos.founders.get(db, userId);
  return profile
    ? { experience: profile.experience, skills: profile.skills, skills_basis: fitBasisOf(profile) === "quick" ? QUICK_SKILLS_BASIS : FULL_SKILLS_BASIS, time_commitment: profile.timeCommitment, budget_minor: profile.budgetMinor, citizenship: profile.citizenship, residence: profile.residence, target_markets: profile.targetMarkets, constraints: profile.constraints, risk_appetite: profile.riskAppetite }
    : null;
}

/** Bounded concurrency; a freed slot passes straight to the next waiter, so the bound holds exactly. */
export function concurrencyLimit(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = () => (active < max ? (active++, Promise.resolve()) : new Promise<void>((r) => waiting.push(r)));
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return async (fn) => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/**
 * Writes ideas as they come: the first is written at once, and everything that arrives while a write is in flight goes
 * into the next one (one `createMany` per batch).
 */
export class IdeaBatchWriter {
  private pending: { input: CreateIdeaInput; resolve: (idea: IdeaWithVersion) => void; reject: (err: unknown) => void }[] = [];
  private flushing = false;
  /** Number of `createMany` calls made (tests). */
  batches = 0;

  constructor(
    private readonly db: Db,
    private readonly userId: string,
  ) {}

  write(input: CreateIdeaInput): Promise<IdeaWithVersion> {
    return new Promise((resolve, reject) => {
      this.pending.push({ input, resolve, reject });
      this.flush();
    });
  }

  private flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    void (async () => {
      try {
        while (this.pending.length > 0) {
          const batch = this.pending.splice(0);
          this.batches++;
          try {
            const rows = await repos.ideas.createMany(this.db, this.userId, batch.map((b) => b.input));
            batch.forEach((b, i) => b.resolve(rows[i]!));
          } catch (err) {
            for (const b of batch) b.reject(err);
          }
        }
      } finally {
        this.flushing = false;
      }
    })();
  }
}

const isAbort = (err: unknown, signal?: AbortSignal) => err instanceof ModelAbortedError || (signal?.aborted ?? false);

/** Drafts and saves a set (or Import's single card), reporting progress through `opts.emit`. */
export async function draftIdeas(deps: DraftDeps, input: DraftInput, opts: DraftOptions = {}): Promise<DraftResult> {
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const emit = opts.emit ?? (() => undefined);
  const signal = opts.signal;
  const { models } = deps;
  // Before anything else: a refused draft calls no model and writes nothing.
  await takeIdeationAllowance(deps.limits, deps.userId);
  const brief: IdeationBrief = { prompt: input.prompt.trim() || SURPRISE_PROMPT, archetypeHint: input.archetypeHint ?? null, founder: await founderBrief(deps.db, deps.userId) };
  // Import's card describes the report, not a brief the founder typed: it keeps the job id and no brief.
  const meta = input.importJobId ? { import_job_id: input.importJobId, ...cardProvenance(models, null) } : cardProvenance(models, input.prompt);
  const writer = new IdeaBatchWriter(deps.db, deps.userId);
  const scope = `ideation:${deps.userId}`;
  let costMicro = 0;
  emit({ type: "started", agent: IDEATION_AGENT_NAME, single: input.single, mode: models.mode });

  const finish = (ideas: IdeaWithVersion[], total: number, failed: number): DraftResult => {
    const costMinor = Math.round(costMicro / 1_000_000);
    emit({ type: "done", ideas, total, failed, costMinor, costLabel: "Estimate", mode: models.mode, elapsedMs: now() - started });
    return { ideas, costMinor, costLabel: "Estimate", mode: models.mode, failed };
  };

  if (input.single) {
    emit({ type: "writing", index: 0, attempt: 1 });
    const res = await models.complete({ ...buildSingleConceptRequest(brief), signal, scope, attribution: { kind: "ideation", userId: deps.userId } }).catch((err: unknown) => {
      throw tooLong(err) ?? err;
    });
    costMicro += res.cost.costMicroMinor;
    const idea = await writer.write(ideaFromCard(res.json, meta));
    emit({ type: "idea", index: 0, idea });
    return finish([idea], 1, 0);
  }

  // Cards run under their own controller so a failed slate can stop the ones already started.
  const cardsAbort = new AbortController();
  const onAbort = () => cardsAbort.abort();
  if (signal?.aborted) cardsAbort.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const limit = concurrencyLimit(opts.concurrency ?? IDEATION_CARD_CONCURRENCY);
  const attempts = Math.max(1, opts.cardAttempts ?? IDEATION_CARD_ATTEMPTS);
  const slate: IdeationSlateItem[] = [];
  const saved = new Map<number, IdeaWithVersion>();
  const failures: number[] = [];
  const cards: Promise<void>[] = [];

  const runCard = async (index: number, item: IdeationSlateItem): Promise<void> => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let card: ConceptCard;
      try {
        card = await limit(async () => {
          if (cardsAbort.signal.aborted) throw new ModelAbortedError();
          emit({ type: "writing", index, attempt });
          const res = await models.complete({ ...buildIdeationCardRequest(brief, item), signal: cardsAbort.signal, scope, attribution: { kind: "ideation", userId: deps.userId } });
          costMicro += res.cost.costMicroMinor;
          return res.json;
        });
      } catch (err) {
        if (isAbort(err, cardsAbort.signal)) throw err;
        // The model account cannot pay: every other card would be refused too, and "could not finish this concept" would
        // hide why. Final at once; the draft fails with the founder-facing billing message (audit BILL-06).
        if (isModelBillingError(err)) throw err;
        const message = err instanceof Error ? err.message : String(err);
        deps.log?.warn({ index, attempt, err: message }, "ideation card failed");
        if (attempt < attempts) continue;
        failures.push(index);
        emit({ type: "card_failed", index, name: item.name, message: "The Ideation agent could not finish this concept." });
        return;
      }
      // A database error is not the model's: no retry, it fails the draft.
      const idea = await writer.write(ideaFromCard(card, meta));
      saved.set(index, idea);
      emit({ type: "idea", index, idea });
      return;
    }
  };

  /** A slate item arrived: name it on screen and start its card. Items past the twelfth are never drafted (AC-11.1.2). */
  const outline = (index: number, item: IdeationSlateItem) => {
    if (slate[index] || index >= IDEATION_MAX_CONCEPTS) return;
    slate[index] = item;
    emit({ type: "outline", index, name: item.name, archetype: item.archetype });
    const task = runCard(index, item);
    // Settled below; a rejection here is never unhandled.
    task.catch(() => undefined);
    cards[index] = task;
  };

  try {
    const slateRequest = buildIdeationSlateRequest(brief);
    try {
      const result = await streamStructured(models, {
        ...slateRequest,
        signal,
        scope,
        attribution: { kind: "ideation_slate", userId: deps.userId },
        onElement: ({ index, value }) => outline(index, value),
      });
      costMicro += result.cost.costMicroMinor;
      // Items the stream did not deliver one by one (a client without streaming hands over the whole slate at the end).
      result.elements.forEach((item, index) => outline(index, item));
    } catch (err) {
      if (isAbort(err, signal)) throw err;
      const delivered = slate.filter(Boolean).length;
      // A refusal ends the draft: the cards already started are stopped (below), never written from a refused brief.
      if (err instanceof ModelOutputError && err.code === "refusal") throw err;
      // Enough concepts arrived before the slate broke off: write those rather than throw the set away.
      if (delivered < IDEATION_MIN_CONCEPTS) throw tooLong(err) ?? err;
      deps.log?.warn({ delivered, err: err instanceof Error ? err.message : String(err) }, "ideation slate ended early; drafting the concepts it delivered");
    }
    const total = slate.filter(Boolean).length;
    emit({ type: "outlined", total });

    const settled = await Promise.allSettled(cards.filter(Boolean));
    const rejected = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    if (rejected) throw rejected.reason;

    const ideas = [...saved.entries()].sort(([a], [b]) => a - b).map(([, idea]) => idea);
    if (ideas.length >= IDEATION_MIN_CONCEPTS) await recordFirstIdeas(deps, deps.userId, "set", ideas.length);
    if (ideas.length < IDEATION_MIN_CONCEPTS) {
      throw new AppError("ideation_incomplete", `The Ideation agent finished ${ideas.length} of ${total} concepts, fewer than a set needs. The finished ones are in your deck; draft again for more.`, 502, { drafted: ideas.length, total, failed: failures.length });
    }
    return finish(ideas, total, failures.length);
  } catch (err) {
    // Stop every card still running (the slate failed, a write failed, or the founder pressed Stop).
    cardsAbort.abort();
    await Promise.allSettled(cards.filter(Boolean));
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export interface WriteIdeaInput {
  /** The working name (renamed at Commit). */
  title: string;
  /** The founder's own description of the business, verbatim: it becomes the card's pitch, whatever the model answers. */
  pitch: string;
  /** The kind of business when the founder chose one; null lets the Ideation agent choose. */
  archetype: Archetype | null;
}

export interface WriteIdeaResult {
  idea: IdeaWithVersion;
  costMinor: number;
  costLabel: "Estimate";
  mode: ModelMode;
}

/**
 * "Use my idea as written" (first-time founder report, Nov 8, 2026: a founder with a clear idea had to pick the
 * nearest of ten drafted cards, and the team then built that card). One card from the founder's own words: the Ideation
 * agent rates it and finds its citations (one card call, one draft of the allowance); the saved card keeps the
 * founder's name and words exactly, flagged `founder_words` so the foundations build on them first.
 */
export async function writeIdea(deps: DraftDeps, input: WriteIdeaInput, opts: { signal?: AbortSignal } = {}): Promise<WriteIdeaResult> {
  const { models } = deps;
  await takeIdeationAllowance(deps.limits, deps.userId);
  const words = input.pitch.trim().slice(0, 4000);
  const title = input.title.trim().slice(0, 60);
  const brief: IdeationBrief = { prompt: words, archetypeHint: input.archetype, founder: await founderBrief(deps.db, deps.userId) };
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-idea";
  const res = await models.complete({ ...buildFounderCardRequest(brief, { id, name: title, archetype: input.archetype, words }), signal: opts.signal, scope: `ideation:${deps.userId}`, attribution: { kind: "ideation", userId: deps.userId } }).catch((err: unknown) => {
    throw tooLong(err) ?? err;
  });
  const card: ConceptCard = { ...res.json, name: title, pitch: words, archetype: input.archetype ?? res.json.archetype };
  const idea = await repos.ideas.create(deps.db, deps.userId, ideaFromCard(card, { founder_words: words, ...cardProvenance(models, words) }, "edited"));
  await recordFirstIdeas(deps, deps.userId, "written", 1);
  return { idea, costMinor: Math.round(res.cost.costMicroMinor / 1_000_000), costLabel: "Estimate", mode: models.mode };
}

/** The Ideation agent ran out of output room before any usable result: say so plainly (502), not as a model error. */
function tooLong(err: unknown): AppError | undefined {
  return err instanceof ModelOutputError && err.code === "max_tokens" ? new AppError("ideation_too_long", IDEATION_TOO_LONG_MESSAGE, 502) : undefined;
}

/**
 * Turns a draft into an async iterable of its events (the Studio's tRPC stream). Stopping the iteration (the founder
 * pressed Stop, or the browser went away) aborts the draft; the error of a failed draft is thrown after its events.
 */
export async function* draftEventStream(run: (emit: (event: DraftEvent) => void, signal: AbortSignal) => Promise<unknown>, parent?: AbortSignal): AsyncGenerator<DraftEvent, void, undefined> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  const queue: DraftEvent[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: { error: unknown } | null = null;
  const emit = (event: DraftEvent) => {
    queue.push(event);
    wake?.();
  };
  const running = run(emit, controller.signal).then(
    () => undefined,
    (error: unknown) => {
      failure = { error };
    },
  );
  void running.finally(() => {
    finished = true;
    wake?.();
  });
  try {
    for (;;) {
      while (queue.length > 0) yield queue.shift()!;
      if (finished) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
    const failed = failure as { error: unknown } | null;
    if (failed && !controller.signal.aborted) throw failed.error;
  } finally {
    // Left early (Stop or a closed connection): stop the model calls; cards already saved stay in the deck.
    controller.abort();
    parent?.removeEventListener("abort", onAbort);
  }
}
