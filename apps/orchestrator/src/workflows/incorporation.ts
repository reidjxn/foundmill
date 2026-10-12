/**
 * incorporation (BUILD §9.4, §11.11): Atlas / Companies House / filing pack as a supervised session. The team prepares the
 * documents and asks the founder to review; filing in the founder's name is a hard gate, so the workflow waits for the
 * `founderSubmit` signal (the founder took over the browser session and submitted) before recording the filing.
 *
 * Only an owner or admin of the business moves it past that gate (audit ARB-01): every `submitted` or `cancel` signal is
 * checked against the business's memberships (`verifyIncorporationSubmitter`) and one from anyone else is ignored, so
 * the pack keeps waiting for the real founder. Signals queue, so a refused one never hides a later real one.
 *
 * Versioning: a workflow that reached the founder's gate on the old code (no `INCORPORATION_SUBMITTER_PATCH` marker in
 * its history) finishes on the old, unchecked wait; every new run records the marker and checks the sender.
 */
import { allHandlersFinished, condition, patched, proxyActivities, setHandler, workflowInfo } from "@temporalio/workflow";
import type { Activities, IncorporationInput } from "../activities";
import { founderSubmitSignal, stopSignal, type FounderSubmitPayload } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3 } });

/** The patch id of the checked founder gate (Temporal `patched`). Never rename it: recorded histories carry it. */
export const INCORPORATION_SUBMITTER_PATCH = "incorporation-submitter-checked";

export interface IncorporationResult {
  incorporationId: string;
  status: string;
  submittedBy: string | null;
}

export async function incorporation(input: IncorporationInput): Promise<IncorporationResult> {
  const info = workflowInfo();
  const state: { founder: FounderSubmitPayload | null; stopped: string | null } = { founder: null, stopped: null };
  /** Every founderSubmit signal in arrival order (the checked gate takes them one by one). */
  const received: FounderSubmitPayload[] = [];
  setHandler(founderSubmitSignal, (p) => {
    received.push(p);
    if (!state.founder || state.founder.kind === "takeover") state.founder = p;
  });
  setHandler(stopSignal, (s) => {
    state.stopped = s?.reason ?? "stopped";
  });

  await acts.incorporationStep({ businessId: input.businessId, incorporationId: input.incorporationId, step: "prepare_documents", workflowId: info.workflowId });
  await acts.incorporationStep({ businessId: input.businessId, incorporationId: input.incorporationId, step: "founder_review", workflowId: info.workflowId });

  // Wait for the founder: submitted (continue), cancel (abandon) or stop. No timeout: the pack waits.
  const f = patched(INCORPORATION_SUBMITTER_PATCH) ? await checkedFounder(input, received, state) : await legacyFounder(state);
  if (state.stopped || !f || f.kind === "cancel") {
    await acts.abandonIncorporation({ businessId: input.businessId, incorporationId: input.incorporationId, reason: state.stopped ?? "canceled by the founder" });
    await condition(allHandlersFinished);
    return { incorporationId: input.incorporationId, status: "abandoned", submittedBy: null };
  }
  await acts.incorporationStep({ businessId: input.businessId, incorporationId: input.incorporationId, step: "founder_submits", workflowId: info.workflowId, founderPayload: f.payload ?? null });
  await acts.incorporationStep({ businessId: input.businessId, incorporationId: input.incorporationId, step: "record_filing", workflowId: info.workflowId, founderPayload: f.payload ?? null });
  const done = await acts.incorporationStep({ businessId: input.businessId, incorporationId: input.incorporationId, step: "complete", workflowId: info.workflowId });
  await condition(allHandlersFinished);
  return { incorporationId: input.incorporationId, status: done.status, submittedBy: f.by ?? null };
}

/** The first `submitted` or `cancel` signal sent by an owner or admin of the business (takeovers only note the session). */
async function checkedFounder(input: IncorporationInput, received: FounderSubmitPayload[], state: { stopped: string | null }): Promise<FounderSubmitPayload | null> {
  for (;;) {
    await condition(() => received.some((p) => p.kind !== "takeover") || state.stopped !== null);
    if (state.stopped) return null;
    const at = received.findIndex((p) => p.kind !== "takeover");
    const next = received.splice(0, at + 1)[at]!;
    const check = await acts.verifyIncorporationSubmitter({ businessId: input.businessId, incorporationId: input.incorporationId, userId: next.by ?? null });
    if (check.ok) return next;
  }
}

/** The wait before the sender check (histories recorded without the patch marker replay through it unchanged). */
async function legacyFounder(state: { founder: FounderSubmitPayload | null; stopped: string | null }): Promise<FounderSubmitPayload | null> {
  await condition(() => (state.founder !== null && state.founder.kind !== "takeover") || state.stopped !== null);
  return state.founder;
}
