/**
 * The `platform` connector's host over the platform's database (BUILD §9.9 task board and typed messages, §9.7 "facts
 * are queried via tools from Postgres"). The gateway serves it at `/mcp/platform` through the same pipeline as every
 * vendor connector (session scope, rate limit, Cedar, audit), so a platform tool is just another tool call.
 *
 * Every read and write is scoped to the caller's business (the session token's): an id from another business is not
 * found. Workers act on tasks assigned to them; leads (whose grants include create/assign) hand work out. A typed
 * message is an `agent.message_sent` event written through the outbox; nothing here moves money or contacts anyone.
 * Errors the agent can act on come back as `PlatformToolError`s; any other failure is logged without its parameters
 * and answered with a plain "try again".
 */
import { AppError, NotFoundError, uuid, type TaskStatus } from "@foundmill/shared";
import { repos, type Db, type Task } from "@foundmill/db";
import { PlatformToolError, type PlatformCaller, type PlatformHost, type TaskSummaryT } from "@foundmill/connectors";
import { writeGatewayEvent } from "./events";
import { hashRecipient } from "./recipients";
import type { GatewayLogger } from "./pipeline";
import { safeError } from "./pipeline";

/** Messages `list_messages` reads back: the newest of the business's typed messages, filtered to the caller. */
export const PLATFORM_MESSAGE_WINDOW = 500;
/** How far ahead `read_legal` looks for filing and compliance deadlines (days). */
export const PLATFORM_DEADLINE_DAYS = 90;
const TERMINAL: ReadonlySet<TaskStatus> = new Set(["done", "failed", "stopped"]);

const summary = (t: Task): TaskSummaryT => ({ id: t.id, title: t.title, kind: t.kind, status: t.status, priority: t.priority, progress: Number(t.progress ?? 0), assigneeAgentId: t.assigneeAgentId, updatedAt: t.updatedAt.toISOString() });

/** Plain text of a ProseMirror-style document (spec blocks), paragraphs on their own lines. */
export function docPlainText(doc: unknown): string {
  type Node = { text?: unknown; content?: unknown };
  const textOf = (node: unknown): string => {
    const n = (node ?? {}) as Node;
    if (typeof n.text === "string") return n.text;
    return Array.isArray(n.content) ? n.content.map(textOf).join("") : "";
  };
  const lines: string[] = [];
  const visit = (node: unknown): void => {
    const content = ((node ?? {}) as Node).content;
    if (!Array.isArray(content)) return;
    // A node holding text is one line (a paragraph, a heading, a list item's paragraph); containers are walked into.
    if (content.some((c) => typeof ((c ?? {}) as Node).text === "string")) lines.push(textOf(node));
    else content.forEach(visit);
  };
  visit(doc);
  return lines.filter((l) => l.trim()).join("\n");
}

const paragraphDoc = (text: string) => ({ type: "doc", content: text.split(/\n{2,}/).map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) });

export interface DbPlatformHostOptions {
  db: Db;
  log: GatewayLogger;
  now?: () => Date;
}

export function createDbPlatformHost({ db, log, now = () => new Date() }: DbPlatformHostOptions): PlatformHost {
  const notFound = (what: string, id: string) => new PlatformToolError("not_found", `${what} ${id} is not part of this business`);
  const taskOf = async (caller: PlatformCaller, taskId: string): Promise<Task> => {
    try {
      const t = await repos.tasks.get(db, caller.businessId, taskId);
      if (t.archivedAt) throw notFound("task", taskId);
      return t;
    } catch (e) {
      throw e instanceof NotFoundError ? notFound("task", taskId) : e;
    }
  };
  const agentOf = async (caller: PlatformCaller, agentId: string) => {
    try {
      return await repos.agents.get(db, caller.businessId, agentId);
    } catch (e) {
      throw e instanceof NotFoundError ? notFound("agent", agentId) : e;
    }
  };
  const mine = (caller: PlatformCaller, t: Task, verb: string) => {
    if (t.assigneeAgentId !== caller.agentId) throw new PlatformToolError("not_yours", `only the agent working on a task can ${verb} it; this one is ${t.assigneeAgentId ? "assigned to another agent" : "unassigned (claim it first)"}`);
  };
  const open = (t: Task) => {
    if (TERMINAL.has(t.status)) throw new PlatformToolError("invalid_state", `the task is already ${t.status}`);
  };
  const message = async (caller: PlatformCaller, input: { toAgentId: string; type: "request" | "inform" | "review"; subject: string; body: string; taskId?: string | undefined }) => {
    if (input.toAgentId === caller.agentId) throw new PlatformToolError("invalid_state", "a message goes to another agent of the team");
    await agentOf(caller, input.toAgentId);
    if (input.taskId) await taskOf(caller, input.taskId);
    const messageId = uuid();
    const event = await writeGatewayEvent(db, {
      businessId: caller.businessId,
      type: "agent.message_sent",
      actor: { kind: "agent", id: caller.agentId },
      occurredAt: now().toISOString(),
      payload: { messageId, type: input.type, fromAgentId: caller.agentId, toAgentId: input.toAgentId, sessionId: caller.sessionId, taskId: input.taskId ?? null, subject: input.subject, body: input.body },
    });
    return { messageId, sentAt: event.occurredAt.toISOString() };
  };

  const host: PlatformHost = {
    // ---- task board ----------------------------------------------------------------------------------------------
    async listTasks(caller, { scope, status, limit }) {
      const page = await repos.tasks.list(db, caller.businessId, { ...(status?.length ? { status } : {}), ...(scope === "mine" ? { assigneeAgentId: caller.agentId } : {}), limit: scope === "unassigned" ? 500 : limit });
      const items = scope === "unassigned" ? page.items.filter((t) => t.assigneeAgentId === null) : page.items;
      return { items: items.sort((a, b) => b.priority - a.priority).slice(0, limit).map(summary) };
    },
    async getTask(caller, { taskId }) {
      const t = await taskOf(caller, taskId);
      const edges = await repos.tasks.listEdges(db, caller.businessId, [taskId]);
      return { ...summary(t), goalMd: t.goalMd, acceptance: Array.isArray(t.acceptance) ? t.acceptance : [], fileScope: t.fileScope, dependsOn: edges.filter((e) => e.toTask === taskId).map((e) => e.fromTask) };
    },
    async createTask(caller, { title, goal, kind, assigneeAgentId, priority, dependsOn }) {
      if (assigneeAgentId) await agentOf(caller, assigneeAgentId);
      for (const dep of dependsOn) await taskOf(caller, dep);
      const t = await repos.tasks.create(db, caller.businessId, { kind, title, goalMd: goal, assigneeAgentId: assigneeAgentId ?? null, status: "ready", priority, dependsOn });
      return summary(t);
    },
    async claimTask(caller, { taskId }) {
      const t = await taskOf(caller, taskId);
      open(t);
      if (t.assigneeAgentId && t.assigneeAgentId !== caller.agentId) throw new PlatformToolError("not_yours", "this task is assigned to another agent; ask its lead to reassign it");
      return summary(t.assigneeAgentId === caller.agentId ? t : await repos.tasks.reassign(db, caller.businessId, t.id, caller.agentId));
    },
    async assignTask(caller, { taskId, agentId, priority }) {
      const t = await taskOf(caller, taskId);
      open(t);
      if (agentId) await agentOf(caller, agentId);
      return summary(await repos.tasks.update(db, caller.businessId, t.id, { ...(agentId ? { assigneeAgentId: agentId } : {}), ...(priority !== undefined ? { priority } : {}) }));
    },
    async blockTask(caller, { taskId, reason }) {
      const t = await taskOf(caller, taskId);
      mine(caller, t, "block");
      open(t);
      const blocked = await repos.tasks.setStatus(db, caller.businessId, t.id, "blocked", { force: true });
      // The founder hears why (narrated as a warning); the runtime settles the task again when its session ends.
      await writeGatewayEvent(db, {
        businessId: caller.businessId,
        type: "task.blocked",
        actor: { kind: "agent", id: caller.agentId },
        payload: { taskId: t.id, kind: t.kind, title: t.title, assigneeAgentId: caller.agentId, sessionId: caller.sessionId, reason: "dependency", detail: reason, approvalId: null, occurrence: 1 },
      });
      return summary(blocked);
    },
    async handoffTask(caller, { taskId, toAgentId, note }) {
      const t = await taskOf(caller, taskId);
      mine(caller, t, "hand off");
      open(t);
      await message(caller, { toAgentId, type: "inform", subject: `Handed over: ${t.title}`.slice(0, 200), body: note, taskId: t.id });
      return summary(await repos.tasks.reassign(db, caller.businessId, t.id, toAgentId));
    },
    async completeTask(caller, { taskId, summary: report }) {
      const t = await taskOf(caller, taskId);
      mine(caller, t, "complete");
      open(t);
      // Code is reviewed before it counts as done (BUILD §11.6); the report stays with the task's history.
      const done = await repos.tasks.setStatus(db, caller.businessId, t.id, t.kind === "code" ? "review" : "done", { force: true });
      await repos.audit.append(db, caller.businessId, { actorKind: "agent", actorId: caller.agentId, action: "platform.task.completed", target: { kind: "task", id: t.id }, details: { sessionId: caller.sessionId, status: done.status, summary: report } });
      return summary(done);
    },

    // ---- typed messages ------------------------------------------------------------------------------------------
    sendMessage: (caller, args) => message(caller, args),
    async listMessages(caller, { limit }) {
      const page = await repos.events.list(db, caller.businessId, { type: "agent.message_sent", limit: PLATFORM_MESSAGE_WINDOW });
      const items = page.items
        .map((e) => ({ e, p: e.payload as { messageId: string; type: "request" | "inform" | "review"; fromAgentId: string; toAgentId: string; taskId: string | null; subject: string; body: string } }))
        .filter(({ p }) => p.toAgentId === caller.agentId)
        .slice(0, limit)
        .map(({ e, p }) => ({ id: p.messageId, type: p.type, fromAgentId: p.fromAgentId, toAgentId: p.toAgentId, taskId: p.taskId ?? null, subject: p.subject, body: p.body, sentAt: e.occurredAt.toISOString() }));
      return { items };
    },

    // ---- reads ---------------------------------------------------------------------------------------------------
    async readBusiness(caller) {
      const [business, holiday, team] = await Promise.all([repos.businesses.get(db, caller.businessId), repos.holidays.current(db, caller.businessId), repos.agents.list(db, caller.businessId, { limit: 200 })]);
      const cap = (autonomy: Record<string, unknown>) => (typeof autonomy.spendCapMinor === "number" ? autonomy.spendCapMinor : null);
      return {
        name: business.name,
        businessMode: business.businessMode,
        vacation: holiday ? { until: holiday.untilAt ? holiday.untilAt.toISOString() : null, authority: holiday.authority, budgetCeilingMinor: holiday.budgetCeilingMinor ?? null } : null,
        glossary: business.glossary,
        team: team.items.map((a) => ({ id: a.id, name: a.name, role: a.role, agentType: a.agentType, status: a.status, spendCapMinor: cap(a.autonomy) })),
      };
    },
    async searchEntities(caller, { query, limit }) {
      const result = await repos.entities.search(db, caller.businessId, { q: query, limit });
      return { items: result.hits.map((h) => ({ id: h.entity.id, kind: h.entity.kind, name: h.entity.displayName })) };
    },
    async listApprovals(caller, { limit }) {
      const pending = await repos.approvals.pending(db, caller.businessId, limit);
      return { items: pending.map((a) => ({ id: a.id, agentId: a.agentId, connectorKey: a.connectorKey, tool: a.tool, reasons: a.reasons, requestedAt: a.requestedAt.toISOString() })) };
    },
    async listSessions(caller, { limit }) {
      const page = await repos.agents.listSessions(db, caller.businessId, { openOnly: true, limit });
      return { items: page.items.map((s) => ({ id: s.id, agentId: s.agentId, taskId: s.taskId, startedAt: s.startedAt.toISOString() })) };
    },
    async checkContact(caller, { email }) {
      const suppressed = await repos.channels.isSuppressed(db, caller.businessId, { emailHash: hashRecipient("email", email) });
      return { email, contactable: !suppressed };
    },
    async readProduct(caller, { maxChars }) {
      const [blocks, roadmap, sources] = await Promise.all([repos.product.listBlocks(db, caller.businessId), repos.product.listRoadmap(db, caller.businessId), repos.product.listSources(db, caller.businessId, { limit: 50 })]);
      let budget = maxChars;
      const spec: { id: string; section: string; text: string }[] = [];
      for (const b of blocks) {
        if (budget <= 0) break;
        const text = docPlainText(b.content).slice(0, budget);
        budget -= text.length;
        spec.push({ id: b.id, section: b.section, text });
      }
      return {
        spec,
        roadmap: roadmap.map((r) => ({ id: r.id, title: r.title, horizon: r.horizon, status: r.status })),
        sources: sources.items.map((s) => ({ id: s.id, title: s.title, uri: s.uri })),
      };
    },
    async proposeSpecChange(caller, { specBlockId, title, rationale, text }) {
      let block;
      try {
        block = await repos.product.getBlock(db, caller.businessId, specBlockId);
      } catch (e) {
        throw e instanceof NotFoundError ? notFound("spec block", specBlockId) : e;
      }
      const proposal = await repos.product.createProposal(db, caller.businessId, { title, rationaleMd: rationale, severity: "normal", proposedByAgentId: caller.agentId, hunks: [{ specBlockId: block.id, base: block.content, theirs: paragraphDoc(text) }] });
      return { proposalId: proposal.id };
    },
    async readFinance(caller, { transactions }) {
      const asOf = now();
      const from = new Date(asOf.getTime() - 90 * 86_400_000);
      const [accounts, categories, burn, forecasts, page] = await Promise.all([
        repos.finance.listAccounts(db, caller.businessId),
        repos.finance.categoryTotals(db, caller.businessId, { from, to: asOf }),
        repos.finance.netBurn(db, caller.businessId, { asOf }),
        repos.finance.latestForecasts(db, caller.businessId),
        transactions > 0 ? repos.finance.listTransactions(db, caller.businessId, { limit: transactions }) : Promise.resolve({ items: [] }),
      ]);
      const forecast = forecasts.base ?? Object.values(forecasts)[0] ?? null;
      return {
        accounts: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, balanceMinor: a.balanceMinor })),
        categories,
        netBurn: accounts.length > 0 ? { ...burn, label: "Estimate" as const } : null,
        forecast: forecast ? { scenario: forecast.scenario, currency: forecast.currency, createdAt: forecast.createdAt.toISOString(), series: forecast.series, label: "Forecast" as const } : null,
        transactions: page.items.map((t) => ({ id: t.id, bookedAt: t.bookedAt.toISOString(), amountMinor: t.amountMinor, currency: t.currency, counterparty: t.counterparty, description: t.description, category: t.category })),
      };
    },
    async readLegal(caller) {
      const [entity, deadlines, contracts] = await Promise.all([repos.legal.primaryEntity(db, caller.businessId), repos.legal.upcomingDeadlines(db, caller.businessId, PLATFORM_DEADLINE_DAYS, now()), repos.legal.listContracts(db, caller.businessId, { limit: 100 })]);
      const due = [
        ...deadlines.filings.map((f) => ({ id: f.id, kind: "filing" as const, title: f.title || f.kind, dueAt: f.dueAt ? f.dueAt.toISOString() : null, status: f.status })),
        ...deadlines.compliance.map((c) => ({ id: c.id, kind: "compliance" as const, title: c.title || c.kind, dueAt: c.dueAt.toISOString(), status: c.completedAt ? "done" : "pending" })),
      ].sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
      return {
        entity: entity ? { id: entity.id, name: entity.legalName, jurisdiction: entity.jurisdiction, status: entity.status } : null,
        deadlines: due,
        contracts: contracts.items.map((c) => ({ id: c.id, title: c.title || c.kind, status: c.status })),
      };
    },
    async readDistribution(caller) {
      const [channels, campaigns] = await Promise.all([repos.channels.list(db, caller.businessId), repos.campaigns.list(db, caller.businessId, { limit: 100 })]);
      const keyOf = new Map(channels.map((c) => [c.id, c.channelKey]));
      return {
        channels: channels.map((c) => ({ id: c.id, key: c.channelKey, enabled: c.enabled, budgetMinor: c.budgetMinor, currency: c.currency, offlineTracking: c.kitMode })),
        campaigns: campaigns.items.map((c) => ({ id: c.id, name: c.name, channelKey: keyOf.get(c.channelId) ?? null, status: c.status })),
      };
    },
  };

  // Errors the agent can act on pass through; anything else (a database fault) is logged without its parameters.
  const guarded = {} as Record<keyof PlatformHost, unknown>;
  for (const [name, fn] of Object.entries(host) as [keyof PlatformHost, (...a: unknown[]) => Promise<unknown>][]) {
    guarded[name] = async (...args: unknown[]) => {
      try {
        return await fn(...args);
      } catch (e) {
        if (e instanceof AppError) throw e;
        log.error({ err: safeError(e), method: name }, "platform tool failed");
        throw new AppError("platform_unavailable", "The platform could not answer this call; try again shortly", 503);
      }
    };
  }
  return guarded as unknown as PlatformHost;
}
