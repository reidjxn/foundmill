/**
 * Smaller activity groups: playbooks (founder-defined workflows), incorporation (supervised browser session with
 * founder takeover) and Door B business import (sources read through the gateway; nothing scraped directly).
 */
import { repos, type Source } from "@foundmill/db";
import { IMPORT_READERS, uuid } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { GatewayCallResponse } from "../gateway-client";
import type { ImportSourceResult, LoadedPlaybook } from "./types";

export const INCORPORATION_STEPS = ["prepare_documents", "founder_review", "founder_submits", "record_filing", "complete"] as const;
export type IncorporationStep = (typeof INCORPORATION_STEPS)[number];

export function createMiscActivities(deps: OrchestratorDeps) {
  return {
    // ---- playbooks ------------------------------------------------------------------------------------------------
    async loadPlaybook(input: { businessId: string; playbookId: string }): Promise<LoadedPlaybook> {
      const playbook = await repos.playbooks.get(deps.db, input.businessId, input.playbookId);
      const compiled = playbook.compiled as { steps?: unknown; stop?: unknown };
      return { playbookId: playbook.id, enabled: playbook.enabled && !playbook.archivedAt, steps: Array.isArray(compiled.steps) ? (compiled.steps as Record<string, unknown>[]) : [], stop: typeof compiled.stop === "object" && compiled.stop ? (compiled.stop as Record<string, unknown>) : {}, departmentId: playbook.departmentId };
    },

    /** Compile a playbook step into a plan (one action) so the plan executor's typed handlers and policy apply. */
    async playbookStepToPlan(input: { businessId: string; playbookId: string; step: Record<string, unknown>; event: { type: string; payload?: Record<string, unknown> } | null }): Promise<{ planId: string | null; actionIds: string[] }> {
      const action = (input.step.action ?? input.step) as { type?: unknown; params?: unknown; agent_id?: unknown };
      if (typeof action.type !== "string") return { planId: null, actionIds: [] };
      const params = typeof action.params === "object" && action.params ? { ...(action.params as Record<string, unknown>) } : {};
      if (input.event) params.trigger_event = { type: input.event.type, ...(input.event.payload ?? {}) };
      const plan = await repos.plans.create(deps.db, input.businessId, { origin: "playbook", summaryMd: `Playbook step: ${action.type}`, playbookId: input.playbookId, status: "executing", actions: [{ type: action.type as never, params, agentId: typeof action.agent_id === "string" ? action.agent_id : null }] });
      return { planId: plan.id, actionIds: plan.actions.map((a) => a.id) };
    },

    /** Stop conditions: `{ "max_runs": n }`, `{ "until": iso }`, `{ "event": "payment.received" }` (fires when seen since the run started). */
    async playbookShouldStop(input: { businessId: string; playbookId: string; stop: Record<string, unknown>; startedAt: string; runsSoFar: number }): Promise<{ stop: boolean; reason: string | null }> {
      if (typeof input.stop.max_runs === "number" && input.runsSoFar >= input.stop.max_runs) return { stop: true, reason: `max_runs ${input.stop.max_runs} reached` };
      if (typeof input.stop.until === "string" && new Date(input.stop.until).getTime() <= deps.clock.nowMs()) return { stop: true, reason: "until reached" };
      if (typeof input.stop.event === "string") {
        const page = await repos.events.list(deps.db, input.businessId, { type: input.stop.event as never, from: new Date(input.startedAt), limit: 1 });
        if (page.items.length) return { stop: true, reason: `event ${input.stop.event} seen` };
      }
      return { stop: false, reason: null };
    },

    async markPlaybookRun(input: { businessId: string; playbookId: string }): Promise<void> {
      await repos.playbooks.markRun(deps.db, input.businessId, input.playbookId, deps.clock.now());
    },

    // ---- incorporation --------------------------------------------------------------------------------------------
    /**
     * One step of the supervised incorporation (BUILD §11.11). The squad prepares the documents and the filing pack; filing with
     * the founder's identity is a hard gate: the founder submits (founderSubmit signal) and the step records it.
     */
    async incorporationStep(input: { businessId: string; incorporationId: string; step: IncorporationStep; workflowId: string; founderPayload?: Record<string, unknown> | null }): Promise<{ status: string; note: string }> {
      const { db } = deps;
      const inc = await repos.legal.getIncorporation(db, input.businessId, input.incorporationId);
      const steps = Array.isArray(inc.steps) ? [...(inc.steps as Record<string, unknown>[])] : [];
      const push = (note: string, extra: Record<string, unknown> = {}) => steps.push({ step: input.step, at: deps.clock.now().toISOString(), note, ...extra });
      switch (input.step) {
        case "prepare_documents": {
          push(`Prepared the ${inc.route.replace(/_/g, " ")} document set from the business profile (drafts; nothing filed).`);
          await repos.legal.updateIncorporation(db, input.businessId, inc.id, { status: "in_progress", steps, workflowId: input.workflowId });
          return { status: "in_progress", note: "documents prepared" };
        }
        case "founder_review": {
          const chief = await repos.agents.chiefOfStaff(db, input.businessId);
          if (chief) {
            await repos.inbox.createItem(db, input.businessId, { type: "decision", from_agent_id: chief.id, subject: "Incorporation pack ready for your review", body_md: `The ${inc.route.replace(/_/g, " ")} pack is prepared. Review the documents, then submit the filing yourself: filing in your name is a hard gate the team never performs. The browser session stays supervised until you take over.`, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: { options: [{ id: "review", label: "Open the pack and submit", recommended: true, consequence: "You take over the browser session and file", cost_minor: 0, reversible: true }, { id: "later", label: "Not now", recommended: false, consequence: "The pack waits; nothing is filed", cost_minor: 0, reversible: true }], free_text: true, expires_at: null }, blocks_continue: false, source_event_ids: [], entity_ids: [] });
          }
          push("Asked the founder to review and submit.");
          await repos.legal.updateIncorporation(db, input.businessId, inc.id, { status: "awaiting_founder", steps, browserSessionId: `supervised:${uuid()}` });
          return { status: "awaiting_founder", note: "awaiting founder" };
        }
        case "founder_submits": {
          push("The founder submitted the filing in the supervised session.", { payload: input.founderPayload ?? {} });
          await repos.legal.updateIncorporation(db, input.businessId, inc.id, { status: "submitted", steps });
          return { status: "submitted", note: "submitted by the founder" };
        }
        case "record_filing": {
          await repos.legal.createFiling(db, input.businessId, { legalEntityId: inc.legalEntityId, kind: "incorporation", title: `Incorporation via ${inc.route}`, status: "filed", ref: typeof input.founderPayload?.reference === "string" ? input.founderPayload.reference : null });
          push("Filing recorded.");
          await repos.legal.updateIncorporation(db, input.businessId, inc.id, { steps });
          return { status: "submitted", note: "filing recorded" };
        }
        case "complete": {
          push("Incorporation complete.");
          await repos.legal.updateIncorporation(db, input.businessId, inc.id, { status: "complete", steps });
          await repos.audit.append(db, input.businessId, { actorKind: "system", action: "incorporation.complete", target: { kind: "incorporation", id: inc.id }, details: { route: inc.route } });
          return { status: "complete", note: "complete" };
        }
      }
    },

    async abandonIncorporation(input: { businessId: string; incorporationId: string; reason: string }): Promise<void> {
      const inc = await repos.legal.getIncorporation(deps.db, input.businessId, input.incorporationId);
      if (inc.status === "complete") return;
      await repos.legal.updateIncorporation(deps.db, input.businessId, inc.id, { status: "abandoned", steps: [...((inc.steps as unknown[]) ?? []), { step: "abandoned", at: deps.clock.now().toISOString(), note: input.reason }] });
    },

    // ---- Door B import ---------------------------------------------------------------------------------------------
    /**
     * Read one import source through the gateway with the one read-only call its key names (`IMPORT_READERS`, shared
     * with apps/api), and record on the row what was read or why it was not (`relevance.imported`, `reason`,
     * `import.status` read | failed). A source with no reader, a connection the gateway refuses or a call that fails is
     * recorded as not read: nothing is ever marked imported that the gateway did not return. Untrusted content stays
     * wrapped (only the outcome is stored).
     */
    async importSource(input: { businessId: string; sourceId: string }): Promise<ImportSourceResult> {
      const { db } = deps;
      const source = await repos.product.getSource(db, input.businessId, input.sourceId);
      const relevance = (source.relevance ?? {}) as Record<string, unknown>;
      const meta = (typeof relevance.import === "object" && relevance.import ? relevance.import : {}) as Record<string, unknown>;
      const call = importCall(meta, source.uri ?? "", source.title);
      const record = (outcome: ImportReadOutcome, details: Record<string, unknown> = {}) => recordImportRead(db, input.businessId, source, outcome, { ...details, ...(outcome.ok ? { fetchedAt: deps.clock.now() } : {}) });
      if (!call) return record({ ok: false, reason: "the import has no reader for this source yet" });
      const chief = await repos.agents.chiefOfStaff(db, input.businessId);
      if (!chief) return record({ ok: false, reason: "there is no Chief of Staff to read it as" });
      const via = { connector: call.connector, tool: call.tool };
      try {
        const minted = await deps.gateway.mintSessionToken({ businessId: input.businessId, agentId: chief.id, sessionId: uuid(), allowedTools: [`${call.connector}:${call.tool}`], ttlSeconds: 300 });
        const res = await deps.gateway.call(minted.token, { connector: call.connector, tool: call.tool, args: call.args });
        return record(readOutcome(res, via), { outcome: res.outcome, untrusted: true });
      } catch (err) {
        return record({ ok: false, reason: gatewayErrorReason(err), ...via });
      }
    },

    /**
     * The import's Inbox note: how many sources were read, each one's outcome, and what to do about the ones that were
     * not (connect them, then Read now in Product › Sources). A source whose read never recorded an outcome (the activity
     * itself failed) is marked not read here, so no row stays "not read yet" after the workflow has finished.
     */
    async finishImport(input: { businessId: string; results: ImportSourceResult[] }): Promise<{ inboxItemId: string | null }> {
      const results: ImportSourceResult[] = [];
      for (const r of input.results) {
        const row = r.ok ? null : await repos.product.getSource(deps.db, input.businessId, r.sourceId).catch(() => null);
        const status = ((row?.relevance ?? {}) as { import?: { status?: unknown } }).import?.status;
        // The note then names the source and the reason, like every other line.
        results.push(row && status === "pending" ? await recordImportRead(deps.db, input.businessId, row, { ok: false, reason: `the read did not finish (${r.summary.replace(/^failed: /, "").slice(0, 160)})` }) : r);
      }
      const chief = await repos.agents.chiefOfStaff(deps.db, input.businessId);
      const ok = results.filter((r) => r.ok).length;
      await repos.audit.append(deps.db, input.businessId, { actorKind: "system", action: "import.finish", target: {}, details: { sources: results.length, ok } });
      if (!chief) return { inboxItemId: null };
      const notRead = results.length - ok;
      const body = results.length
        ? `${results.map((r) => `- ${r.summary}`).join("\n")}\n\n${notRead ? "A source that was not read adds nothing to the business yet. Connect it in Settings › Integrations, then choose Read now on it in Product › Sources; the Import report lists it as missing until then." : "Every source was read through the gateway, read only."}`
        : "No sources to import.";
      const item = await repos.inbox.createItem(deps.db, input.businessId, { type: "update", from_agent_id: chief.id, subject: `Import finished: ${ok} of ${results.length} sources read`, body_md: body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] });
      return { inboxItemId: item.id };
    },

    async noteWorkflowFailure(input: { businessId: string; workflow: string; workflowId: string; error: string }): Promise<void> {
      await repos.audit.append(deps.db, input.businessId, { actorKind: "system", action: `${input.workflow}.failed`, target: { kind: "workflow", id: input.workflowId }, details: { error: input.error.slice(0, 500) } });
    },
  };
}

/**
 * The gateway call that reads an import source: the reader its import key names, with that tool's arguments, else (rows
 * written before the key was stored) the reader its URI points at. Null when nothing can read it.
 */
export function importCall(meta: Record<string, unknown>, uri: string, title: string): { connector: string; tool: string; args: Record<string, unknown> } | null {
  const key = typeof meta.key === "string" ? meta.key : /github\.com/.test(uri) ? "github" : /docs\.google|drive\.google/.test(uri) ? "google_drive" : /stripe/.test(uri) ? "stripe" : /companieshouse|opencorporates|bolagsverket/.test(uri) ? "registry" : null;
  const reader = key ? IMPORT_READERS[key] : null;
  if (!key || !reader) return null;
  const value = typeof meta.value === "string" ? meta.value : "";
  switch (key) {
    case "github": {
      const [owner, repo] = (value || uri.replace(/^https?:\/\/github\.com\//, "")).split("/");
      return owner && repo ? { ...reader, args: { owner, repo } } : null;
    }
    case "google_drive":
      return { ...reader, args: { q: "trashed = false", pageSize: 20 } };
    case "notion":
      return { ...reader, args: { query: "", pageSize: 20 } };
    case "registry": {
      const q = value || queryParam(uri, "q") || title;
      return q.length >= 2 ? { ...reader, args: { q } } : null;
    }
    default:
      return { ...reader, args: {} };
  }
}

function queryParam(uri: string, name: string): string {
  try {
    return new URL(uri).searchParams.get(name) ?? "";
  } catch {
    return "";
  }
}

/** What an import read came to: read through a connector's tool, or not read and why (in words the founder can act on). */
export type ImportReadOutcome = { ok: true; connector: string; tool: string } | { ok: false; reason: string; connector?: string; tool?: string };

/**
 * A gateway answer as an import read. `allow` only means the gateway let the call through: the tool's own result can
 * still fail (`result.ok === false`, a vendor error or a repository that does not exist), and that is not a read.
 */
export function readOutcome(res: GatewayCallResponse, via: { connector: string; tool: string }): ImportReadOutcome {
  const why = res.reasons?.length ? ` (${res.reasons.join("; ").slice(0, 160)})` : "";
  switch (res.outcome) {
    case "allow": {
      const result = (typeof res.result === "object" && res.result ? res.result : {}) as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
      if (result.ok !== false) return { ok: true, ...via };
      const message = typeof result.error?.message === "string" && result.error.message ? result.error.message : typeof result.error?.code === "string" ? result.error.code : "no detail given";
      return { ok: false, reason: `the read failed: ${message.slice(0, 200)}`, ...via };
    }
    case "ask":
      return { ok: false, reason: `the gateway asked for an approval first, so nothing was read${why}`, ...via };
    case "rate_limited":
      return { ok: false, reason: "the service's rate limit was reached; try again later", ...via };
    case "deny":
      return { ok: false, reason: `the gateway refused the read${why}`, ...via };
  }
}

/** A gateway that threw: not connected (409), not reachable, or another error; the founder sees the reason. */
export function gatewayErrorReason(err: unknown): string {
  const { code, message } = (err ?? {}) as { code?: unknown; message?: unknown };
  const text = typeof message === "string" ? message.slice(0, 200) : "unknown error";
  if (code === "integration_not_connected") return `${text.replace(/\.$/, "")}; connect it in Settings › Integrations`;
  if (code === "gateway_unreachable") return "the gateway could not be reached";
  return `gateway error: ${text}`;
}

/**
 * Write an import read's outcome on its `sources` row (`relevance.imported`, `connector`/`tool`, `reason` when not read,
 * `import.status` read | failed and its note) and return the result the workflow collects. A stale reason from an
 * earlier attempt is dropped when the read succeeds.
 */
async function recordImportRead(db: OrchestratorDeps["db"], businessId: string, source: Source, outcome: ImportReadOutcome, extra: Record<string, unknown> & { fetchedAt?: Date } = {}): Promise<ImportSourceResult> {
  const { fetchedAt, ...details } = extra;
  const relevance = { ...((source.relevance ?? {}) as Record<string, unknown>) };
  const meta = (typeof relevance.import === "object" && relevance.import ? relevance.import : {}) as Record<string, unknown>;
  delete relevance.reason;
  delete relevance.outcome;
  const note = outcome.ok ? `Read through ${outcome.connector} (${outcome.tool}), read only.` : `Not read: ${outcome.reason}.`;
  const via = outcome.connector ? { connector: outcome.connector, tool: outcome.tool } : {};
  await repos.product.updateSource(db, businessId, source.id, {
    ...(fetchedAt ? { fetchedAt } : {}),
    relevance: { ...relevance, ...details, ...via, ...(outcome.ok ? {} : { reason: outcome.reason }), imported: outcome.ok, import: { ...meta, status: outcome.ok ? "read" : "failed", note } },
  });
  return { sourceId: source.id, ok: outcome.ok, summary: outcome.ok ? `${source.title}: read through ${outcome.connector} (${outcome.tool}), read only` : `${source.title}: not read, ${outcome.reason}` };
}

export type MiscActivities = ReturnType<typeof createMiscActivities>;
export { emitEvent, systemActor };
