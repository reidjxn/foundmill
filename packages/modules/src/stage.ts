/**
 * The product stage of a business (founder, 2026-10-18), as `business.get` reports it: drafting → awaiting the
 * founder's sign-off → building → selling. Read by the Development and Distribution screens through the shell's
 * cached `business.get` query (`useWidgetQuery`), never computed here.
 */
import type { ProductStage } from "@foundmill/shared";
import { useWidgetQuery } from "@foundmill/widgets/data";

export interface BusinessStageResponse {
  role?: string;
  productStage?: ProductStage;
  distributionStartedAt?: string | Date | null;
  business?: { id: string; name: string };
  /** Whether the orchestrator, the service that runs the team's work, can be reached (null: not known yet). */
  orchestrator?: { reachable: boolean | null } | null;
}

const BUSINESS_INPUT: Record<string, unknown> = {};

/** The stage, the role and whether distribution has started, from the shell's `business.get`. */
export function useBusinessStage() {
  const q = useWidgetQuery<BusinessStageResponse>("business.get", BUSINESS_INPUT);
  const data = q.data;
  return {
    ...q,
    stage: data?.productStage ?? null,
    role: data?.role ?? null,
    distributionStarted: data ? data.distributionStartedAt !== null && data.distributionStartedAt !== undefined : null,
    /** Owners and admins start distribution (the api refuses anyone else). */
    canStartDistribution: data?.role === "owner" || data?.role === "admin",
    /**
     * The orchestrator is known to be unreachable (first-time founder report, Nov 8, 2026): nothing can start a task or
     * run a cycle, so the screens say so instead of offering a Start that is refused. Unknown reads as fine.
     */
    orchestratorDown: data?.orchestrator?.reachable === false,
  };
}
