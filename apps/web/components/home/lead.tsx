"use client";
/**
 * What sits at the top of both of the business's front screens (founder, 2026-11-07): Today and its Details (the
 * dashboards). An account-level blocker (the team could not start), the first-open foundations and the Product
 * Researcher's plan, and the business's goal (`goal.ensure` once per visit). Whichever of the two the founder lands on
 * keeps the foundations, the research plan and the goal moving.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Button, Icon, Panel, StatusPill } from "@foundmill/dugout";
import { FoundationsBanner, useFoundations } from "@foundmill/modules/product/foundations";
import { routes } from "@foundmill/widgets";
import { WRITE_ROLES } from "@foundmill/shared/constants";
import { shellQueryInputs } from "@/lib/shell-queries";
import { trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";

/**
 * The vision, specification and roadmap a new business drafts on its first open (BUILD §11.1, §11.5): drafting (the
 * vision, the sections and the roadmap items as they are written, audit P3), failed with Try again, or just ready with
 * the way to the Vision tab. Nothing once they are settled, or for a business that has none (committed before
 * foundations existed, or seeded). Ready brings the Product lead's note to the Inbox.
 */
export function HomeFoundations() {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const { businessId, data } = useBusiness();
  // The Product Researcher's plan starts as soon as the foundations are ready (the founder's 2026-10-18 request): the
  // front screen asks `product.research.ensure` once per business per visit when they already read ready, and again
  // the moment the drafting turns ready during the visit. Idempotent on the server (one claim per business); the
  // Research tab shows it.
  const ensureResearch = useMutation(
    trpc.product.research.ensure.mutationOptions({
      retry: 1,
      onSuccess: (view) => {
        if (view.started) void queryClient.invalidateQueries({ queryKey: trpc.product.research.get.queryKey({ businessId }) });
      },
    }),
  );
  const ensureFor = ensureResearch.mutate;
  const ensuredFor = useRef<string | null>(null);
  const ensureOnce = useCallback(() => {
    if (ensuredFor.current === businessId) return;
    ensuredFor.current = businessId;
    ensureFor({ businessId });
  }, [businessId, ensureFor]);
  const foundationsStatus = data.foundationsStatus;
  useEffect(() => {
    if (foundationsStatus === "ready") ensureOnce();
  }, [ensureOnce, foundationsStatus]);
  const foundations = useFoundations(() => {
    void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("inbox") as unknown[] });
    void queryClient.invalidateQueries({ queryKey: trpc.business.get.queryKey({ businessId }) });
    ensuredFor.current = null;
    ensureOnce();
  });
  return <FoundationsBanner foundations={foundations} showReady detail={{ vision: true, roadmap: true }} />;
}

/**
 * The business's goal (founder, 2026-11-07: "Your goal"): Today asks `goal.ensure` once per business per visit (Details
 * too), so the Chief of Staff proposes the first goal after the sign-offs and a round of work, marks a reached goal and
 * proposes the next, or proposes a new date for a missed one. Idempotent on the server, which never writes for a reader
 * who cannot; the proposal itself is a note in the Inbox (Needs you) and on Today. Renders nothing.
 */
export function GoalEnsure() {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const { businessId, data } = useBusiness();
  const canWrite = (WRITE_ROLES as readonly string[]).includes(data.role);
  const ensure = useMutation(
    trpc.goal.ensure.mutationOptions({
      retry: 1,
      onSuccess: (view) => {
        void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("goal") as unknown[] });
        if (view.proposedNow || view.achievedNow) {
          void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("inbox") as unknown[] });
          void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("today") as unknown[] });
        }
      },
    }),
  );
  const ensureFor = ensure.mutate;
  const ensuredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!canWrite || ensuredFor.current === businessId) return;
    ensuredFor.current = businessId;
    ensureFor({ businessId });
  }, [businessId, canWrite, ensureFor]);
  return null;
}

/** The PR A name, kept for the Details screen and its tests. */
export const HomeGoalEnsure = GoalEnsure;

/**
 * An account-level blocker at the top of Today and Details (UX plan §5): the last round of work could not start (the
 * model account out of credit, a missing key, an error) and no round has run since. A one-line note in the Inbox was not
 * enough: Home read "Healthy" over three days of nothing starting (Nov 1, 2026). Gone the moment a cycle runs again.
 */
export function HomeBlockers() {
  const trpc = useTRPC();
  const router = useRouter();
  const { businessId } = useBusiness();
  const inputs = useMemo(() => shellQueryInputs(businessId), [businessId]);
  const cycleQ = useQuery(trpc.cycle.status.queryOptions(inputs.cycle, { staleTime: 10_000, retry: false }));
  const failure = cycleQ.data?.lastOutcome === "failed" && !cycleQ.data.running ? cycleQ.data.lastFailure : null;
  if (!failure) return null;
  const title = failure.kind === "billing" ? "The team's model account is out of credit" : failure.kind === "credential" ? "The team has no model key to work with" : "The team's last round of work could not start";
  const keys = failure.kind === "billing" || failure.kind === "credential";
  return (
    <Panel title={title} span={12} data-testid="home-blocker" data-blocker-kind={failure.kind} actions={<StatusPill tone="bad">Team stopped</StatusPill>}>
      <div role="status" aria-live="polite" className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0" aria-hidden>
          <Icon icon={CircleX} size={20} className="text-status-bad" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-body text-pretty text-primary">{failure.message}</p>
          <p className="text-small text-secondary">{keys ? "Nothing runs until this is fixed. Once it is, press Continue and the team picks up where it stopped." : "Press Continue to try again."}</p>
          {keys ? (
            <div>
              <Button size="sm" variant="default" onClick={() => router.push(routes.settings(businessId, "keys"))}>
                Open Settings › Keys
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
