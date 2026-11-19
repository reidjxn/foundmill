/**
 * Per-person and per-business allowances on every procedure that calls a model on the platform key (SEC-13): Ideation
 * and Ask, logos, conversations, Inbox Refresh, plan previews and free-text decisions, task planning, the legal and
 * distribution recommenders, foundations retries, training runs, Continue, starting a task (an agent session) and
 * Take charge (a new business drafts its foundations); and on the three that call a vendor per press, registry lookups,
 * domain checks and checkout sessions. Each procedure spends one hit from its own rule and one from
 * `SHARED_MODEL_LIMITS`, the ceiling across all of them, so a stuck key, a script or a member looping one button cannot
 * drain the platform's credits; a refusal is TOO_MANY_REQUESTS with a sentence the founder can act on (naming what they
 * pressed, whichever window is full), and nothing is called.
 *
 * The windows live in `ctx.limits` (Redis across replicas, memory in development and tests; rate-limit.ts). The
 * allowances that predate this one keep their own rules inside their services (drafting in ideation.ts, logo sets in
 * logo.ts, conversation sends in conversation.ts); their procedures still spend from the shared ceiling.
 */
import { FREE_CAP_SLOW_SCALE } from "@foundmill/db";
import { gateModelClient } from "@foundmill/models";
import { TRPCError } from "@trpc/server";
import type { Context } from "../context";
import { middleware, toTRPCError } from "../trpc";
import { noteModelCall, notesCalls, withModelCallScope } from "./model-calls";
import { requireEntryPlanForRun } from "./payments";
import { RateLimitedError, type LimitEntry, type WindowLimit } from "./rate-limit";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface ModelLimitRule {
  /** What the founder reads in "<what> limit reached. Try again in 2 minutes." */
  what: string;
  user?: readonly WindowLimit[];
  business?: readonly WindowLimit[];
}

/** Spent by every rule below: no person or business makes more model-backed requests than this, whatever they press. */
export const SHARED_MODEL_LIMITS = {
  user: [{ limit: 60, windowMs: MINUTE }, { limit: 600, windowMs: HOUR }, { limit: 3_000, windowMs: DAY }],
  business: [{ limit: 1_200, windowMs: HOUR }, { limit: 6_000, windowMs: DAY }],
} as const satisfies Partial<ModelLimitRule>;

export const MODEL_LIMITS = {
  /** idea.generate / draft / compare: the drafting allowance (services/ideation.ts) applies inside. */
  ideation: { what: "Drafting" },
  /** Logo sets: the logo allowance (services/logo.ts) applies inside. */
  logo: { what: "Logo generation" },
  /** Sends at an agent's desk and Ask on a concept: the conversation allowance (services/conversation.ts) applies inside. */
  conversation: { what: "Conversation" },
  /** Team call (docs/TEAM_CALL.md): the opening, each round of the turn director and the wrap-up are model calls. */
  teamCall: { what: "Team call", user: [{ limit: 30, windowMs: MINUTE }, { limit: 400, windowMs: HOUR }], business: [{ limit: 800, windowMs: HOUR }] },
  /** Team call speech: each agent turn spoken aloud and each recording transcribed (the gateway's daily ceiling applies too). */
  teamCallSpeech: { what: "Speech on calls", user: [{ limit: 90, windowMs: MINUTE }, { limit: 1_500, windowMs: HOUR }], business: [{ limit: 3_000, windowMs: HOUR }] },
  /** Inbox Refresh (R): one composer note per press (BILL-19); the composer's 3 s debounce is not an allowance. */
  refresh: { what: "Refresh", user: [{ limit: 10, windowMs: MINUTE }, { limit: 120, windowMs: HOUR }], business: [{ limit: 240, windowMs: HOUR }] },
  /** plan.preview and a free-text decision: one plan compile each. */
  plan: { what: "Planning", user: [{ limit: 10, windowMs: MINUTE }, { limit: 120, windowMs: HOUR }], business: [{ limit: 300, windowMs: HOUR }] },
  /** dev.tasks.plan: the Planner builds a task graph. */
  planner: { what: "Task planning", user: [{ limit: 20, windowMs: HOUR }], business: [{ limit: 60, windowMs: DAY }] },
  /** legal.recommend and distribution.recommend. */
  recommend: { what: "Recommendations", user: [{ limit: 10, windowMs: HOUR }], business: [{ limit: 20, windowMs: HOUR }, { limit: 60, windowMs: DAY }] },
  /** product.foundations.retry: the vision, specification and roadmap drafted again. */
  foundations: { what: "Drafting the foundations", business: [{ limit: 3, windowMs: HOUR }, { limit: 10, windowMs: DAY }] },
  /** product.research.retry: the Product Researcher's plan drafted again (one worker call). */
  research: { what: "Drafting the research plan", business: [{ limit: 3, windowMs: HOUR }, { limit: 10, windowMs: DAY }] },
  /** positioning.requestDraft: the Product lead's first positioning notes (one call; WP-08 T1). */
  positioning: { what: "Drafting the positioning notes", business: [{ limit: 3, windowMs: HOUR }, { limit: 10, windowMs: DAY }] },
  /** agent.training.run and agent.model.set (its retests): training runs on the orchestrator. */
  training: { what: "Training", user: [{ limit: 20, windowMs: HOUR }], business: [{ limit: 60, windowMs: DAY }] },
  /** business.continue: a cycle (the Chief of Staff's plan, or a composer note when nothing is ready). */
  continue: { what: "Continue", user: [{ limit: 20, windowMs: MINUTE }], business: [{ limit: 120, windowMs: HOUR }] },
  /** dev.tasks.start: an agent session (models on the platform key or the founder's own, and a sandbox on the platform's account). */
  session: { what: "Starting tasks", user: [{ limit: 30, windowMs: HOUR }], business: [{ limit: 200, windowMs: DAY }] },
  /** idea.commit: a new business, whose vision, specification and roadmap are drafted on its first open (Opus). */
  commit: { what: "Taking charge of a business", user: [{ limit: 10, windowMs: HOUR }, { limit: 30, windowMs: DAY }] },
  /** legal.import.lookup: a registry call to a vendor. */
  lookup: { what: "Registry lookup", user: [{ limit: 30, windowMs: HOUR }], business: [{ limit: 100, windowMs: DAY }] },
  /** idea.domainCheck: up to eight registry requests through the gateway, which limits each founder's calls too. */
  domains: { what: "Domain check", user: [{ limit: 20, windowMs: MINUTE }, { limit: 200, windowMs: HOUR }] },
  /** billing.topUp: a Stripe Checkout session on the platform account. */
  checkout: { what: "Checkout", user: [{ limit: 10, windowMs: HOUR }], business: [{ limit: 30, windowMs: DAY }] },
  /** founder.email.sendLink (WP-03 T3): one email per press; the gateway sends three a day per person and refuses the rest. */
  continueLink: { what: "Emailing a link", user: [{ limit: 5, windowMs: MINUTE }, { limit: 20, windowMs: DAY }] },
  /** crm.replies.answer (WP-08 T2): one email per press from the project's address; the project's day cap still applies. */
  replyAnswer: { what: "Answering an email", user: [{ limit: 10, windowMs: MINUTE }, { limit: 100, windowMs: DAY }] },
  /** updates.send (WP-08 T3): one press sends up to the project's day of email; the gateway counts every message. */
  followerUpdate: { what: "Sending an update", user: [{ limit: 5, windowMs: MINUTE }, { limit: 20, windowMs: DAY }] },
} as const satisfies Record<string, ModelLimitRule>;

export type ModelLimitName = keyof typeof MODEL_LIMITS;

/**
 * The rules that stay open without the entry plan when `PAID_ENTRY` is on (founder, Nov 18, 2026: "the plan should always
 * go first"). Everything before the first AI run is free: Take charge and its foundations, and shaping an idea and its
 * logos, which run before any project exists and so are never gated here. The others listed call a vendor, not a model.
 * Every other rule, inside a project on the platform key, needs the plan.
 */
const OPEN_WITHOUT_PLAN = new Set<ModelLimitName>(["ideation", "commit", "foundations", "lookup", "domains", "checkout", "continueLink", "replyAnswer", "followerUpdate"]);

const scaled = (w: WindowLimit, scale: number): WindowLimit => (scale === 1 ? w : { ...w, limit: Math.max(1, Math.round(w.limit * scale)) });

/**
 * The factor applied to every allowance: `MODEL_LIMIT_SCALE` on the development and test stacks (the Playwright suites commit
 * a dozen businesses an hour), always 1 on staging and production, whatever the variable says.
 */
export function modelLimitScale(env: { APP_ENV: string; MODEL_LIMIT_SCALE: number }): number {
  return env.APP_ENV === "development" || env.APP_ENV === "test" ? env.MODEL_LIMIT_SCALE : 1;
}

/** The windows one request under `name` spends: its own rule's, then the shared ceiling's, for the person and the business. */
/** `scale` multiplies every window's allowance (1 outside the development and test stacks, see `modelLimitScale`). */
export function modelLimitEntries(name: ModelLimitName, scope: { userId: string; businessId?: string | null }, scale = 1): LimitEntry[] {
  const entries: LimitEntry[] = [];
  const add = (rule: string, limits: Partial<ModelLimitRule>) => {
    for (const w of limits.user ?? []) entries.push({ key: `model:${rule}:user:${w.windowMs}:${scope.userId}`, rule: scaled(w, scale) });
    if (scope.businessId) for (const w of limits.business ?? []) entries.push({ key: `model:${rule}:business:${w.windowMs}:${scope.businessId}`, rule: scaled(w, scale) });
  };
  add(name, MODEL_LIMITS[name]);
  add("shared", SHARED_MODEL_LIMITS);
  return entries;
}

/**
 * Refusals that give the hit back (another limit, bad input, no access, a conflict, used-up credits), and only when the
 * request reached no model: a plan compiled before a section wall refused it was paid for (services/model-calls.ts).
 */
const REFUNDED_CODES = new Set(["TOO_MANY_REQUESTS", "BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED", "UNAUTHORIZED", "PAYMENT_REQUIRED"]);

export interface ModelLimitOptions {
  /** Only requests whose input this accepts spend the allowance (a decision with free text compiles a plan; an option does not). */
  when?: (input: unknown) => boolean;
}

/**
 * Middleware for a model-backed procedure: spends one hit of `name` (and of the shared ceiling) for the signed-in person and,
 * inside a business, for the business; refuses with TOO_MANY_REQUESTS when any window is full. Use it after
 * `protectedProcedure` / `businessProcedure`. A request refused before reaching any model gets its hit back; one that
 * started a model call keeps it spent, whatever refused it afterwards.
 */
export function modelLimited(name: ModelLimitName, options: ModelLimitOptions = {}) {
  return middleware(async ({ ctx, next, getRawInput }) => {
    const c = ctx as Context & { businessId?: string; business?: { modelBilling: string } | null };
    if (!c.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue" });
    if (options.when && !options.when(await getRawInput())) return next();
    // The plan goes first (402 with the Subscribe request); a project on its own Anthropic key is not on the platform key.
    if (c.businessId && !OPEN_WITHOUT_PLAN.has(name) && c.business?.modelBilling !== "byok") await requireEntryPlanForRun(c.db, c.env, c.businessId);
    const scope = { userId: c.userId, businessId: c.businessId ?? null };
    // Past 80% of the month's free-plan cap, a free request gets a quarter of its allowances (WP-13 T6).
    const slow = c.freePlanSlow ? await c.freePlanSlow(scope) : false;
    const taken = await c.limits.take(modelLimitEntries(name, scope, modelLimitScale(c.env) * (slow ? FREE_CAP_SLOW_SCALE : 1)));
    if (!taken.ok) throw new RateLimitedError(MODEL_LIMITS[name].what, taken.retryAfterMs);
    // The procedure gets a model client that notes every call as it starts (the api's own already does, at its credits gate,
    // once the gate let the call through; any other client is wrapped), so a request that reached the model keeps its hit
    // whatever refuses it afterwards.
    const { result, scope: calls } = await withModelCallScope(() => next({ ctx: { ...ctx, models: notesCalls(c.models) ? c.models : gateModelClient(c.models, async () => noteModelCall()) } }));
    if (!result.ok && calls.calls === 0 && REFUNDED_CODES.has(toTRPCError(result.error).code)) await c.limits.refund(taken.ticket);
    return result;
  });
}
