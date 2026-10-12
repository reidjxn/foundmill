/**
 * Per-person and per-business allowances on every procedure that calls a model on the platform key (SEC-13): Ideation
 * and Ask, logos, conversations, Inbox Refresh, plan previews and free-text decisions, task planning, the legal and
 * distribution recommenders, foundations retries, training runs and Continue; and on the two that call a vendor per
 * press, registry lookups and checkout sessions. Each procedure spends one hit from its own rule and one from
 * `SHARED_MODEL_LIMITS`, the ceiling across all of them, so a stuck key, a script or a member looping one button cannot
 * drain the platform's credits; a refusal is TOO_MANY_REQUESTS with a sentence the founder can act on (naming what they
 * pressed, whichever window is full), and nothing is called.
 *
 * The windows live in `ctx.limits` (Redis across replicas, memory in development and tests; rate-limit.ts). The
 * allowances that predate this one keep their own rules inside their services (drafting in ideation.ts, logo sets in
 * logo.ts, conversation sends in conversation.ts); their procedures still spend from the shared ceiling.
 */
import { TRPCError } from "@trpc/server";
import type { Context } from "../context";
import { middleware, toTRPCError } from "../trpc";
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
  /** agent.training.run and agent.model.set (its retests): training runs on the orchestrator. */
  training: { what: "Training", user: [{ limit: 20, windowMs: HOUR }], business: [{ limit: 60, windowMs: DAY }] },
  /** business.continue: a cycle (the Chief of Staff's plan, or a composer note when nothing is ready). */
  continue: { what: "Continue", user: [{ limit: 20, windowMs: MINUTE }], business: [{ limit: 120, windowMs: HOUR }] },
  /** legal.import.lookup: a registry call to a vendor. */
  lookup: { what: "Registry lookup", user: [{ limit: 30, windowMs: HOUR }], business: [{ limit: 100, windowMs: DAY }] },
  /** billing.topUp: a Stripe Checkout session on the platform account. */
  checkout: { what: "Checkout", user: [{ limit: 10, windowMs: HOUR }], business: [{ limit: 30, windowMs: DAY }] },
} as const satisfies Record<string, ModelLimitRule>;

export type ModelLimitName = keyof typeof MODEL_LIMITS;

/** The windows one request under `name` spends: its own rule's, then the shared ceiling's, for the person and the business. */
export function modelLimitEntries(name: ModelLimitName, scope: { userId: string; businessId?: string | null }): LimitEntry[] {
  const entries: LimitEntry[] = [];
  const add = (rule: string, limits: Partial<ModelLimitRule>) => {
    for (const w of limits.user ?? []) entries.push({ key: `model:${rule}:user:${w.windowMs}:${scope.userId}`, rule: w });
    if (scope.businessId) for (const w of limits.business ?? []) entries.push({ key: `model:${rule}:business:${w.windowMs}:${scope.businessId}`, rule: w });
  };
  add(name, MODEL_LIMITS[name]);
  add("shared", SHARED_MODEL_LIMITS);
  return entries;
}

/** Refused before any model call (another limit, bad input, no access, a conflict): the hit is given back. */
const REFUNDED_CODES = new Set(["TOO_MANY_REQUESTS", "BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED", "UNAUTHORIZED"]);

export interface ModelLimitOptions {
  /** Only requests whose input this accepts spend the allowance (a decision with free text compiles a plan; an option does not). */
  when?: (input: unknown) => boolean;
}

/**
 * Middleware for a model-backed procedure: spends one hit of `name` (and of the shared ceiling) for the signed-in person and,
 * inside a business, for the business; refuses with TOO_MANY_REQUESTS when any window is full. Use it after
 * `protectedProcedure` / `businessProcedure`. A request refused before reaching the model gets its hit back.
 */
export function modelLimited(name: ModelLimitName, options: ModelLimitOptions = {}) {
  return middleware(async ({ ctx, next, getRawInput }) => {
    const c = ctx as Context & { businessId?: string };
    if (!c.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue" });
    if (options.when && !options.when(await getRawInput())) return next();
    const taken = await c.limits.take(modelLimitEntries(name, { userId: c.userId, businessId: c.businessId ?? null }));
    if (!taken.ok) throw new RateLimitedError(MODEL_LIMITS[name].what, taken.retryAfterMs);
    const result = await next();
    if (!result.ok && REFUNDED_CODES.has(toTRPCError(result.error).code)) await c.limits.refund(taken.ticket);
    return result;
  });
}
