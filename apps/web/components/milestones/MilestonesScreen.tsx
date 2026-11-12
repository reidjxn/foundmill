"use client";
/**
 * Milestones (BUILD §11.4 "Trophy cabinet", route /b/[bid]/trophies → /milestones per the product vocabulary): the
 * TrophyCabinet from `journey.ribbon`'s milestones, the timeline of every other milestone, and on LIVE shareable
 * milestone cards with the customer anonymised unless permission is recorded.
 *
 * The project's public page (migration 0087; docs/NETWORK.md F2, F3): under each reached milestone, "Show on your page"
 * and, once shown, a quiet "On your page" with "Hide" and "Copy card link". An owner's or an admin's press, one
 * milestone at a time; nothing becomes public on its own. These controls depend only on the page being published
 * (`page.get`), never on the old Personal and Live setting the share dialog below is tied to. Nothing is counted.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Flag, Gem, Rocket, Trophy } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Panel, StatusPill, Term, Timeline, TrophyCabinet, useToast, useDateFormat, type TimelineEvent, type TrophyCard } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { MILESTONE_SHOW_WORDS, cardUrl } from "@foundmill/shared/project-story";
import { plainWords, plural } from "@/lib/format";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness, useBusinessCurrency } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { useAreaTabBar } from "@/components/shell/useAreaNav";
import { AreaOpening } from "@foundmill/modules/areas";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { RefreshFailedNotice, loadFailed, refreshFailed } from "@/components/shell/QueryStates";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { TIMELINE_KIND_WORD, customersSoFarWords, milestoneForTrophy, otherMilestones, replayRefOf, shareText, trophyCards } from "./milestones";
import { emptyWhy } from "@foundmill/shared/empty-why";
import { revenueIsRecurring } from "@foundmill/shared/constants";

const KIND_ICON = { release: Flag, decision: Gem, incorporation: Rocket, funding: Rocket, launch: Rocket, customer: Trophy, revenue: Trophy, trophy: Trophy } as const;

export function MilestonesScreen() {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const search = useSearchParams();
  const { toast } = useToast();
  const live = data.business.gameMode === "live";
  const currency = useBusinessCurrency();
  // Revenue milestones are Finance's monthly figure, named as Finance names it: MRR only when revenue recurs.
  const recurring = revenueIsRecurring(data.business.archetype);
  const today = new Date().toISOString().slice(0, 10);
  // Milestones come back whole whatever the range; a one-day range keeps the daily rows out of the payload.
  const ribbonQ = useQuery(trpc.journey.ribbon.queryOptions({ businessId, from: today, to: today }, { staleTime: 60_000 }));
  const milestones = ribbonQ.data?.milestones;
  // The project's public page: whether it is live, and whether this reader may show things on it. A reader with no
  // view of the page (a section wall) gets no page controls; the screen itself never waits on this.
  const pageQ = useQuery(trpc.page.get.queryOptions({ businessId }, { staleTime: 60_000, retry: false }));
  const page = pageQ.data && !pageQ.data.isSample ? pageQ.data : null;
  const pageLive = page?.live ?? false;
  const canShow = !!page?.canPublish;
  const pageFacts = useMemo(() => (page ? { live: pageLive } : null), [page, pageLive]);
  const cards = useMemo(() => trophyCards(milestones, currency, live, recurring, pageFacts), [milestones, currency, live, recurring, pageFacts]);
  const others = useMemo(() => otherMilestones(milestones), [milestones]);
  const won = cards.filter((c) => c.achievedAt).length;

  const areaTabs = useAreaTabBar("plan", "milestones");
  useShellChrome({ title: "Milestones", tabs: areaTabs }, [areaTabs]);

  const [shareKey, setShareKey] = useState<string | null>(null);
  useEffect(() => {
    const key = search.get("share");
    if (key && live && cards.some((c) => c.key === key && c.achievedAt)) setShareKey(key);
  }, [search, live, cards]);

  const onOpen = useCallback(
    async (key: string) => {
      const milestone = milestoneForTrophy(key, milestones, currency);
      const ref = replayRefOf(milestone);
      if (!ref) {
        // A revenue milestone is a month's figure, not one win: Finance shows where it comes from.
        if (key.startsWith("mrr_") && milestone) {
          toast({ title: "Reached on Finance's monthly figure", description: "It counts the last 3 full months' revenue ÷ 3, the figure on Money › Overview, so there is no single win to replay.", tone: "info" });
          return;
        }
        toast({ title: "No replay recorded for this milestone", description: "Customer Updates from now on link their replay here.", tone: "info" });
        return;
      }
      let journeyId = ref.journeyId ?? null;
      if (!journeyId && ref.conversionId) {
        // A ref that names the win's conversion: its journey, whatever the age of the win. On any failure the Customer
        // Update screen gets the conversion id and runs the same lookup itself.
        try {
          journeyId = (await queryClient.fetchQuery(trpc.journey.forConversion.queryOptions({ businessId, conversionId: ref.conversionId }, { staleTime: 60_000 }))).journeyId;
        } catch {
          journeyId = null;
        }
      }
      router.push(routes.journey(businessId, journeyId ?? ref.journeyId ?? ref.conversionId!, routes.milestones(businessId)));
    },
    [milestones, currency, router, businessId, toast, queryClient, trpc],
  );

  // Showing and hiding: the server answers how the milestone reads now; the list is read again so every card agrees.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const showM = useMutation(trpc.journey.showMilestone.mutationOptions());
  const hideM = useMutation(trpc.journey.hideMilestone.mutationOptions());
  const setShown = useCallback(
    (key: string, shown: boolean) => {
      const milestone = milestoneForTrophy(key, milestones, currency);
      if (!milestone) return;
      setPendingKey(key);
      (shown ? showM : hideM).mutate(
        { businessId, milestoneId: milestone.id },
        {
          onSuccess: () => toast({ title: shown ? MILESTONE_SHOW_WORDS.shown : "Hidden from your page", description: milestone.label, tone: "good" }),
          onError: (err) => toast({ title: shown ? "Not shown" : "Not hidden", description: errorMessage(err), tone: "bad" }),
          onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: trpc.journey.ribbon.queryKey() });
            setPendingKey(null);
          },
        },
      );
    },
    [milestones, currency, showM, hideM, businessId, toast, queryClient, trpc],
  );
  const copyCardLink = useCallback(
    async (key: string) => {
      const milestone = milestoneForTrophy(key, milestones, currency);
      if (!milestone || !page) return;
      const link = cardUrl(new URL(page.url).origin, milestone.id);
      try {
        await navigator.clipboard.writeText(link);
        toast({ title: MILESTONE_SHOW_WORDS.copied, tone: "good" });
      } catch {
        toast({ title: "Copy this link", description: link, tone: "info" });
      }
    },
    [milestones, currency, page, toast],
  );

  // The kind sits in a fixed column before the title, so the pills line up and the dates form one clean column.
  const events = useMemo<TimelineEvent[]>(
    () =>
      others.map((m) => {
        const tone = m.kind === "decision" ? "info" : "good";
        return {
          id: m.id,
          at: m.achievedAt,
          title: (
            <span className="flex items-start gap-3">
              <span className="flex w-28 shrink-0">
                <StatusPill tone={tone}>{TIMELINE_KIND_WORD[m.kind] ?? plainWords(m.kind)}</StatusPill>
              </span>
              <span className="min-w-0 pt-px">{m.label}</span>
            </span>
          ),
          icon: KIND_ICON[m.kind as keyof typeof KIND_ICON] ?? Flag,
          tone,
        };
      }),
    [others],
  );

  if (loadFailed(ribbonQ)) return <ErrorPanel title="Milestones" message={errorMessage(ribbonQ.error)} onRetry={() => void ribbonQ.refetch()} />;
  if (!ribbonQ.data) return <ScreenSkeleton />;

  const shareCard = shareKey ? cards.find((c) => c.key === shareKey) : undefined;

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="milestones-screen" data-won={won}>
      {/* The Plan area's opening line, first on each of its tabs (docs/DESIGN.md §9). */}
      <AreaOpening area="plan" className="col-span-12" />
      {refreshFailed(ribbonQ) ? <RefreshFailedNotice query={ribbonQ} className="col-span-12 flex items-center gap-2" /> : null}
      <Panel
        title="First outcomes, customers and revenue"
        meta={customersSoFarWords(ribbonQ.data.customers?.total)}
        span={12}
        glow="brand"
        footer={
          <span>
            {live ? "Shareable cards show the customer only when permission is recorded." : <><Term id="milestone">Milestones</Term> light up as customers and revenue arrive; once the business is live they become shareable cards.</>} A figure marked{" "}
            <Term id="estimate" always>
              Estimate
            </Term>{" "}
            is worked out, not measured.
            {canShow ? <span data-testid="milestones-page-note"> {pageLive ? MILESTONE_SHOW_WORDS.note : MILESTONE_SHOW_WORDS.needsPage}</span> : null}
          </span>
        }
        data-testid="trophy-cabinet-panel"
      >
        <TrophyCabinet
          trophies={cards}
          columns={4}
          onOpen={onOpen}
          onShare={live ? setShareKey : undefined}
          onShowOnPage={canShow && pageLive ? (key) => setShown(key, true) : undefined}
          onHideFromPage={canShow ? (key) => setShown(key, false) : undefined}
          onCopyCardLink={pageLive ? (key) => void copyCardLink(key) : undefined}
          pendingKey={pendingKey}
        />
      </Panel>
      <Panel title="Releases, decisions and launches" help="Every reached milestone links to its Customer Update, the replay of how that customer was won." meta={events.length ? plural(events.length, "milestone") : undefined} span={12} empty={events.length === 0 ? { icon: Flag, children: emptyWhy("milestones").text } : undefined} data-testid="milestones-timeline">
        <Timeline events={events} absolute />
      </Panel>
      <ShareDialog card={shareCard} businessName={data.business.name} onClose={() => setShareKey(null)} />
    </div>
  );
}

function ShareDialog({ card, businessName, onClose }: { card: TrophyCard | undefined; businessName: string; onClose: () => void }) {
  const datePrefs = useDateFormat();
  const { toast } = useToast();
  const text = card ? shareText(card, businessName, datePrefs) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Card text copied", tone: "good" });
    } catch {
      toast({ title: "Select the text and copy it", tone: "info" });
    }
  };
  return (
    <Dialog open={!!card} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="share-milestone">
        <DialogHeader>
          <DialogTitle>Share “{card?.label}”</DialogTitle>
          <DialogDescription>{card?.customerName ? "The customer gave permission to be named." : "The customer stays anonymous: no permission is recorded."}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field htmlFor="share-text" label="Card">
            <Input id="share-text" readOnly value={text} onFocus={(e) => e.currentTarget.select()} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" icon={Copy} onClick={() => void copy()}>
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
