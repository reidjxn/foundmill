"use client";
/**
 * Customer Update, the replay of a won customer (BUILD §11.4, DESIGN §8 JourneyStage): `journey.get` → Dugout's
 * JourneyStage with the speed remembered per founder (localStorage), `journey.markViewed` on open, the static summary
 * under reduced motion (the stage does that itself, AC-11.4.5), and a link back to the customer's CRM profile.
 * A Ribbon marker addresses the replay by conversion id; that resolves to the journey here.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Route, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Chip, EmptyState, JourneyStage, Panel, type ReplaySpeed } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets";
import { errorMessage, trpcErrorCode, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { customerFactsFor, entityKindsFor, journeyIdForConversion, nthOfKind, stageAgentMeta, toStageJourney, toStageTouches } from "./mapping";
import { readReplaySpeed, writeReplaySpeed } from "./speed";

export interface JourneyScreenProps {
  journeyId: string;
}

const dayKey = (d: Date | string): string => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);

export function JourneyScreen({ journeyId }: JourneyScreenProps) {
  const { businessId, data, departments } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const userId = data.membership.userId;

  const journeyQ = useQuery(trpc.journey.get.queryOptions({ businessId, journeyId }, { staleTime: 60_000, retry: false }));
  const notFound = journeyQ.error ? trpcErrorCode(journeyQ.error) === "NOT_FOUND" : false;

  // A Ribbon marker links by conversion id (the widget only knows the marker): look the journey up and forward.
  const lookupQ = useQuery(trpc.journey.list.queryOptions({ businessId, limit: 200 }, { enabled: notFound, staleTime: 30_000, retry: false }));
  const forwardTo = useMemo(() => (notFound ? journeyIdForConversion(journeyId, lookupQ.data?.items) : null), [notFound, journeyId, lookupQ.data?.items]);
  useEffect(() => {
    if (forwardTo) router.replace(routes.journey(businessId, forwardTo));
  }, [forwardTo, router, businessId]);

  const row = journeyQ.data ?? null;
  const kickoff = dayKey(data.business.committedAt ?? data.business.createdAt);
  const convertedDay = row ? dayKey(row.conversion.occurredAt) : kickoff;
  const ribbonQ = useQuery(trpc.journey.ribbon.queryOptions({ businessId, from: kickoff, to: convertedDay }, { enabled: !!row, staleTime: 300_000, retry: false }));
  const entityId = row?.entity?.id ?? row?.conversion.entityId ?? null;
  const entityQ = useQuery(trpc.crm.entity.get.queryOptions({ businessId, entityId: entityId ?? businessId }, { enabled: !!entityId, staleTime: 60_000, retry: false }));

  // Viewed once (releases the "Go to Journey" Continue state through the inbox refetch).
  const markViewed = useMutation(trpc.journey.markViewed.mutationOptions({ onSuccess: () => Promise.all(["journey", "inbox"].map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] }))) }));
  const unviewed = !!row && row.viewedAt === null;
  useEffect(() => {
    if (unviewed && !markViewed.isPending && !markViewed.isSuccess) markViewed.mutate({ businessId, journeyId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per journey
  }, [unviewed, businessId, journeyId]);

  // Speed remembered per founder.
  const [speed, setSpeed] = useState<ReplaySpeed>(() => readReplaySpeed(userId));
  const onSpeedChange = useCallback(
    (s: ReplaySpeed) => {
      setSpeed(s);
      writeReplaySpeed(userId, s);
    },
    [userId],
  );

  const touches = useMemo(() => (row ? toStageTouches(row.touches) : []), [row]);
  const nth = useMemo(() => (row ? nthOfKind(row.conversion, ribbonQ.data?.rows, ribbonQ.data?.conversions) : 1), [row, ribbonQ.data]);
  const conversionCount = useMemo(() => (ribbonQ.data ? ribbonQ.data.rows.filter((r) => r.departmentId === null).reduce((s, r) => s + r.payments + r.signups + r.activations, 0) : 0), [ribbonQ.data]);
  const journey = useMemo(() => (row ? toStageJourney(row, touches, { nthOfKind: nth, conversionCount }) : null), [row, touches, nth, conversionCount]);
  const customer = useMemo(() => (row && journey ? customerFactsFor(row, journey, touches, entityQ.data ? { identifiers: entityQ.data.entity.identifiers, roles: entityQ.data.roles as { role?: string | null }[] } : null) : null), [row, journey, touches, entityQ.data]);
  const agents = useMemo(() => (journey ? stageAgentMeta(journey.agents, departments) : []), [journey, departments]);
  const entityKinds = useMemo(() => (row && journey ? entityKindsFor(row, journey.agents) : {}), [row, journey]);

  const title = customer ? `Customer Update · ${customer.name}` : "Customer Update";
  useShellChrome({ title: "Customer Update", breadcrumbs: [{ label: "Inbox", href: routes.inbox(businessId) }, { label: customer?.name ?? "Replay" }] }, [businessId, customer?.name]);

  const openEntity = useCallback((id: string) => router.push(id === entityId || !/^[0-9a-f-]{36}$/i.test(id) ? routes.crm(businessId, entityId ?? id) : departments.some((d) => d.squad.some((a) => a.id === id)) ? routes.agent(businessId, id) : routes.crm(businessId, id)), [router, businessId, entityId, departments]);
  const back = useCallback(() => router.push(routes.inbox(businessId)), [router, businessId]);

  if (journeyQ.error && !notFound) return <ErrorPanel title="Customer Update" message={errorMessage(journeyQ.error)} onRetry={() => void journeyQ.refetch()} />;
  if (notFound && !forwardTo && !lookupQ.isLoading) {
    return (
      <div className="p-gutter" data-testid="journey-not-found">
        <Panel title="Customer Update" span={12}>
          <EmptyState icon={Route} title="No replay for this id" action={{ label: "Back to the Inbox", icon: ArrowLeft, onClick: back }}>
            The replay appears once the win is recorded; Customer Update notes in the Inbox link straight to it.
          </EmptyState>
        </Panel>
      </div>
    );
  }
  if (!row || !journey || !customer || ribbonQ.isLoading) return <ScreenSkeleton />;

  return (
    <div className="flex min-h-full flex-col" data-testid="journey-screen" data-journey-id={row.id} data-conversion-id={row.conversionId} data-speed={speed} data-nth={journey.nthOfKind}>
      <div className="flex flex-wrap items-center gap-2 border-b border-subtle bg-panel px-gutter py-1.5" data-testid="journey-toolbar">
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={back} data-testid="journey-back">
          Inbox
        </Button>
        <span className="text-small text-secondary">{title}</span>
        {ribbonQ.error ? <Chip tone="neutral">Count unavailable</Chip> : null}
        <span className="flex-1" />
        {entityId ? (
          <Button size="sm" variant="default" icon={UserRound} onClick={() => router.push(routes.crm(businessId, entityId))} data-testid="journey-crm-link">
            Open CRM profile
          </Button>
        ) : null}
      </div>
      <JourneyStage
        journey={journey}
        touches={touches}
        customer={customer}
        agents={agents}
        kit={data.kit}
        defaultSpeed={speed}
        speed={speed}
        onSpeedChange={onSpeedChange}
        onOpenEntity={openEntity}
        entityKinds={entityKinds}
        currency={row.conversion.currency}
        onClose={back}
        closeLabel="Back to the Inbox"
        className="flex-1"
      />
    </div>
  );
}
