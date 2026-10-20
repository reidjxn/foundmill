"use client";
/**
 * /new — Create a new business: Door A (Ideation Studio) or Door B (Import an existing business), BUILD §11.1. A
 * founder who came from a business (Switch business › Create a new business) has Back to it. Two large choices, each
 * a panel that leads with who it is for ("I have an idea, or none yet" / "I already run something"), one plain
 * sentence, and the four steps behind a "What happens" disclosure (docs/UX_AUDIT_AND_PLAN.md §7.4, A8). Door A is
 * tagged "Recommended for you" for a first-time founder. Earlier concepts are listed below once one exists, so a
 * founder who left mid-studio can pick up where they stopped, and under them the businesses the founder archived
 * (Restore, Export everything, Delete permanently; `#archived`), only when there are any (A18).
 */
import { ArrowLeft, ArrowRight, ChevronRight, FolderInput, Lightbulb } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Chip, Icon, Panel, StarRating, type IconComponent } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { LinkButton } from "./LinkButton";
import { plural } from "@/lib/format";
import { useTRPC } from "@/lib/trpc-react";
import { ArchivedBusinesses } from "./ArchivedBusinesses";
import { StudioFrame } from "./StudioFrame";
import { commitHref, num, toConcept } from "./ideate/concepts";

export interface DoorsProps {
  viewer: { email: string | null };
  /** From founder.profile.get: the profile line shown under the title. */
  profileLine?: string | null;
  /**
   * The founder's experience key from their profile ("first_time", "exited", …): Door A is recommended to a first-time
   * founder. Left undefined, the screen reads it from `founder.profile.get` itself.
   */
  experience?: string | null;
  businessCount: number;
  /** The business the founder came from (the last one opened): Back to it. Null for a first business. */
  backTo?: { id: string; name: string } | null;
}

interface Door {
  id: "ideate" | "import";
  href: string;
  icon: IconComponent;
  kicker: string;
  /** Who the door is for, in the founder's own words. */
  title: string;
  /** One plain sentence: what happens behind it. */
  lede: string;
  steps: string[];
  cta: string;
}

export const DOORS: Door[] = [
  {
    id: "ideate",
    href: "/new/ideate",
    icon: Lightbulb,
    kicker: "Door A",
    title: "I have an idea, or none yet",
    lede: "Describe a problem, a market or nothing at all, and the Ideation agent drafts six to twelve concept cards for you to compare.",
    steps: ["Describe a problem, or let the agent draft within your profile alone", "Six to twelve concept cards, each rated on ten attributes with its reasoning", "Shortlist, merge, ask the Research agent about any card, compare", "Commit to one and take charge"],
    cta: "Open the Ideation Studio",
  },
  {
    id: "import",
    href: "/new/import",
    icon: FolderInput,
    kicker: "Door B",
    title: "I already run something",
    lede: "Point the import at your repository, documents, trackers, revenue and registry; it checks what is there and writes an Import report. The reading starts once you take charge, and it never writes to your sources.",
    steps: ["Pick sources: GitHub, Drive, Notion, Linear, Jira, your website", "Stripe, Shopify, a bank, the company registry", "An Import report: what exists, what is missing, first decisions", "Commit and take charge; the import reads your sources then"],
    cta: "Choose sources",
  },
];

/** How many concepts in progress /new lists (the newest; the studio pages through the rest). */
export const CONCEPTS_SHOWN = 12;

/** The panel's count: the true count when every concept is listed, "12 newest" when there are more (audit IAE-17). */
export function conceptsMeta(shown: number, more: boolean): string | undefined {
  if (shown === 0) return undefined;
  return more ? `${shown} newest` : plural(shown, "concept");
}

/** The page's title: a founder with a business creates another; a new founder starts their first. */
export function doorsTitle(businessCount: number): string {
  return businessCount > 0 ? "Create a new business" : "Your first business";
}

/** Door A is the recommended door for a first-time founder (§7.4); nobody else gets a recommendation. */
export function recommendedDoor(experience: string | null | undefined): Door["id"] | null {
  return experience === "first_time" ? "ideate" : null;
}

export function Doors({ viewer, profileLine, experience, businessCount, backTo }: DoorsProps) {
  const trpc = useTRPC();
  const ideasQ = useQuery(trpc.idea.list.queryOptions({ limit: CONCEPTS_SHOWN }, { staleTime: 15_000 }));
  // The experience comes with the page when the server passed it; otherwise the profile is read once here.
  const profileQ = useQuery(trpc.founder.profile.get.queryOptions(undefined, { enabled: experience === undefined, staleTime: 5 * 60_000 }));
  const recommended = recommendedDoor(experience === undefined ? profileQ.data?.profile?.experience : experience);
  const ideas = ideasQ.data?.items ?? [];
  const moreConcepts = Boolean(ideasQ.data?.nextCursor);
  return (
    <StudioFrame
      step="new"
      title={doorsTitle(businessCount)}
      lede={profileLine ? `Your profile: ${profileLine}.` : "Two doors. Both end at the same Launch screen."}
      viewer={viewer}
      actions={
        backTo ? (
          <LinkButton variant="ghost" icon={ArrowLeft} href={routes.home(backTo.id)} data-testid="new-back-to-business">
            Back to {backTo.name}
          </LinkButton>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-gutter" data-testid="doors">
        {DOORS.map((d) => (
          <article key={d.id} className="surface-panel glow-brand edge-tint flex flex-col text-primary" data-door={d.id} data-recommended={recommended === d.id || undefined} aria-label={`${d.kicker}: ${d.title}`}>
            <div className="flex flex-1 flex-col gap-5 p-5">
              <div className="flex items-start gap-4">
                <span aria-hidden className="icon-halo tone-kit-lift size-12">
                  <Icon icon={d.icon} size={20} />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="t-data">{d.kicker}</span>
                    {recommended === d.id ? (
                      <Chip tone="kit" data-testid="door-recommended">
                        Recommended for you
                      </Chip>
                    ) : null}
                  </span>
                  <h2 className="t-display-md text-primary">{d.title}</h2>
                  <p className="text-body text-pretty text-secondary">{d.lede}</p>
                </div>
              </div>
              {/* What happens behind the door: four plain steps, behind a disclosure so the choice reads first. */}
              <details className="group/steps border-t border-line pt-3" data-testid={`door-${d.id}-steps`}>
                <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm px-1 t-action text-secondary transition-colors duration-hover ease-out hover:text-primary focus-visible:shadow-ring [&::-webkit-details-marker]:hidden">
                  <Icon icon={ChevronRight} size="inline" className="transition-transform duration-overlay ease-out group-open/steps:rotate-90" />
                  What happens
                </summary>
                <ol className="mt-3 flex flex-col gap-2">
                  {d.steps.map((s, i) => (
                    <li key={s} className="flex items-baseline gap-3 text-body text-secondary">
                      <span className="inline-flex size-badge shrink-0 items-center justify-center rounded-pill font-mono text-micro text-tertiary ring-1 ring-line-strong">{i + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </details>
              <div className="mt-auto flex justify-end">
                <LinkButton variant="primary" href={d.href} iconRight={ArrowRight} data-testid={`door-${d.id}`}>
                  {d.cta}
                </LinkButton>
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Concepts in progress appear once one exists (A18); a failed read says so, with a retry. */}
      {ideas.length > 0 || ideasQ.error ? (
        <div className="mt-gutter">
          <Panel title="Concepts in progress" error={ideasQ.error ? "Could not load your concepts." : undefined} onRetry={() => ideasQ.refetch()} meta={conceptsMeta(ideas.length, moreConcepts)} data-testid="concepts-in-progress">
            <ul className="grid grid-cols-3 gap-gutter">
              {ideas.map((idea) => {
                const c = toConcept(idea);
                return (
                  <li key={idea.id} className="surface-raised flex items-center gap-3 rounded-md p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="t-display-sm min-w-0 break-words">{c.name}</span>
                        {c.version && c.version > 1 ? <Chip>Version {c.version}</Chip> : null}
                      </div>
                      <StarRating value={num(idea.current?.starsCurrent)} potential={num(idea.current?.starsPotential)} label="Current ability" />
                      <p className="mt-1 line-clamp-2 text-small text-secondary">{c.pitch}</p>
                    </div>
                    <LinkButton size="sm" variant="default" href={commitHref(idea.id)}>
                      Commit
                    </LinkButton>
                  </li>
                );
              })}
            </ul>
            {ideas.length > 0 ? (
              <div className="mt-3 flex justify-end">
                <LinkButton variant="ghost" size="sm" href="/new/ideate">
                  {moreConcepts ? "See every concept in the studio" : "Back to the studio"}
                </LinkButton>
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}
      <ArchivedBusinesses />
    </StudioFrame>
  );
}
