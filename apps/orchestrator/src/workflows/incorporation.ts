/**
 * incorporation (BUILD §9.4, §11.11): Atlas / Companies House / filing pack as a supervised session. The squad prepares the
 * documents and asks the founder to review; filing in the founder's name is a hard gate, so the workflow waits for the
 * `founderSubmit` signal (the founder took over the browser session and submitted) before recording the filing.
 */
import { allHandlersFinished, condition, proxyActivities, setHandler, workflowInfo } from "@temporalio/workflow";
import type { Activities, IncorporationInput } from "../activities";
import { founderSubmitSignal, stopSignal, type FounderSubmitPayload } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 3 } });

export interface IncorporationResult {
  incorporationId: string;
  status: string;
  submittedBy: string | null;
}

export async function incorporation(input: IncorporationInput): Promise<IncorporationResult> {
  const info = workflowInfo();
  const state: { founder: FounderSubmitPayload | null; stopped: string | null } = { founder: null, stopped: null };
  setHandler(founderSubmitSignal, (p) => {
    if (!state.founder || state.founder.kind === "takeover") state.founder = p;
  });
  setHandler(stopSignal, (s) => {
    state.stopped = s?.reason ?? "stopped";
  });

  await acts.incorporationStep({ businessId: input.businessId, incorporationId: input.incorporationId, step: "prepare_documents", workflowId: info.workflowId });
  await acts.incorporationStep({ businessId: input.businessId, incorporationId: input.incorporationId, step: "founder_review", workflowId: info.workflowId });

  // Wait for the founder: submitted (continue), cancel (abandon) or stop. No timeout: the pack waits.
  await condition(() => (state.founder !== null && state.founder.kind !== "takeover") || state.stopped !== null);
  const f = state.founder;
  if (state.stopped || !f || f.kind === "cancel") {
    await acts.abandonIncorporation({ businessId: input.businessId, incorporationId: input.incorporationId, reason: state.stopped ?? "cancelled by the founder" });
    await condition(allHandlersFinished);
    return { incorporationId: input.incorporationId, status: "abandoned", submittedBy: null };
  }
  await acts.incorporationStep({ businessId: input.businessId, incorporationId: input.incorporationId, step: "founder_submits", workflowId: info.workflowId, founderPayload: f.payload ?? null });
  await acts.incorporationStep({ businessId: input.businessId, incorporationId: input.incorporationId, step: "record_filing", workflowId: info.workflowId, founderPayload: f.payload ?? null });
  const done = await acts.incorporationStep({ businessId: input.businessId, incorporationId: input.incorporationId, step: "complete", workflowId: info.workflowId });
  await condition(allHandlersFinished);
  return { incorporationId: input.incorporationId, status: done.status, submittedBy: f.by ?? null };
}
