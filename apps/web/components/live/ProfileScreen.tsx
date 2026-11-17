"use client";
/**
 * /profiles/[kind]/[id] (BUILD §6.2, §11.14; audits GLS2F-09, LS2-06): a public profile, founder or business. Only what the
 * public-profile view carries is shown (name, archetype, brand colors, region, when it went live); a founder sees the
 * businesses they run and a business its founders who made their name public. A founder can ask to connect from here
 * (as the current business, which must be LIVE and writable, as everywhere else), and an existing request or connection
 * is shown instead of the button.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Check, Clock, ExternalLink, Flag, MessageSquare, UserRoundPlus, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { APP_NAME } from "@foundmill/config";
import { Avatar, Button, Chip, EmptyState, Panel, ProfileHeader, StatusPill, useFormatters, useToast, type ProfileChip, type ProfileFact } from "@foundmill/dugout";
import { lookingForLine } from "@foundmill/shared/person-profile";
import { plainWords } from "@/lib/format";
import { publicProfileHref } from "@/lib/public-search";
import { errorMessage, trpcErrorCode, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useOptionalBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ReportPersonDialog, type ReportTarget } from "@/components/safety/ReportPersonDialog";
import { BusinessLogo, PersonalNotice } from "./shared";

type Profile = RouterOutputs["live"]["people"]["profile"];
type Card = Profile["profile"];

const UNKNOWN_ARCHETYPE = "Business";

/** The business's mark from its public card: initials on its brand color (a public profile is a live business). */
function cardLogo(card: Card, size: 32 | 48 = 48) {
  return <BusinessLogo card={{ businessId: card.businessId ?? "", name: card.name, slug: card.slug, kitPrimary: card.kitPrimary, kitSecondary: card.kitSecondary, archetype: card.archetype, live: true }} name={card.name} size={size} />;
}

export function ProfileScreen({ kind, id }: { kind: "business" | "founder"; id: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const { formatDate } = useFormatters();
  const ctx = useOptionalBusiness();
  const businessId = ctx?.businessId;
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const q = useQuery(trpc.live.people.profile.queryOptions({ kind, id }, { staleTime: 30_000, retry: false }));
  const profile = q.data?.profile;
  useShellChrome({ title: profile ? profile.name : "Profile", breadcrumbs: [{ label: "Network", href: "/network" }, { label: profile?.name ?? "Profile" }] }, [profile?.name]);

  const request = useMutation(
    trpc.live.connections.request.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpcPathPrefix("live.people.profile") as unknown[] });
        void qc.invalidateQueries({ queryKey: trpcPathPrefix("live.connections") as unknown[] });
        toast({ title: "Request sent", description: `${profile?.name ?? "They"} will see it in their Network.`, tone: "good" });
      },
      onError: (err) => toast({ title: "Request not sent", description: errorMessage(err), tone: "bad" }),
    }),
  );

  if (q.isLoading) return <div className="grid grid-cols-12 gap-gutter p-gutter"><Panel title="Profile" span={12} loading data-testid="profile-loading" /></div>;
  if (q.error || !q.data || !profile) {
    const missing = q.error ? trpcErrorCode(q.error) === "NOT_FOUND" : true;
    return (
      <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="profile-missing">
        <Panel
          title="Profile"
          span={12}
          error={!missing && q.error ? errorMessage(q.error) : undefined}
          onRetry={() => void q.refetch()}
          empty={missing ? { icon: UsersRound, title: "No such profile", children: `It is not on ${APP_NAME}: it does not exist, or the person or business keeps it private.`, action: { label: "Back to Network", icon: ArrowLeft, onClick: () => router.push("/network") } } : undefined}
        />
      </div>
    );
  }

  const { businesses, founders, isSelf, connection, person } = q.data;
  const chips: ProfileChip[] = [{ label: profile.kind === "founder" ? "Founder" : (profile.archetype ? plainWords(profile.archetype) : UNKNOWN_ARCHETYPE), icon: profile.kind === "founder" ? undefined : Building2 }];
  const facts: ProfileFact[] = [];
  if (profile.kind === "business" && profile.since) facts.push({ label: "On " + APP_NAME + " since", value: formatDate(profile.since) });
  if (profile.kind === "business" && profile.region) facts.push({ label: "Region", value: profile.region.toUpperCase() });
  if (profile.kind === "founder") facts.push({ label: "Businesses", value: businesses.length });

  const hasBusiness = ctx !== null;
  const canAsk = ctx?.data.business.gameMode === "live";
  let action = null;
  if (profile.kind === "founder" && !isSelf) {
    if (connection?.status === "accepted") {
      action = (
        <Button size="sm" className="min-h-tap @page-wide:min-h-0" variant="ghost" icon={MessageSquare} onClick={() => router.push("/network")} data-testid="profile-message">
          Message in Network
        </Button>
      );
    } else if (connection?.status === "requested") {
      action = (
        <StatusPill tone="neutral" icon={Clock} data-testid="profile-requested">
          {connection.direction === "incoming" ? "Asked to connect with you" : "Request sent"}
        </StatusPill>
      );
    } else if (!connection && profile.userId && businessId) {
      const userId = profile.userId;
      action = (
        <Button size="sm" className="min-h-tap @page-wide:min-h-0" icon={UserRoundPlus} disabled={!canAsk} loading={request.isPending} onClick={() => request.mutate({ businessId, toUserId: userId })} data-testid="profile-connect">
          Connect
        </Button>
      );
    }
  }

  // Report (and block in the same step) is there for every founder who is not the viewer, connected or not (NETWORK F21).
  const reportUserId = profile.kind === "founder" && !isSelf ? profile.userId : null;
  const actions =
    action || reportUserId ? (
      <div className="flex flex-wrap items-center gap-2">
        {action}
        {reportUserId ? (
          <Button size="sm" className="min-h-tap @page-wide:min-h-0" variant="ghost" icon={Flag} onClick={() => setReporting({ kind: "person", userId: reportUserId })} data-testid="profile-report-open">
            Report
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="@container flex min-h-0 flex-1 flex-col" data-testid="profile-screen" data-kind={profile.kind}>
      <ProfileHeader avatar={profile.kind === "business" ? cardLogo(profile, 48) : <Avatar size={64} name={profile.name} />} name={profile.name} chips={chips} status={<StatusPill tone="info">On {APP_NAME}</StatusPill>} facts={facts} actions={actions} />
      <ReportPersonDialog target={reporting} name={profile.name} onOpenChange={(o) => !o && setReporting(null)} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-gutter p-gutter @page-wide:grid-cols-12 [&_button]:min-h-tap @page-wide:[&_button]:min-h-0">
          <PersonalNotice className="@page-wide:col-span-12" />
          {profile.kind === "founder" && !isSelf && !connection && hasBusiness && !canAsk ? (
            <p className="text-small @page-wide:col-span-12 text-secondary" data-testid="profile-connect-note">
              Switch to a live business to ask {profile.name} to connect: a Personal business is not on the network.
            </p>
          ) : null}
          {profile.kind === "founder" && !isSelf && !connection && !hasBusiness ? (
            <p className="text-small @page-wide:col-span-12 text-secondary" data-testid="profile-connect-no-project">
              Asking someone to connect works from a project on the network for now. You can still read {profile.name}'s page, and report or block from here.
            </p>
          ) : null}
          {person ? <PersonPanel person={person} className="@page-wide:col-span-8" /> : null}
          {profile.kind === "founder" && person && businesses.length === 0 ? null : profile.kind === "founder" ? (
            <Panel title="Businesses" className="@page-wide:col-span-8" empty={businesses.length === 0 ? { icon: Building2, children: "No live business is listed." } : undefined} data-testid="profile-businesses">
              <ul>
                {businesses.map((b) => (
                  <li key={b.businessId} className="flex items-center gap-3 border-b border-subtle/50 py-2 last:border-b-0">
                    {cardLogo(b, 32)}
                    <button type="button" className="t-body-strong min-h-tap min-w-0 flex-1 truncate text-left text-primary hover:underline @page-wide:min-h-0" onClick={() => router.push(publicProfileHref(b))}>
                      {b.name}
                    </button>
                    <span className="text-small text-secondary">{b.archetype ? plainWords(b.archetype) : UNKNOWN_ARCHETYPE}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : (
            <Panel title="Founders" className="@page-wide:col-span-8" empty={founders.length === 0 ? { icon: UsersRound, children: "Its founders keep their names private." } : undefined} data-testid="profile-founders">
              <ul>
                {founders.map((f) => (
                  <li key={f.userId ?? f.name} className="flex items-center gap-3 border-b border-subtle/50 py-2 last:border-b-0">
                    <Avatar size={32} name={f.name} />
                    <button type="button" className="t-body-strong min-h-tap min-w-0 flex-1 truncate text-left text-primary hover:underline @page-wide:min-h-0" onClick={() => router.push(publicProfileHref(f))}>
                      {f.name}
                    </button>
                    <Check aria-hidden className="size-icon-inline text-secondary" />
                    <span className="text-small text-secondary">Public</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="What is public" className="@page-wide:col-span-4" footer="Only these fields are shown. Everything else stays in the business.">
            <p className="text-small text-secondary">
              {profile.kind === "founder" ? (person ? "What this person published on their own page, and the live businesses they run." : "A founder's name, when they choose to make it public, and the live businesses they run.") : "A live business's name, logo, kind of business, region and when it went live, and its founders who made their name public."}
            </p>
          </Panel>
          {!q.data && <EmptyState icon={UsersRound}>Nothing to show.</EmptyState>}
        </div>
      </div>
    </div>
  );
}

/** What the person's page at /u/<handle> says (one identity: the page and this screen show the same profile). */
function PersonPanel({ person, className }: { person: NonNullable<Profile["person"]>; className?: string }) {
  const line = lookingForLine(person.lookingFor);
  return (
    <Panel title="About" className={className} data-testid="profile-person">
      <div className="flex flex-col gap-3">
        {person.headline ? <p className="text-body-strong text-primary">{person.headline}</p> : null}
        {person.place ? <p className="text-small text-secondary">{person.place}</p> : null}
        {person.about ? <p className="whitespace-pre-line break-words text-body text-prose">{person.about}</p> : null}
        {person.strengths.length ? (
          <div className="flex flex-col gap-1.5">
            <span className="t-label text-secondary">Good at</span>
            <span className="flex flex-wrap gap-1">
              {person.strengths.map((t) => (
                <Chip key={t} tone="neutral">
                  {t}
                </Chip>
              ))}
            </span>
          </div>
        ) : null}
        {person.wantsToLearn.length ? (
          <div className="flex flex-col gap-1.5">
            <span className="t-label text-secondary">Wants to learn</span>
            <span className="flex flex-wrap gap-1">
              {person.wantsToLearn.map((t) => (
                <Chip key={t} tone="neutral">
                  {t}
                </Chip>
              ))}
            </span>
          </div>
        ) : null}
        {line ? <p className="text-small text-secondary" data-testid="profile-looking-for">{line}</p> : null}
        {person.projects.length ? (
          <ul className="flex flex-col gap-1">
            {person.projects.map((p) => (
              <li key={p.slug}>
                <a className="min-h-tap text-body text-primary hover:underline @page-wide:min-h-0" href={`/p/${p.slug}`}>
                  {p.name}
                </a>
                {p.pitch ? <span className="text-small text-secondary"> · {p.pitch}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <a className="inline-flex min-h-tap items-center gap-1.5 text-small text-secondary hover:text-primary @page-wide:min-h-0" href={`/u/${person.handle}`} data-testid="profile-person-page">
          <ExternalLink aria-hidden className="size-icon-inline" /> Their page
        </a>
      </div>
    </Panel>
  );
}
