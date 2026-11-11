"use client";
/**
 * Today, the business's front door (founder, 2026-11-07; DESIGN §9 "Today"): the goal, what needs the founder, the week
 * in plain sentences and four health figures, under the same blocker, foundations and goal check as Details.
 *
 * 0. Your first week (`today.get` › `firstWeek`): Day 1, Days 2–3 and Week 1, only in a business's first days.
 * 1. Your goal (`goal.current`): the active goal with its progress bar and pace sentence, the Chief of Staff's proposal
 *    with Approve this goal (one tap, `goal.approve`) and Change it (`goal.requestChange`), or the waiting line.
 * 2. Needs you (`today.get`): up to three notes of the Inbox's Needs you tab, one tap only where it needs no plan
 *    compiler (`inbox.decide` with the note's own option), Open for the rest, "See all in the Inbox".
 * 3. This week and next (`today.get`): three to five sentences from data.
 * 3a. The public page (`today.get` › `pageReady`): one quiet line to Product › Public page while the project has no
 *     page live (never for a sample business).
 * 4. Health: Cash, Runway and Customers this week are the status strip's own tiles over the same reads
 *    (`finance.overview`, `journey.ribbon`), so they always match Details; then the week's spend, never added across
 *    currencies (AI usage in US dollars, channel spend in the business's currency; one figure for a dollar business).
 *
 * The tab bar is Today | Details. `goal.ensure` runs once per visit (lead.tsx).
 */
import { emptyWhy } from "@foundmill/shared/empty-why";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { FirstWeekTimeline, GoalPanel, NeedsYouList, PageGrid, Panel, PublicPageNote, StatusStrip, Term, WeekPlan, useAgentPersona, useToast, type MetricTileProps, type NeedsYouRow } from "@foundmill/dugout";
import { cashTile, customersWeekTile, moduleHref, moduleTabHref, routes, runwayTile, spendWeekTiles, unavailableTile, type StatusTile } from "@foundmill/widgets";
import type { FinanceOverview, RibbonResponse } from "@foundmill/widgets/shared/types";
import { useGlossary, useToday } from "@foundmill/widgets/data";
import { recentRibbonInput } from "@foundmill/widgets/shared/ribbon";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { shellPollIntervals } from "@/components/shell/BusinessShell";
import { useBusinessLive } from "@/lib/stream-status";
import { GoalEnsure, HomeBlockers, HomeFoundations } from "@/components/home/lead";
import { needsYouHref, toNeedsYouRows, toPanelGoal, toPanelProposal } from "./today-view";

/** The reads a Today answer changes. */
const AFTER_ANSWER = ["inbox", "today", "goal", "plan", "business", "product", "dev"] as const;

export const TODAY_WORDS = {
  title: "Today",
  details: "Details",
  health: "Health",
  noInbox: "Members who can read the Inbox see what needs them here.",
  noWeek: "Members who can read Development see the week here.",
} as const;

export function TodayScreen() {
  const { businessId, data: business, departments } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const today = useToday();
  const g = useGlossary();

  // The stream refetches both on the events that change them (BusinessShell INVALIDATE_ON_EVENT); while the business's
  // channel is not live they poll at the shell's own pace, so a sign-off note drafted after the visit began still arrives.
  const poll = shellPollIntervals(useBusinessLive(businessId)).inbox;
  const goalQ = useQuery(trpc.goal.current.queryOptions({ businessId }, { staleTime: 15_000, refetchInterval: poll }));
  const todayQ = useQuery(trpc.today.get.queryOptions({ businessId }, { staleTime: 15_000, refetchInterval: poll }));
  const financeQ = useQuery(trpc.finance.overview.queryOptions({ businessId }, { staleTime: 60_000, retry: false }));
  const ribbonQ = useQuery(trpc.journey.ribbon.queryOptions({ businessId, ...recentRibbonInput(today) }, { staleTime: 60_000, retry: false }));

  const refresh = useCallback(() => {
    for (const path of AFTER_ANSWER) void queryClient.invalidateQueries({ queryKey: trpcPathPrefix(path) as unknown[] });
  }, [queryClient]);

  // --- the goal ---------------------------------------------------------------------------------------------------
  const approve = useMutation(
    trpc.goal.approve.mutationOptions({
      onSuccess: () => {
        refresh();
        toast({ title: "Goal approved", description: "The team aims every round of work at it.", tone: "good" });
      },
      onError: (err) => toast({ title: "The goal was not approved", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const change = useMutation(trpc.goal.requestChange.mutationOptions({ onSuccess: () => refresh() }));
  const requestChange = useCallback(
    async (goalId: string, notes: string) => {
      try {
        await change.mutateAsync({ businessId, goalId, notes });
        toast({ title: "Goal revised", description: "The revised goal is ready to approve.", tone: "info" });
      } catch (err) {
        // The dialog shows the message ("Say a number or a date, …") and stays open.
        throw new Error(errorMessage(err), { cause: err });
      }
    },
    [change, businessId, toast],
  );
  const chief = todayQ.data?.chiefOfStaff?.name ?? null;
  const active = goalQ.data?.active ? toPanelGoal(goalQ.data.active, today) : null;
  const proposed = goalQ.data?.proposed ? toPanelProposal(goalQ.data.proposed, chief) : null;

  // --- Needs you ------------------------------------------------------------------------------------------------------
  const [pendingId, setPendingId] = useState<string | null>(null);
  const decide = useMutation(
    trpc.inbox.decide.mutationOptions({
      onSettled: () => setPendingId(null),
      onSuccess: () => refresh(),
      onError: (err) => toast({ title: "That answer did not go through", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const onQuickAnswer = useCallback(
    (row: NeedsYouRow) => {
      if (!row.quickOption) return;
      setPendingId(row.id);
      decide.mutate({ businessId, itemId: row.id, chosenOption: row.quickOption.id }, { onSuccess: () => toast({ title: "Answered", description: row.quickOption!.label, tone: "good" }) });
    },
    [decide, businessId, toast],
  );
  const needsYou = todayQ.data?.needsYou;
  // Subjects and senders name agents under the reader's preference, as the Inbox does (One name everywhere).
  const persona = useAgentPersona();
  const roster = useMemo(() => departments.flatMap((d) => [...(d.lead ? [d.lead] : []), ...d.squad]), [departments]);
  const rows = useMemo(() => (needsYou ? toNeedsYouRows(businessId, needsYou.items, { labelFor: persona.labelFor, withNames: persona.withNames, roster }) : []), [businessId, needsYou, persona, roster]);

  // --- health -----------------------------------------------------------------------------------------------------------
  const currency = business.business.currency;
  const tiles = useMemo<MetricTileProps[]>(() => {
    const finance = financeQ.data as unknown as FinanceOverview | undefined;
    const ribbon = ribbonQ.data as unknown as RibbonResponse | undefined;
    const openFinance = () => router.push(moduleHref(businessId, departments, "finance") ?? routes.settings(businessId, "integrations"));
    const openCustomers = () => router.push(routes.crm(businessId));
    // The tiles read an error's message and code ("No access", "Couldn't load"), as the status strip does.
    const financeError = !finance ? ((financeQ.error as unknown as Error | null) ?? null) : null;
    const ribbonError = !ribbon ? ((ribbonQ.error as unknown as Error | null) ?? null) : null;
    const list: StatusTile[] = [
      financeError ? unavailableTile("Cash", financeError, "Finance", openFinance) : cashTile(finance, financeQ.isLoading, currency, openFinance),
      financeError ? unavailableTile("Runway", financeError, "Finance", openFinance, "runway") : runwayTile(finance, financeQ.isLoading, openFinance),
      ribbonError ? unavailableTile("Customers this week", ribbonError, "The Journey", openCustomers) : customersWeekTile(ribbon, ribbonQ.isLoading, today, openCustomers),
      ...spendWeekTiles(todayQ.data?.spend, todayQ.isLoading, openFinance),
    ];
    // Labels, captions and plain lines in the business's words; a defined term's label becomes a `Term`.
    return list.map(({ termId, ...t }) => {
      const label = typeof t.label === "string" ? g(t.label) : t.label;
      return {
        ...t,
        label: termId ? (
          <Term id={termId} className="relative z-10">
            {label}
          </Term>
        ) : (
          label
        ),
        caption: typeof t.caption === "string" ? g(t.caption) : t.caption,
        plain: typeof t.plain === "string" ? g(t.plain) : t.plain,
      };
    });
  }, [financeQ.data, financeQ.error, financeQ.isLoading, ribbonQ.data, ribbonQ.error, ribbonQ.isLoading, todayQ.data?.spend, todayQ.isLoading, currency, today, businessId, departments, router, g]);

  // --- chrome -----------------------------------------------------------------------------------------------------------
  const tabs = useMemo(
    () => [
      { id: "today", label: TODAY_WORDS.title, href: routes.today(businessId) },
      { id: "details", label: TODAY_WORDS.details, href: routes.home(businessId) },
    ],
    [businessId],
  );
  useShellChrome({ title: TODAY_WORDS.title, tabs: { tabs, activeId: "today", onChange: (id) => router.push(id === "details" ? routes.home(businessId) : routes.today(businessId)), "aria-label": "Today and Details" } }, [tabs, businessId]);

  const week = todayQ.data?.week;
  // "Your first week": the API answers it only while the business is in its first days and not yet selling (packages/shared first-week.ts).
  const firstWeek = todayQ.data?.firstWeek ?? null;
  return (
    <div className="flex min-h-full flex-col gap-gutter p-gutter" data-testid="today-screen">
      <HomeBlockers />
      <GoalEnsure />
      <HomeFoundations />
      <PageGrid flush>
        {firstWeek ? <FirstWeekTimeline span={12} steps={firstWeek.steps} paused={firstWeek.paused} /> : null}
        <GoalPanel
          span={6}
          active={active}
          proposed={proposed}
          canDecide={goalQ.data?.canDecide ?? false}
          loading={goalQ.isLoading}
          error={goalQ.error && !goalQ.data ? errorMessage(goalQ.error) : undefined}
          onRetry={() => void goalQ.refetch()}
          onApprove={(goalId) => approve.mutate({ businessId, goalId })}
          approving={approve.isPending}
          onRequestChange={requestChange}
        />
        <NeedsYouList
          span={6}
          items={rows}
          total={needsYou?.total ?? 0}
          seeAllHref={needsYouHref(businessId)}
          onQuickAnswer={onQuickAnswer}
          pendingId={pendingId}
          emptyText={todayQ.data && !needsYou ? TODAY_WORDS.noInbox : emptyWhy("today_needs_you", { firstDays: firstWeek !== null }).text}
          loading={todayQ.isLoading}
          error={todayQ.error && !todayQ.data ? errorMessage(todayQ.error) : undefined}
          onRetry={() => void todayQ.refetch()}
        />
        {todayQ.data?.pageReady ? <PublicPageNote span={12} href={moduleTabHref(businessId, departments, "product", "public-page")} /> : null}
        <WeekPlan
          span={12}
          done={week?.done ?? []}
          next={week?.next ?? []}
          empty={todayQ.data && !week ? TODAY_WORDS.noWeek : undefined}
          loading={todayQ.isLoading}
          error={todayQ.error && !todayQ.data ? errorMessage(todayQ.error) : undefined}
          onRetry={() => void todayQ.refetch()}
        />
        <Panel title={TODAY_WORDS.health} span={12} flush data-testid="today-health">
          <StatusStrip tiles={tiles} className="rounded-none border-0" aria-label="Business health" />
        </Panel>
      </PageGrid>
    </div>
  );
}
