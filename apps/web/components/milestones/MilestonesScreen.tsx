"use client";
/**
 * Milestones (BUILD §11.4 "Trophy cabinet", route /b/[bid]/trophies → /milestones per the product vocabulary): the
 * TrophyCabinet from `journey.ribbon`'s milestones, the timeline of every other milestone, and on LIVE shareable
 * milestone cards with the customer anonymised unless permission is recorded.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Flag, Gem, Rocket, Trophy } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Panel, Timeline, TrophyCabinet, useToast, type TimelineEvent, type TrophyCard } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { journeyIdForConversion } from "@/components/journey/mapping";
import { TIMELINE_KIND_WORD, milestoneForTrophy, otherMilestones, replayLookupWindow, replayRefOf, shareText, trophyCards } from "./milestones";

const KIND_ICON = { release: Flag, decision: Gem, incorporation: Rocket, funding: Rocket, launch: Rocket, customer: Trophy, revenue: Trophy, trophy: Trophy } as const;

export function MilestonesScreen() {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const search = useSearchParams();
  const { toast } = useToast();
  const live = data.business.gameMode === "live";
  const currency = data.business.glossary?.currency ?? "EUR";
  const today = new Date().toISOString().slice(0, 10);
  // Milestones come back whole whatever the range; a one-day range keeps the daily rows out of the payload.
  const ribbonQ = useQuery(trpc.journey.ribbon.queryOptions({ businessId, from: today, to: today }, { staleTime: 60_000 }));
  const milestones = ribbonQ.data?.milestones;
  const cards = useMemo(() => trophyCards(milestones, currency, live), [milestones, currency, live]);
  const others = useMemo(() => otherMilestones(milestones), [milestones]);
  const won = cards.filter((c) => c.achievedAt).length;

  useShellChrome({ title: "Milestones" });

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
        toast({ title: "No replay recorded for this milestone", description: "Customer Updates from now on link their replay here.", tone: "info" });
        return;
      }
      let journeyId = ref.journeyId ?? null;
      if (!journeyId && ref.conversionId && milestone?.achievedAt) {
        // A ref that names the win's conversion: find its journey around the day the milestone was reached. On any
        // failure the Customer Update screen gets the conversion id and runs its own lookup.
        try {
          const page = await queryClient.fetchQuery(trpc.journey.list.queryOptions({ businessId, ...replayLookupWindow(milestone.achievedAt), limit: 200 }, { staleTime: 60_000 }));
          journeyId = journeyIdForConversion(ref.conversionId, page.items);
        } catch {
          journeyId = null;
        }
      }
      router.push(routes.journey(businessId, journeyId ?? ref.journeyId ?? ref.conversionId!));
    },
    [milestones, currency, router, businessId, toast, queryClient, trpc],
  );

  const events = useMemo<TimelineEvent[]>(
    () =>
      others.map((m) => ({
        id: m.id,
        at: m.achievedAt,
        title: m.label,
        icon: KIND_ICON[m.kind as keyof typeof KIND_ICON] ?? Flag,
        tone: m.kind === "decision" ? "info" : "good",
        statusWord: TIMELINE_KIND_WORD[m.kind] ?? m.kind,
      })),
    [others],
  );

  if (ribbonQ.error) return <ErrorPanel title="Milestones" message={errorMessage(ribbonQ.error)} onRetry={() => void ribbonQ.refetch()} />;
  if (!ribbonQ.data) return <ScreenSkeleton />;

  const shareCard = shareKey ? cards.find((c) => c.key === shareKey) : undefined;

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="milestones-screen" data-won={won}>
      <Panel
        title="Milestones"
        span={12}
        actions={<Chip tone={won ? "gold" : "neutral"}>{won ? `${won} won` : "None yet"}</Chip>}
        footer={<span>{live ? "Shareable cards show the customer only when permission is recorded." : "Milestones light up as customers and revenue arrive; on LIVE they become shareable cards."}</span>}
        data-testid="trophy-cabinet-panel"
      >
        <TrophyCabinet trophies={cards} columns={4} onOpen={onOpen} onShare={live ? setShareKey : undefined} />
      </Panel>
      <Panel title="Other milestones" span={12} empty={events.length === 0 ? { icon: Flag, children: "Releases, decisions, incorporation, funding and launches appear here as they happen." } : undefined} data-testid="milestones-timeline">
        <Timeline events={events} absolute />
      </Panel>
      <ShareDialog card={shareCard} businessName={data.business.name} onClose={() => setShareKey(null)} />
    </div>
  );
}

function ShareDialog({ card, businessName, onClose }: { card: TrophyCard | undefined; businessName: string; onClose: () => void }) {
  const { toast } = useToast();
  const text = card ? shareText(card, businessName) : "";
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
