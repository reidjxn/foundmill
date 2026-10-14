"use client";
/**
 * Small pieces the three LIVE screens share: the Personal-mode notice, the 18+ confirmation, the people lookup and the
 * business logo.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar, BusinessLogo as LogoSquare, Button, Checkbox, Label, StatusPill, cn, useToast } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { UNNAMED_PERSON } from "@/lib/live";
import { useTRPC } from "@/lib/trpc-react";
import { errorMessage, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useBusiness } from "@/components/shell/business-context";
import { ShellLinkButton } from "./ShellLinkButton";

export type PeopleLookup = RouterOutputs["live"]["people"]["lookup"];
export type PersonCard = PeopleLookup["users"][number];
export type BusinessCard = PeopleLookup["businesses"][number];

export interface People {
  person: (userId: string) => PersonCard | undefined;
  business: (businessId: string) => BusinessCard | undefined;
  /** The name to show for a user id: their display name, or "A founder" when their profile keeps it back. */
  name: (userId: string) => string;
  loading: boolean;
}

/**
 * Names for the ids a screen shows, one `live.people.lookup` call for all of them (the API applies each person's
 * profile visibility). Ids are sorted and de-duplicated so the same set always hits the same cache entry.
 */
export function usePeople(userIds: readonly string[], businessIds: readonly string[] = []): People {
  const trpc = useTRPC();
  const users = useMemo(() => [...new Set(userIds)].sort(), [userIds]);
  const businesses = useMemo(() => [...new Set(businessIds)].sort(), [businessIds]);
  const enabled = users.length + businesses.length > 0;
  const q = useQuery(trpc.live.people.lookup.queryOptions({ userIds: users, businessIds: businesses }, { enabled, staleTime: 60_000, placeholderData: (previous) => previous }));
  return useMemo(() => {
    const persons = new Map((q.data?.users ?? []).map((u) => [u.userId, u]));
    const cards = new Map((q.data?.businesses ?? []).map((b) => [b.businessId, b]));
    return { person: (id) => persons.get(id), business: (id) => cards.get(id), name: (id) => persons.get(id)?.displayName?.trim() || UNNAMED_PERSON, loading: enabled && q.isLoading };
  }, [q.data, q.isLoading, enabled]);
}

/** A business's mark from its public card: its initials on its brand colour (public cards carry no logo image); an avatar when the card has no brand colours or is not visible. */
export function BusinessLogo({ card, name, size = 20 }: { card?: BusinessCard; name: string; size?: 20 | 32 | 48 }) {
  if (!card?.kitPrimary || !name.trim()) return <Avatar size={size} name={name || "Business"} />;
  return <LogoSquare name={name} primary={card.kitPrimary} size={size} title={`${name} logo`} />;
}

/**
 * Shown above a LIVE screen while the current business is Personal: the screen still works for the founder
 * (connections, messages and communities belong to the person), but the business itself is off the network and boards.
 */
export function PersonalNotice({ className }: { className?: string }) {
  const { businessId, data } = useBusiness();
  if (data.business.gameMode === "live") return null;
  return (
    <div className={cn("surface-panel flex items-center gap-3 px-panel-pad py-2", className)} data-testid="personal-notice">
      <StatusPill tone="info" icon={Lock}>
        Personal
      </StatusPill>
      <p className="min-w-0 flex-1 text-body text-secondary">
        {data.liveOpen
          ? `${data.business.name} is a Personal business, so it is not listed on the network or on leaderboards. Your own connections, messages and communities stay available.`
          : `Live is not open yet, so ${data.business.name} stays Personal and is not listed on the network or on leaderboards.`}
      </p>
      {data.liveOpen ? (
        <ShellLinkButton href={routes.settings(businessId, "mode")} size="sm">
          Open Settings › Mode
        </ShellLinkButton>
      ) : null}
    </div>
  );
}

/**
 * Shown above a LIVE screen until the founder confirms that they are 18 or older (BUILD §11.14: the network is for
 * adults). Reading stays open; the API refuses asking to connect, accepting, writing, joining and posting until then.
 * The answer comes from `live.summary`, the query behind the shell's Network badge, so it costs no extra call.
 */
export function AdultNotice({ className }: { className?: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [checked, setChecked] = useState(false);
  const summary = useQuery(trpc.live.summary.queryOptions(undefined, { staleTime: 10_000, retry: false }));
  const confirm = useMutation(
    trpc.live.profile.confirmAdult.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpcPathPrefix("live.summary") as unknown[] });
        toast({ title: "Confirmed", description: "You can connect, write, join and post on the network.", tone: "good" });
      },
      onError: (err) => toast({ title: "Not confirmed", description: errorMessage(err), tone: "bad" }),
    }),
  );
  if (summary.data?.adultConfirmed !== false) return null;
  return (
    <div className={cn("surface-panel flex items-center gap-3 px-panel-pad py-2", className)} data-testid="adult-notice">
      <StatusPill tone="warn" icon={ShieldCheck}>
        18+
      </StatusPill>
      <p className="min-w-0 flex-1 text-body text-secondary">The network is for adults. Confirm that you are 18 or older before you connect, write, join or post.</p>
      <span className="flex shrink-0 items-center gap-2">
        <Checkbox id="adult-confirm" checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
        <Label htmlFor="adult-confirm" className="normal-case tracking-normal text-body text-primary">
          I am 18 or older
        </Label>
      </span>
      <Button size="sm" variant="primary" disabled={!checked} loading={confirm.isPending} onClick={() => confirm.mutate({ confirm: true })} data-testid="adult-confirm">
        Confirm
      </Button>
    </div>
  );
}

