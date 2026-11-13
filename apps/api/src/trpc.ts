/**
 * tRPC base (docs/ARCHITECTURE.md §13): superjson, error mapping from AppError subclasses, `protectedProcedure`
 * (needs a user), `businessProcedure` (input carries `businessId`; membership asserted through repos; attaches
 * `ctx.business`, `ctx.role`, `ctx.membership` and `ctx.rls(fn)` = `withRls(db, { userId }, fn)`), role and
 * section-permission middlewares, and the `audit` / `emit` helpers every mutation calls inside its transaction.
 */
import { initTRPC, TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";
import superjson from "superjson";
import { ZodError, z } from "zod";
import { liveModeOpen } from "@foundmill/config";
import { repos, SLUG_TAKEN, uniqueViolation, withRls, type Business, type DbTx, type Executor, type Membership } from "@foundmill/db";
import type { EventPayloadInput } from "@foundmill/events";
import { isModelBillingError } from "@foundmill/models";
import { admitOrWait, assertConfirmedSignIn } from "./services/access";
import { modelBillingAppError } from "./services/model-errors";
import { writeEventRow } from "./services/events";
import { ADMIN_ROLES, AppError, ConflictError, DEFAULT_AGENT_STYLE, NotFoundError, OWNER_ROLES, WRITE_ROLES, effectivePermission, isAgentStyle, type Actor, type AgentStyle, type BusinessEventType, type MembershipRole, type PermissionLevel, type Section } from "@foundmill/shared";
import type { Context } from "./context";

export const Id = z.guid();
export const BusinessInput = z.object({ businessId: Id });

/**
 * Sections a membership can be restricted on (BUILD §11.9 "per-section permissions") and the effective permission of a
 * membership on one: defined once in @foundmill/shared (permissions.ts) so apps/collab enforces the same walls.
 */
export { SECTIONS, effectivePermission, hasSectionAccess, type PermissionLevel, type Section } from "@foundmill/shared";

export type RlsRunner = <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>;

export interface BusinessContext extends Context {
  userId: string;
  businessId: string;
  business: Business;
  membership: Membership;
  role: MembershipRole;
  /** The signed-in person's "Anthropomorphic agents" preference, read with the membership (no extra round trip). */
  anthropomorphicAgents?: boolean;
  /** The character style of those agents (humans when the person never chose), read with the membership too. */
  agentStyle?: AgentStyle;
  /** Runs fn inside a transaction as the signed-in user so Postgres RLS enforces tenancy. */
  rls: RlsRunner;
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  // The last stop before the wire, so it also covers errors raised before a procedure runs (createContext, input
  // parsing) that never pass through `mapErrors`: an INTERNAL error reads as a generic line with the request id outside
  // development and test, and carries no stack. Without a context the environment comes from the process, failing closed.
  errorFormatter({ shape, error, ctx }) {
    const cause = error.cause;
    const appEnv = ctx?.env?.APP_ENV ?? process.env.APP_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development");
    const internal = error.code === "INTERNAL_SERVER_ERROR";
    const hide = internal && !(appEnv === "development" || appEnv === "test");
    return {
      ...shape,
      message: internal ? internalErrorMessage(shape.message, appEnv, ctx?.requestId) : shape.message,
      data: {
        ...shape.data,
        ...(hide ? { stack: undefined } : {}),
        appCode: cause instanceof AppError ? cause.code : undefined,
        details: cause instanceof AppError ? cause.details : cause instanceof ZodError ? cause.issues : undefined,
      },
    };
  },
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const createCallerFactory = t.createCallerFactory;
export const middleware = t.middleware;

// --- error mapping ---------------------------------------------------------------------------------------------------

const CODE_BY_APP_CODE: Record<string, TRPC_ERROR_CODE_KEY> = {
  not_found: "NOT_FOUND",
  forbidden: "FORBIDDEN",
  hard_gate: "FORBIDDEN",
  policy_denied: "FORBIDDEN",
  unauthorized: "UNAUTHORIZED",
  validation: "BAD_REQUEST",
  composer_unavailable: "SERVICE_UNAVAILABLE",
  // The composer's own answers (services/composer.ts passes them through): shown to the founder, never hidden as internal.
  composer_timeout: "GATEWAY_TIMEOUT",
  composer_rejected: "UNPROCESSABLE_CONTENT",
  no_agents: "CONFLICT",
  continue_blocked: "CONFLICT",
  reauth_required: "PRECONDITION_FAILED",
  // A model call on the platform key refused before it was made: the month's credits are used up (packages/db billing.ts `assertPlatformCredits`).
  credits_exhausted: "PAYMENT_REQUIRED",
  config: "PRECONDITION_FAILED",
  invalid_record: "INTERNAL_SERVER_ERROR",
  decrypt_failed: "INTERNAL_SERVER_ERROR",
  kms_failed: "SERVICE_UNAVAILABLE",
  // The Ideation agent's plain-language failures (services/ideation.ts): shown to the founder, never hidden as internal.
  ideation_too_long: "BAD_GATEWAY",
  ideation_incomplete: "BAD_GATEWAY",
  // Anthropic refused to bill a model call (services/model-errors.ts): the founder reads who has to act, never "internal".
  model_billing: "PAYMENT_REQUIRED",
};

const codeForStatus = (status: number): TRPC_ERROR_CODE_KEY => {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 402:
      return "PAYMENT_REQUIRED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 412:
      return "PRECONDITION_FAILED";
    case 429:
      return "TOO_MANY_REQUESTS";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return "INTERNAL_SERVER_ERROR";
  }
};

const RLS_RE = /row-level security|permission denied for/i;

/** Map any thrown value to a TRPCError with the right code; TRPCErrors we threw pass through untouched. */
export function toTRPCError(err: unknown): TRPCError {
  const cause = err instanceof TRPCError ? (err.cause ?? err) : err;
  if (cause instanceof AppError) {
    return new TRPCError({ code: CODE_BY_APP_CODE[cause.code] ?? codeForStatus(cause.status), message: cause.message, cause });
  }
  if (isModelBillingError(cause)) {
    const billing = modelBillingAppError(cause);
    return new TRPCError({ code: "PAYMENT_REQUIRED", message: billing.message, cause: billing });
  }
  if (cause instanceof ZodError) {
    return new TRPCError({ code: "BAD_REQUEST", message: cause.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "), cause });
  }
  // A foreign-key violation is the caller's doing, not a server fault, and must not echo the failed statement. tRPC has
  // already wrapped a thrown database error as INTERNAL_SERVER_ERROR by the time it gets here; a code we set on purpose
  // is left alone. Writing a row that points at something that does not exist is "not found"; deleting something that
  // other rows still point at is a conflict.
  const fk = (!(err instanceof TRPCError) || err.code === "INTERNAL_SERVER_ERROR") ? foreignKeyViolation(cause) : undefined;
  if (fk) {
    return fk.kind === "reference"
      ? new TRPCError({ code: "NOT_FOUND", message: "A record this request refers to does not exist", cause: cause as Error })
      : new TRPCError({ code: "CONFLICT", message: "This record is still in use by something else", cause: cause as Error });
  }
  // A unique violation is the caller's doing too (a name or an address someone already has): CONFLICT with a line a
  // founder can act on and the field when one is known, never the failed statement. Repositories turn the ones a
  // founder meets every day into their own messages first; this is the net under the rest.
  const unique = !(err instanceof TRPCError) || err.code === "INTERNAL_SERVER_ERROR" ? uniqueViolation(cause) : undefined;
  if (unique) {
    const known = UNIQUE_CONSTRAINTS[unique.constraint ?? ""];
    const conflict = new ConflictError(known?.message ?? "That already exists", known?.field ? { field: known.field } : undefined);
    return new TRPCError({ code: "CONFLICT", message: conflict.message, cause: conflict });
  }
  // The same holds for the database refusing a write: a row-level-security denial (or a missing grant) is the caller's
  // permission, not a server fault, and a unique violation is a clash with something that already exists. Neither
  // echoes the failed statement.
  const refusal = (!(err instanceof TRPCError) || err.code === "INTERNAL_SERVER_ERROR") ? databaseRefusal(cause) : undefined;
  if (refusal?.kind === "forbidden") return new TRPCError({ code: "FORBIDDEN", message: "Not permitted for this business", cause: cause as Error });
  if (refusal?.kind === "duplicate") return new TRPCError({ code: "CONFLICT", message: "Something with these details already exists", cause: cause as Error });
  if (err instanceof TRPCError) return err;
  const message = (cause as { message?: string })?.message ?? String(cause);
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message, cause: cause as Error });
}

const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_UNIQUE_VIOLATION = "23505";

/**
 * A database refusal the caller caused, if `err` is one (looking through Drizzle's and tRPC's wrappers): "forbidden" for
 * a row-level-security denial or a missing grant (SQLSTATE 42501, or the message where a driver gives no code),
 * "duplicate" for a unique violation (23505), with the constraint's name for the log.
 */
export function databaseRefusal(err: unknown): { kind: "forbidden" | "duplicate"; constraint: string | undefined } | undefined {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && e && typeof e === "object"; depth++) {
    const code = (e as { code?: unknown }).code;
    const message = String((e as { message?: unknown }).message ?? "");
    const named = (e as { constraint?: unknown }).constraint;
    const constraint = typeof named === "string" ? named : /constraint "([^"]+)"/.exec(message)?.[1];
    if (code === PG_UNIQUE_VIOLATION) return { kind: "duplicate", constraint };
    if (code === PG_INSUFFICIENT_PRIVILEGE || RLS_RE.test(message)) return { kind: "forbidden", constraint: undefined };
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

const PG_FOREIGN_KEY_VIOLATION = "23503";

/** What a unique violation of a constraint a founder can reach means, in their words, and the form field it is about. */
const UNIQUE_CONSTRAINTS: Record<string, { message: string; field?: string }> = {
  businesses_slug_key: { message: SLUG_TAKEN, field: "slug" },
  departments_business_id_slug_key: { message: "Another department already uses that address", field: "slug" },
};

/**
 * A foreign-key violation, if `err` is one: "reference" when a write names a row that does not exist (Postgres says
 * "insert or update on table …"), "in_use" when a delete or update is blocked by rows that point at it, with the
 * constraint's name for the log.
 */
export function foreignKeyViolation(err: unknown): { kind: "reference" | "in_use"; constraint: string | undefined } | undefined {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && e && typeof e === "object"; depth++) {
    if ((e as { code?: unknown }).code === PG_FOREIGN_KEY_VIOLATION) {
      const message = String((e as { message?: unknown }).message ?? "");
      const named = (e as { constraint?: unknown }).constraint;
      return { kind: /^insert or update on table/i.test(message) ? "reference" : "in_use", constraint: typeof named === "string" ? named : /constraint "([^"]+)"/.exec(message)?.[1] };
    }
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The Postgres SQLSTATE of a database error, looking through Drizzle's wrapper (`DrizzleQueryError.cause`). */
export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && e && typeof e === "object"; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * What a client may read of an INTERNAL_SERVER_ERROR. Development and test keep the real message (it is how a developer
 * finds the fault); every other environment gets a generic line and the request id to quote, because the raw text can
 * carry SQL, table names and values.
 */
export function internalErrorMessage(message: string, appEnv: string, requestId?: string): string {
  if (appEnv === "development" || appEnv === "test") return message;
  return requestId ? `Something went wrong on our side. Quote reference ${requestId} if you contact support.` : "Something went wrong on our side.";
}

const mapErrors = t.middleware(async ({ next, ctx, path, type }) => {
  const result = await next();
  if (!result.ok) {
    const mapped = toTRPCError(result.error);
    const fk = foreignKeyViolation(mapped.cause);
    if (fk && mapped.code !== "INTERNAL_SERVER_ERROR") ctx.log.warn({ path, type, code: mapped.code, constraint: fk.constraint, kind: fk.kind, requestId: ctx.requestId }, "foreign key violation");
    const refusal = mapped.code === "FORBIDDEN" || mapped.code === "CONFLICT" ? databaseRefusal(mapped.cause) : undefined;
    if (refusal) ctx.log.warn({ path, type, code: mapped.code, constraint: refusal.constraint, kind: refusal.kind, requestId: ctx.requestId }, refusal.kind === "forbidden" ? "database refused the write (row-level security)" : "unique violation");
    if (mapped.code === "INTERNAL_SERVER_ERROR") {
      ctx.log.error({ path, type, err: mapped.cause ?? mapped, requestId: ctx.requestId }, "procedure failed");
      const shown = internalErrorMessage(mapped.message, ctx.env.APP_ENV, ctx.requestId);
      throw shown === mapped.message ? mapped : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: shown, cause: mapped.cause });
    }
    if (mapped.cause instanceof AppError && mapped.cause.code === "model_billing") {
      // The operator's alert (packages/models logs each refused call too): which procedure the founder could not use.
      const details = mapped.cause.details as { billedTo?: string; reason?: string } | undefined;
      if (details?.billedTo === "byok") ctx.log.warn({ path, type, reason: details.reason, billedTo: "byok", requestId: ctx.requestId }, "model call refused for billing on the business's own key");
      else ctx.log.error({ path, type, alert: "model_billing", reason: details?.reason, billedTo: "credits", requestId: ctx.requestId }, "model call refused for billing on the platform key");
    } else ctx.log.debug({ path, type, code: mapped.code, requestId: ctx.requestId }, mapped.message);
    throw mapped;
  }
  return result;
});

/**
 * After a mutation (whatever its outcome: a failed one may have committed a first transaction), the outbox relay is
 * woken so the events it committed reach the stream now, not at the next idle poll (services/relay.ts). A wake with
 * nothing to publish costs the relay one cheap statement.
 */
const wakeRelay = t.middleware(async ({ ctx, type, next }) => {
  const result = await next();
  if (type === "mutation") ctx.relay?.wake();
  return result;
});

// --- procedures ------------------------------------------------------------------------------------------------------

export const publicProcedure = t.procedure.use(mapErrors).use(wakeRelay);

export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue" });
  // Admit now or wait (services/access.ts): the list, an admission, or open sign-up's ceiling; else a typed refusal.
  await admitOrWait(ctx, { userId: ctx.userId, email: ctx.email, emailConfirmed: ctx.emailConfirmed });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

/**
 * Signed in with a confirmed address, admitted or not: only for the procedure that is how a person gets in
 * (`invitation.accept`). Everything else is `protectedProcedure`.
 */
export const signedInProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue" });
  assertConfirmedSignIn({ userId: ctx.userId, email: ctx.email, emailConfirmed: ctx.emailConfirmed });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

/** What `businessProcedure` learns about one user and one business: the membership, and the business if it is open. */
export interface BusinessAccess {
  membership: Membership | null;
  /** Null when there is no membership, or the business is archived and the procedure does not take archived ones. */
  business: Business | null;
  /** The person's anthropomorphic-agents preference (false without a preferences row). */
  anthropomorphicAgents?: boolean;
  /** The person's character style for them (humans without a preferences row). */
  agentStyle?: AgentStyle;
}

/**
 * The membership and the business, in one statement (`repos.memberships.access`: one round trip, one connection).
 * With a request memo (`ctx.accessMemo`, a fresh map per HTTP request) the lookup runs once per user and business for
 * the whole batch; without one (in-process caller, tests) it runs on every call. A failed lookup is dropped from the
 * memo so it is never reused.
 */
export function loadBusinessAccess(ctx: Pick<Context, "db" | "accessMemo">, userId: string, businessId: string, options: { includeArchived?: boolean } = {}): Promise<BusinessAccess> {
  const includeArchived = options.includeArchived === true;
  const run = (): Promise<BusinessAccess> => repos.memberships.access(ctx.db, businessId, userId, { includeArchived });
  const memo = ctx.accessMemo;
  if (!memo) return run();
  const key = `${userId}\u0000${businessId}${includeArchived ? "\u0000archived" : ""}`;
  const cached = memo.get(key);
  if (cached) return cached;
  const pending = run();
  memo.set(key, pending);
  pending.catch(() => {
    if (memo.get(key) === pending) memo.delete(key);
  });
  return pending;
}

const NOT_A_MEMBER_MESSAGE = "You are not a member of this business";

/** The procedure base for a business: membership asserted, the business loaded (archived ones only when asked), RLS attached. */
function businessBase(options: { includeArchived: boolean }) {
  return protectedProcedure.input(BusinessInput).use(async ({ ctx, input, next }) => {
    const access = await loadBusinessAccess(ctx, ctx.userId, input.businessId, options);
    // Membership first: a non-member learns nothing about the business, not even whether it exists.
    const membership = access.membership;
    // `appCode: "not_a_member"` lets a tab that is open on the business tell a removal from any other refusal (the web then
    // drops the business and says so, instead of leaving a shell full of "Try again" panels).
    if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: NOT_A_MEMBER_MESSAGE, cause: new AppError("not_a_member", NOT_A_MEMBER_MESSAGE, 403) });
    // A member of an archived business gets what `repos.businesses.get` says about it.
    if (!access.business) throw new NotFoundError("business", input.businessId);
    const business = access.business;
    const rls: RlsRunner = (fn) => withRls(ctx.db, { userId: ctx.userId, claims: ctx.email ? { email: ctx.email } : undefined }, fn);
    const bctx: BusinessContext = { ...ctx, businessId: input.businessId, business, membership, role: membership.role, anthropomorphicAgents: access.anthropomorphicAgents === true, agentStyle: isAgentStyle(access.agentStyle) ? access.agentStyle : DEFAULT_AGENT_STYLE, rls };
    return next({ ctx: bctx });
  });
}

/** Procedures whose input carries `businessId`: membership asserted, RLS runner attached. An archived business is not found. */
export const businessProcedure = businessBase({ includeArchived: false });
/**
 * The same for the few things an archived business still allows (BUILD §11.15): restore it, export it, and request or
 * cancel its permanent deletion. Everything else keeps answering NOT_FOUND until it is restored.
 */
export const archivedBusinessProcedure = businessBase({ includeArchived: true });

export function requireRoles(roles: readonly MembershipRole[], what = "this action") {
  return t.middleware(({ ctx, next }) => {
    const role = (ctx as Partial<BusinessContext>).role;
    if (!role || !roles.includes(role)) throw new TRPCError({ code: "FORBIDDEN", message: `Your role (${role ?? "none"}) cannot perform ${what}` });
    return next();
  });
}

/** Middleware factory: the member must hold at least `level` on `section` (BUILD §11.9 staff permissions). */
export function sectionPermission(section: Section, level: PermissionLevel = "write") {
  return t.middleware(({ ctx, next }) => {
    const membership = (ctx as Partial<BusinessContext>).membership;
    if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "No membership in context" });
    const have = effectivePermission(membership, section);
    const ok = have === "write" || (level === "read" && have === "read");
    if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: `You do not have ${level} access to ${section}` });
    return next();
  });
}

/** Mutations: owner, cofounder, admin, member and collaborator (viewers and advisors never write — RLS enforces the same). */
export const writeProcedure = businessProcedure.use(requireRoles(WRITE_ROLES, "changes"));
/** An owner's standing (an owner or a cofounder) or an admin: modes, holiday, kill switch, people, keys, billing, integrations, structure. */
export const adminProcedure = businessProcedure.use(requireRoles(ADMIN_ROLES, "administration"));
/** An owner's standing only (an owner or a cofounder, THESIS_REVIEW 3.3): tier changes, permanent actions. */
export const ownerProcedure = businessProcedure.use(requireRoles(OWNER_ROLES, "owner actions"));
/** An owner's standing or an admin, on a business that may be archived (export). */
export const adminArchivedProcedure = archivedBusinessProcedure.use(requireRoles(ADMIN_ROLES, "administration"));
/** An owner's standing only, on a business that may be archived (restore, permanent deletion). */
export const ownerArchivedProcedure = archivedBusinessProcedure.use(requireRoles(OWNER_ROLES, "owner actions"));

/**
 * Closes the LIVE surfaces (live.*, going live, committing as LIVE) while `FLAGS.liveMode` is off and the deployment has
 * not opened them with `LIVE_MODE=1` (`liveModeOpen`; DECISIONS 2026-10-07).
 */
export const LIVE_CLOSED_MESSAGE = "LIVE is not open yet";
export const assertLiveOpen = (env: Pick<Context["env"], "LIVE_MODE">): void => {
  if (!liveModeOpen(env)) throw new TRPCError({ code: "FORBIDDEN", message: LIVE_CLOSED_MESSAGE });
};
export const liveGate = t.middleware(({ ctx, next }) => {
  assertLiveOpen(ctx.env);
  return next();
});

export const sectionRead = (section: Section) => businessProcedure.use(sectionPermission(section, "read"));
export const sectionWrite = (section: Section) => writeProcedure.use(sectionPermission(section, "write"));
export const sectionAdmin = (section: Section) => adminProcedure.use(sectionPermission(section, "write"));

// --- audit and events ------------------------------------------------------------------------------------------------

export interface AuditInput {
  action: string;
  target?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

/** Append to the hash-chained audit log as the signed-in user, inside the caller's transaction. */
export function audit(tx: Executor, ctx: Pick<BusinessContext, "businessId" | "userId">, input: AuditInput) {
  return repos.audit.append(tx, ctx.businessId, { actorKind: "user", actorId: ctx.userId, action: input.action, target: input.target ?? {}, details: input.details ?? {} });
}

export interface EmitInput<T extends BusinessEventType> {
  type: T;
  payload: EventPayloadInput<T>;
  entityIds?: readonly string[];
  actor?: Actor;
  /** An event that two writers may both record (`holiday.ended:<id>`): the second write returns the first. */
  idempotencyKey?: string;
  /** Defaults to now; an event that marks the same moment as a row written with it (Continue's run start) passes that row's time. */
  occurredAt?: Date;
}

/** Write an event through the transactional outbox in the same transaction as the change it describes. */
export function emit<T extends BusinessEventType>(tx: Executor, ctx: Pick<BusinessContext, "businessId" | "userId">, input: EmitInput<T>): Promise<string> {
  return writeEventRow(tx, { businessId: ctx.businessId, type: input.type, actor: input.actor ?? { kind: "user", id: ctx.userId }, payload: input.payload, entityIds: input.entityIds, ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}) }, input.idempotencyKey);
}

/** Shape every Temporal-backed mutation returns so the UI can say "queued" or "not queued: reason". */
export const QueuedResult = z.object({ queued: z.boolean(), workflowId: z.string().optional(), reason: z.string().optional() });
export type QueuedResult = z.infer<typeof QueuedResult>;
