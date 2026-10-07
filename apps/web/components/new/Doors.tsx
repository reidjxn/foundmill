"use client";
/**
 * /new — Door A (Ideation Studio) or Door B (Import an existing business), BUILD §11.1. Two large choices, each a
 * panel with a crest-sized icon, what happens behind the door and who it is for. Earlier concepts are listed below
 * so a founder who left mid-studio can pick up where they stopped.
 */
import { ArrowRight, FolderInput, Sparkles } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Chip, Icon, Panel, StarRating, buttonVariants, cn, type IconComponent } from "@foundmill/dugout";
import { LinkButton } from "./LinkButton";
import { useTRPC } from "@/lib/trpc-react";
import { StudioFrame } from "./StudioFrame";
import { commitHref, num, toConcept } from "./ideate/concepts";

export interface DoorsProps {
  viewer: { email: string | null };
  /** From founder.profile.get: the profile line shown under the title. */
  profileLine?: string | null;
  businessCount: number;
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
    icon: Sparkles,
    kicker: "Door A",
    title: "Ideate a concept",
    lede: "Describe a problem, a market or nothing at all. The Ideation agent drafts six to twelve concept cards; the Research agent grounds each one with competitors, market size and pricing.",
    steps: ["Prompt or 'surprise me within my constraints'", "Concept cards with ten attributes and citations", "Shortlist, merge, fork, ask, compare", "Commit and take charge"],
    cta: "Open the Ideation Studio",
  },
  {
    id: "import",
    href: "/new/import",
    icon: FolderInput,
    kicker: "Door B",
    title: "Import what exists",
    lede: "Point the Import agent at your repository, documents, trackers, revenue and registry. It reads, never writes, and returns a Scouting report with first decisions.",
    steps: ["GitHub, Drive, Notion, Linear, Jira, website", "Stripe, Shopify, bank, company registry", "Scouting report: what exists, what is missing", "Commit and take charge"],
    cta: "Choose sources",
  },
];

export function Doors({ viewer, profileLine, businessCount }: DoorsProps) {
  const trpc = useTRPC();
  const ideasQ = useQuery(trpc.idea.list.queryOptions({ limit: 12 }, { staleTime: 15_000 }));
  const ideas = ideasQ.data?.items ?? [];
  return (
    <StudioFrame step="new" title={businessCount > 0 ? "Start another business" : "Your first business"} lede={profileLine ? `Playing as ${profileLine}.` : "Two doors. Both end at the same Commit screen."} viewer={viewer}>
      <div className="grid grid-cols-2 gap-gutter" data-testid="doors">
        {DOORS.map((d) => (
          <Link key={d.id} href={d.href} className={cn("surface-panel group flex flex-col overflow-hidden hover:border-link hover:no-underline focus-visible:outline-2 focus-visible:outline-link")} data-testid={`door-${d.id}`} aria-label={`${d.kicker}: ${d.title}`}>
            <div className="flex h-panel-header items-center gap-2 border-b border-subtle bg-panel-alt px-panel-pad">
              <span className="t-label">{d.kicker}</span>
            </div>
            <div className="flex flex-1 flex-col gap-4 p-5">
              <div className="flex items-start gap-4">
                <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-panel border border-subtle bg-ink text-primary">
                  <Icon icon={d.icon} size={20} />
                </span>
                <div className="min-w-0">
                  <h2 className="t-display-md text-primary">{d.title}</h2>
                  <p className="mt-1 text-body text-secondary">{d.lede}</p>
                </div>
              </div>
              <ol className="flex flex-col gap-1.5 border-t border-subtle pt-3">
                {d.steps.map((s, i) => (
                  <li key={s} className="flex items-center gap-2 text-body">
                    <span className="w-4 text-right font-mono text-mono text-secondary">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-auto flex justify-end">
                <span className={cn(buttonVariants({ variant: "primary" }))} data-variant="primary">
                  {d.cta}
                  <Icon icon={ArrowRight} />
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-gutter">
        <Panel title="Concepts in progress" loading={ideasQ.isLoading} error={ideasQ.error ? "Could not load your concepts." : undefined} onRetry={() => ideasQ.refetch()} empty={ideas.length === 0 ? { icon: Sparkles, children: "Concept cards you shortlist in the Ideation Studio appear here until you commit one." } : undefined} data-testid="concepts-in-progress">
          <ul className="grid grid-cols-3 gap-gutter">
            {ideas.map((idea) => {
              const c = toConcept(idea);
              return (
                <li key={idea.id} className="flex items-center gap-3 rounded-panel border border-subtle bg-panel-alt p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="t-display-sm truncate">{c.name}</span>
                      {c.version && c.version > 1 ? <Chip mono>v{c.version}</Chip> : null}
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
                Back to the studio
              </LinkButton>
            </div>
          ) : null}
        </Panel>
      </div>
    </StudioFrame>
  );
}
