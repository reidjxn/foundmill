"use client";
/**
 * Home's Autopilot chip (business.autopilot.get): On, Waiting for you, Paused: reason or Off, with the next planned cycle
 * (an Estimate) and one plain sentence as its tooltip. It opens Settings › Mode. When Autopilot is on and not paused it
 * also asks the API to make sure its workflow is running (`business.autopilot.ensure`, idempotent), so an Autopilot
 * saved while the orchestrator was down begins as soon as it is back.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AutopilotChip } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";

/** Roles that may start work; the API refuses the nudge for the rest. */
const CAN_ENSURE = new Set(["owner", "admin", "member"]);

export function HomeAutopilot() {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const router = useRouter();
  const q = useQuery(trpc.business.autopilot.get.queryOptions({ businessId }, { staleTime: 15_000, retry: false }));
  const ensure = useMutation(trpc.business.autopilot.ensure.mutationOptions());
  const running = q.data?.enabled === true && q.data.pausedReason === null;
  const { mutate } = ensure;
  useEffect(() => {
    if (running && CAN_ENSURE.has(data.role)) mutate({ businessId });
  }, [running, data.role, businessId, mutate]);
  if (!q.data) return null;
  const s = q.data;
  return (
    <div className="flex items-center" data-testid="home-autopilot">
      <AutopilotChip state={s.state} label={s.label} detail={s.detail} nextAt={s.nextAt} onClick={() => router.push(routes.settings(businessId, "mode"))} />
    </div>
  );
}
