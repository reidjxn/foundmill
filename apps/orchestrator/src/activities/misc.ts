/**
 * Smaller activity groups: playbooks (founder-defined workflows), incorporation (supervised browser session with
 * founder takeover) and Door B business import (sources read through the gateway; nothing scraped directly).
 */
import { repos } from "@foundmill/db";
import { hasImportConnector, importCallFor, uuid } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import type { ImportSourceResult, LoadedPlaybook } from "./types";

export const INCORPORATION_STEPS = ["prepare_documents", "founder_review", "founder_submits", "record_filing", "complete"] as const;
export type IncorporationStep = (typeof INCORPORATION_STEPS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a connector read, in numbers only ("12 entries"): the first list in the answer. The content itself is
 * third-party text and stays with the gateway's envelope; nothing from it is copied into a source row.
 */
export function describeRead(data: unknown): string | null {
  const body = data && typeof data === "object" && "content" in data && (data as { untrusted?: unknown }).untrusted === true ? (data as { content: unknown }).content : data;
  if (!body || typeof body !== "object") return null;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (Array.isArray(value)) return `${value.length} ${key.replace(/([A-Z])/g, " $1").toLowerCase()}`;
  }
  return null;
}

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

    /**
     * Who may move an incorporation past the founder's hard gate (audit ARB-01): the `founderSubmit` signal names its
     * sender, and only an owner or admin of this business counts. apps/api already refuses anyone else; this keeps a
     * signal from any other source (another business, a forged client) from filing in the founder's name.
     */
    async verifyIncorporationSubmitter(input: { businessId: string; incorporationId: string; userId: string | null }): Promise<{ ok: boolean; reason: string | null }> {
      if (!input.userId || !UUID_RE.test(input.userId)) return { ok: false, reason: "the signal names no sender" };
      await repos.legal.getIncorporation(deps.db, input.businessId, input.incorporationId); // NotFound when it is not this business's
      const ok = await repos.memberships.hasRole(deps.db, input.businessId, input.userId, ["owner", "admin"]);
      return ok ? { ok: true, reason: null } : { ok: false, reason: "the sender is not an owner or admin of this business" };
    },

    async abandonIncorporation(input: { businessId: string; incorporationId: string; reason: string }): Promise<void> {
      const inc = await repos.legal.getIncorporation(deps.db, input.businessId, input.incorporationId);
      if (inc.status === "complete") return;
      await repos.legal.updateIncorporation(deps.db, input.businessId, inc.id, { status: "abandoned", steps: [...((inc.steps as unknown[]) ?? []), { step: "abandoned", at: deps.clock.now().toISOString(), note: input.reason }] });
    },

    // ---- Door B import ---------------------------------------------------------------------------------------------
    /**
     * Import one source through the gateway (code host, Drive, Notion, site, Stripe, Shopify, bank, registry). The source
     * says what it is (`relevance.import.key` and `.value`, written by the api from the same table, `importCallFor`),
     * so each connector tool gets its own arguments. A source counts as imported only when the tool itself answered
     * `ok`: the policy outcome alone ("allow") says the call was permitted, not that anything was read. Every outcome
     * is written to the source row (imported or not, and why), so the import job always reaches a terminal state.
     * Untrusted content stays in the gateway's envelope: only counts of what was read are kept here.
     */
    async importSource(input: { businessId: string; sourceId: string }): Promise<ImportSourceResult> {
      const { db } = deps;
      const source = await repos.product.getSource(db, input.businessId, input.sourceId);
      const relevance = (source.relevance ?? {}) as Record<string, unknown>;
      const spec = (relevance.import ?? {}) as { key?: unknown; value?: unknown };
      const record = async (imported: boolean, summary: string, extra: Record<string, unknown> = {}): Promise<ImportSourceResult> => {
        const now = deps.clock.now();
        await repos.product.updateSource(db, input.businessId, source.id, { ...(imported ? { fetchedAt: now } : {}), relevance: { ...relevance, imported, ...(imported ? {} : { reason: summary }), finishedAt: now.toISOString(), untrusted: true, ...extra } });
        return { sourceId: source.id, ok: imported, summary };
      };
      const call = typeof spec.key === "string" ? importCallFor(spec.key, typeof spec.value === "string" ? spec.value : "") : null;
      if (!call) return record(false, typeof spec.key === "string" && !hasImportConnector(spec.key) ? "no connector reads this source yet" : "the source's details do not fit its connector");
      const chief = await repos.agents.chiefOfStaff(db, input.businessId);
      if (!chief) return record(false, "no Chief of Staff to import as");
      const { connector, tool } = call;
      try {
        const minted = await deps.gateway.mintSessionToken({ businessId: input.businessId, agentId: chief.id, sessionId: uuid(), allowedTools: [`${connector}:${tool}`], ttlSeconds: 300 });
        const res = await deps.gateway.call(minted.token, { connector, tool, args: call.args });
        if (res.outcome !== "allow") return record(false, `the gateway did not allow the read (${res.outcome})`, { outcome: res.outcome, connector, tool });
        const result = (res.result ?? {}) as { ok?: unknown; error?: { code?: unknown; message?: unknown }; data?: unknown; content?: unknown };
        if (result.ok !== true) {
          const message = typeof result.error?.message === "string" ? result.error.message : typeof result.error?.code === "string" ? result.error.code : "the connector did not return the content";
          return record(false, `${connector}.${tool} failed: ${message}`.slice(0, 300), { outcome: res.outcome, connector, tool });
        }
        const read = describeRead(result.data ?? result.content);
        return record(true, `imported through ${connector}.${tool}${read ? `: ${read}` : ""}`, { outcome: res.outcome, connector, tool, ...(read ? { read } : {}) });
      } catch (err) {
        return record(false, `gateway error: ${(err as Error).message}`.slice(0, 300), { connector, tool });
      }
    },

    /** The import workflow could not run a source at all (its activity failed for good, or the run was stopped): the row says so. */
    async failImportSource(input: { businessId: string; sourceId: string; reason: string }): Promise<void> {
      const source = await repos.product.getSource(deps.db, input.businessId, input.sourceId);
      const relevance = (source.relevance ?? {}) as Record<string, unknown>;
      if (relevance.imported === true || relevance.imported === false) return;
      await repos.product.updateSource(deps.db, input.businessId, source.id, { relevance: { ...relevance, imported: false, reason: input.reason.slice(0, 300), finishedAt: deps.clock.now().toISOString() } });
    },

    async finishImport(input: { businessId: string; results: ImportSourceResult[] }): Promise<{ inboxItemId: string | null }> {
      const chief = await repos.agents.chiefOfStaff(deps.db, input.businessId);
      const ok = input.results.filter((r) => r.ok).length;
      await repos.audit.append(deps.db, input.businessId, { actorKind: "system", action: "import.finish", target: {}, details: { sources: input.results.length, ok } });
      if (!chief) return { inboxItemId: null };
      const item = await repos.inbox.createItem(deps.db, input.businessId, { type: "update", from_agent_id: chief.id, subject: `Import finished: ${ok} of ${input.results.length} sources`, body_md: input.results.map((r) => `- ${r.ok ? "✓" : "✗"} ${r.summary}`).join("\n") || "No sources to import.", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] });
      return { inboxItemId: item.id };
    },

    async noteWorkflowFailure(input: { businessId: string; workflow: string; workflowId: string; error: string }): Promise<void> {
      await repos.audit.append(deps.db, input.businessId, { actorKind: "system", action: `${input.workflow}.failed`, target: { kind: "workflow", id: input.workflowId }, details: { error: input.error.slice(0, 500) } });
    },
  };
}

export type MiscActivities = ReturnType<typeof createMiscActivities>;
export { emitEvent, systemActor };
