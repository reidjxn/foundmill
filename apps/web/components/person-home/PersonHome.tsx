"use client";
/**
 * /home — the home of a signed-in person with no project yet (docs/THESIS_REVIEW.md package 2.4). A real screen, not
 * a redirect into the studio: the main action is "Start something" (/new), with "Find a project or people" beside it
 * as an offer, never a step (CLAUDE.md "Solo is complete", "Finding people is seamless and optional"). Under them, only
 * when there is something: the concepts the person left mid-studio, and the requests and messages waiting for them.
 *
 * - No suggestions of people anywhere on this screen: a person who has not asked for people never sees any, and the
 *   find card is an offer to go and look, not a list of anyone.
 * - The people layer (LIVE) may be closed on a deployment (`liveMode` false): the find card is then left out (WP-04
 *   T15: no "Opening soon" promise), Start something is the one card, and nothing waiting is read.
 * - Works from 390 px (CLAUDE.md "Small screens", DESIGN §6): one column inside the frame's container, two from
 *   `page-wide`; every link a finger presses is at least `tap-target` high.
 * - On a small screen "Start something" goes to `/new/write` (WP-04 T15: a working name and the idea, then Commit),
 *   on a wide one to `/new` (the doors). Each concept's Continue still offers the link by email on a small screen
 *   (`EmailMeALink`; WP-03 T3).
 */
import { ArrowRight, Inbox, Lightbulb, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Icon, Panel, isViewportTooSmall, useViewportWidth, type IconComponent } from "@foundmill/dugout";
import { plural } from "@/lib/format";
import { useTRPC } from "@/lib/trpc-react";
import { LinkButton } from "@/components/new/LinkButton";
import { StudioFrame } from "@/components/new/StudioFrame";
import { commitHref, toConcept } from "@/components/new/ideate/concepts";
import { CONTINUE_LATER_WORDS, EmailMeALink } from "@/components/providers/ContinueLater";

export interface PersonHomeProps {
  viewer: { email: string | null };
  /** The name the person gave in their profile; the title greets them by it. */
  displayName: string | null;
  /** Whether the people layer is open on this deployment (`founder.profile.get` features.liveMode). */
  liveMode: boolean;
}

/** How many concepts in progress the home lists; the studio has the rest. */
export const HOME_CONCEPTS_SHOWN = 3;

export function homeTitle(displayName: string | null | undefined): string {
  const name = displayName?.trim();
  return name ? `Welcome, ${name}` : "Welcome";
}

/** The waiting lines, in the order a person answers them; a zero count is left out. */
export function waitingLines(
  summary: { unreadMessages: number; requestsWaiting: number; invitations: number } | undefined,
): { key: string; label: string; href: string }[] {
  if (!summary) return [];
  const lines = [
    {
      key: "requests",
      count: summary.requestsWaiting,
      label: plural(summary.requestsWaiting, "request to connect", "requests to connect"),
      href: "/network",
    },
    {
      key: "messages",
      count: summary.unreadMessages,
      label: plural(summary.unreadMessages, "unread message", "unread messages"),
      href: "/network",
    },
    {
      key: "invitations",
      count: summary.invitations,
      label: plural(summary.invitations, "community invitation", "community invitations"),
      href: "/communities",
    },
  ];
  return lines.filter((l) => l.count > 0).map(({ key, label, href }) => ({ key, label, href }));
}

function HomeCard({
  id,
  icon,
  kicker,
  title,
  lede,
  action,
  primary = false,
}: {
  id: string;
  icon: IconComponent;
  kicker: string;
  title: string;
  lede: string;
  action: ReactNode;
  primary?: boolean;
}) {
  return (
    <article
      className={
        primary
          ? "surface-panel glow-brand edge-tint flex flex-col text-primary"
          : "surface-panel flex flex-col text-primary"
      }
      data-testid={`home-${id}`}
      aria-label={title}
    >
      <div className="flex flex-1 flex-col gap-5 p-5">
        <div className="flex items-start gap-4">
          <span aria-hidden className="icon-halo tone-kit-lift size-12 shrink-0">
            <Icon icon={icon} size={20} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="t-data">{kicker}</span>
            <h2 className="t-display-md text-primary">{title}</h2>
            <p className="text-body text-pretty text-secondary">{lede}</p>
          </div>
        </div>
        <div className="mt-auto flex justify-end">{action}</div>
      </div>
    </article>
  );
}

export function PersonHome({ viewer, displayName, liveMode }: PersonHomeProps) {
  const trpc = useTRPC();
  const ideasQ = useQuery(
    trpc.idea.list.queryOptions({ limit: HOME_CONCEPTS_SHOWN }, { staleTime: 15_000 }),
  );
  // The badge counts are read only where the people layer is open: closed, nobody can have written to this person.
  const summaryQ = useQuery(
    trpc.live.summary.queryOptions(undefined, { enabled: liveMode, staleTime: 30_000 }),
  );
  const ideas = ideasQ.data?.items ?? [];
  const waiting = liveMode ? waitingLines(summaryQ.data) : [];
  // A phone starts from one sentence (WP-04 T15); the studio's doors are desktop-only.
  const small = isViewportTooSmall(useViewportWidth());
  const startHref = small ? "/new/write" : "/new";
  return (
    <StudioFrame
      title={homeTitle(displayName)}
      lede="Build something that is yours, with a team of agents doing the work beside you."
      viewer={viewer}
      width="measure"
      smallScreen
    >
      <div className={liveMode ? "grid grid-cols-1 gap-gutter @page-wide:grid-cols-2" : "grid grid-cols-1 gap-gutter"} data-testid="person-home">
        <HomeCard
          id="start"
          primary
          icon={Lightbulb}
          kicker="Your own project"
          title="Start something"
          lede="Bring an idea, or none yet, or something you already run. Your team shapes it with you and starts on the work."
          action={
            <LinkButton
              variant="primary"
              href={startHref}
              iconRight={ArrowRight}
              className="min-h-tap w-full @page-wide:w-auto"
              data-testid="home-start-link"
            >
              Start something
            </LinkButton>
          }
        />
        {liveMode ? (
        <HomeCard
          id="find"
          icon={Users}
          kicker="If you want company"
          title="Find a project or people"
          lede="Join someone's project, or meet people to build yours with. Only if you want to: you can do all of it on your own."
          action={
            <LinkButton
              variant="default"
              href="/network"
              iconRight={ArrowRight}
              className="min-h-tap"
              data-testid="home-find-link"
            >
              Find a project or people
            </LinkButton>
          }
        />
        ) : null}
      </div>

      {waiting.length > 0 ? (
        <div className="mt-gutter">
          <Panel title="Waiting for you" data-testid="home-waiting">
            <ul className="flex flex-col gap-2">
              {waiting.map((w) => (
                <li
                  key={w.key}
                  className="flex items-center justify-between gap-3"
                  data-waiting={w.key}
                >
                  <span className="flex min-w-0 items-center gap-2 text-body">
                    <Icon icon={Inbox} size="inline" className="text-tertiary" />
                    {w.label}
                  </span>
                  <LinkButton size="sm" variant="ghost" href={w.href} className="min-h-tap">
                    Open
                  </LinkButton>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}

      {ideas.length > 0 || ideasQ.error ? (
        <div className="mt-gutter">
          <Panel
            title="Pick up where you left off"
            error={ideasQ.error ? "Could not load your concepts." : undefined}
            onRetry={() => ideasQ.refetch()}
            data-testid="home-concepts"
          >
            {small ? <p className="mb-3 text-body text-secondary">{CONTINUE_LATER_WORDS.nextStep}</p> : null}
            <ul className="flex flex-col gap-2">
              {ideas.map((idea) => {
                const c = toConcept(idea);
                return (
                  <li
                    key={idea.id}
                    className="surface-raised flex flex-wrap items-center gap-3 rounded-md p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="t-display-sm break-words">{c.name}</span>
                      {c.pitch ? (
                        <p className="mt-1 line-clamp-2 text-small text-secondary">{c.pitch}</p>
                      ) : null}
                    </div>
                    {small ? (
                      <EmailMeALink path={commitHref(idea.id)} signedIn />
                    ) : (
                      <LinkButton
                        size="sm"
                        variant="default"
                        href={commitHref(idea.id)}
                        className="min-h-tap"
                      >
                        Continue
                      </LinkButton>
                    )}
                  </li>
                );
              })}
            </ul>
            {ideasQ.data?.nextCursor && !small ? (
              <div className="mt-3 flex justify-end">
                <LinkButton variant="ghost" size="sm" href="/new/ideate" className="min-h-tap">
                  See every concept in the studio
                </LinkButton>
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}
    </StudioFrame>
  );
}
