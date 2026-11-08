"use client";
/**
 * Home's Autopilot chip (business.autopilot.get): On, Needs your answer, Paused: reason or Off, with the next planned cycle
 * (an Estimate) and one plain sentence as its tooltip; in guided mode one sentence beside it says what Autopilot does
 * and never does (UX plan B16, `AutopilotChip`'s `guide`). It opens Settings › What the team can do. When Autopilot is on and not paused it
 * also asks the API to make sure its workflow is running (`business.autopilot.ensure`, idempotent), so an Autopilot
 * saved while the orchestrator was down begins as soon as it is back. It asks once per business per browser session,
 * not on every Home visit (audit WEB-3).
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

/** Businesses this page already asked about (or is asking about); sessionStorage carries it across reloads of the tab. */
const ensured = new Set<string>();
const ensuredKey = (businessId: string) => `autopilot-ensured:${businessId}`;

function sessionStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function alreadyEnsured(businessId: string): boolean {
  if (ensured.has(businessId)) return true;
  try {
    return sessionStore()?.getItem(ensuredKey(businessId)) === "1";
  } catch {
    return false;
  }
}

function rememberEnsured(businessId: string): void {
  try {
    sessionStore()?.setItem(ensuredKey(businessId), "1");
  } catch {
    // Storage refused (private window): this page still remembers it.
  }
}

export function HomeAutopilot() {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const router = useRouter();
  const q = useQuery(trpc.business.autopilot.get.queryOptions({ businessId }, { staleTime: 15_000, retry: false }));
  // A failed nudge is forgotten, so the next Home visit asks again.
  const ensure = useMutation(trpc.business.autopilot.ensure.mutationOptions({ onSuccess: (_r, input) => rememberEnsured(input.businessId), onError: (_e, input) => void ensured.delete(input.businessId) }));
  const running = q.data?.enabled === true && q.data.pausedReason === null;
  const { mutate } = ensure;
  useEffect(() => {
    if (!running || !CAN_ENSURE.has(data.role) || alreadyEnsured(businessId)) return;
    ensured.add(businessId);
    mutate({ businessId });
  }, [running, data.role, businessId, mutate]);
  if (!q.data) return null;
  const s = q.data;
  return (
    <div className="flex items-center" data-testid="home-autopilot">
      <AutopilotChip state={s.state} label={s.label} detail={s.detail} nextAt={s.nextAt} guide onClick={() => router.push(routes.settings(businessId, "mode"))} />
    </div>
  );
}
