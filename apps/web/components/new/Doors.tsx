"use client";
/**
 * /new — Create a new business: Door A (Ideation Studio) or Door B (Import an existing business), BUILD §11.1. A
 * founder who came from a business (Switch business › Create a new business) has Back to it. Two large choices, each a
 * panel with a logo-sized icon, what happens behind the door and who it is for. Earlier concepts are listed below
 * so a founder who left mid-studio can pick up where they stopped, and under them the businesses the founder archived
 * (Restore, Export everything, Delete permanently; `#archived`).
 */
import { ArrowLeft, ArrowRight, FolderInput, Lightbulb } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Chip, Icon, Panel, StarRating, buttonVariants, cn, type IconComponent } from "@foundmill/dugout";
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
  businessCount: number;
  /** The business the founder came from (the last one opened): Back to it. Null for a first business. */
  backTo?: { id: string; name: string } | null;
}

interface Door {
  id: "ideate" | "import";
  href: string;
  icon: IconComponent;
  kicker: string;
  title: string;
  lede: string;
  steps: string[];
  cta: string;
}

const DOORS: Door[] = [
  {
    id: "ideate",
    href: "/new/ideate",
    icon: Lightbulb,
    kicker: "Door A",
    title: "Ideate a concept",
    lede: "Describe a problem, a market or nothing at all. The Ideation agent drafts six to twelve concept cards; the Research agent grounds each one with competitors, market size and pricing.",
    steps: ["Describe a problem, or ask to be surprised within your constraints", "Concept cards with ten attributes and their sources", "Shortlist, merge, ask for more like one, compare", "Commit and take charge"],
    cta: "Open the Ideation Studio",
  },
  {
    id: "import",
    href: "/new/import",
    icon: FolderInput,
    kicker: "Door B",
    title: "Import what exists",
    lede: "Point the Import agent at your repository, documents, trackers, revenue and registry. It checks them, returns an Import report with first decisions, and reads them once you take charge. It never writes.",
    steps: ["GitHub, Drive, Notion, Linear, Jira, website", "Stripe, Shopify, bank, company registry", "Import report: what exists, what is missing", "Commit and take charge"],
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

export function Doors({ viewer, profileLine, businessCount, backTo }: DoorsProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const ideasQ = useQuery(trpc.idea.list.queryOptions({ limit: CONCEPTS_SHOWN }, { staleTime: 15_000 }));
  const ideas = ideasQ.data?.items ?? [];
  const moreConcepts = Boolean(ideasQ.data?.nextCursor);
  return (
    <StudioFrame
      step="new"
      title={doorsTitle(businessCount)}
      lede={profileLine ? `Your profile: ${profileLine}.` : "Two doors. Both end at the same Commit screen."}
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
          <Link
            key={d.id}
            href={d.href}
            className="surface-panel glow-brand edge-tint group flex flex-col text-primary transition-[box-shadow,border-color] duration-hover ease-out hover:border-kit-lift/50 hover:no-underline focus-visible:shadow-ring"
            data-testid={`door-${d.id}`}
            aria-label={`${d.kicker}: ${d.title}`}
          >
            <div className="flex flex-1 flex-col gap-5 p-5">
              <div className="flex items-start gap-4">
                <span aria-hidden className="icon-halo tone-kit-lift size-12">
                  <Icon icon={d.icon} size={20} />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="t-data">{d.kicker}</span>
                  <h2 className="t-display-md text-primary">{d.title}</h2>
                  <p className="text-body text-pretty text-secondary">{d.lede}</p>
                </div>
              </div>
              {/* What happens behind the door: plain steps in the body colour, never link-coloured. */}
              <ol className="flex flex-col gap-2 border-t border-line pt-4">
                {d.steps.map((s, i) => (
                  <li key={s} className="flex items-baseline gap-3 text-body text-secondary">
                    <span className="inline-flex size-badge shrink-0 items-center justify-center rounded-pill font-mono text-micro text-tertiary ring-1 ring-line-strong">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-auto flex justify-end">
                <span className={cn(buttonVariants({ variant: "primary" }), "pointer-events-none")} data-variant="primary">
                  {d.cta}
                  <Icon icon={ArrowRight} className="transition-transform duration-hover ease-out group-hover:translate-x-0.5" />
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-gutter">
        <Panel title="Concepts in progress" loading={ideasQ.isLoading} error={ideasQ.error ? "Could not load your concepts." : undefined} onRetry={() => ideasQ.refetch()} meta={conceptsMeta(ideas.length, moreConcepts)} empty={ideas.length === 0 ? { icon: Lightbulb, children: "Concept cards you draft in the Ideation Studio wait here until you commit one.", action: { label: "Open the Ideation Studio", icon: ArrowRight, onClick: () => router.push("/new/ideate") } } : undefined} data-testid="concepts-in-progress">
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
      <ArchivedBusinesses />
    </StudioFrame>
  );
}
