"use client";
/**
 * /new — Create a new business: Door A (Ideation Studio) or Door B (Import an existing business), BUILD §11.1. A
 * founder who came from a business (Switch business › Create a new business) has Back to it. Two large choices, each
 * a panel that leads with who it is for ("I have an idea, or none yet" / "I already run something"), one plain
 * sentence, and the four steps behind a "What happens" disclosure (docs/UX_AUDIT_AND_PLAN.md §7.4, A8). Door A is
 * tagged "Recommended for you" for a first-time founder. A third door, "Explore an example" (§12 item 5), opens the
 * seeded example business as a read-only viewer (`business.example.open`); it shows only when the deployment has an
 * example and the founder does not already belong to it for real. Earlier concepts are listed below once one exists,
 * so a founder who left mid-studio can pick up where they stopped, and under them the businesses the founder archived
 * (Restore, Export everything, Delete permanently; `#archived`), only when there are any (A18).
 */
import { ArrowLeft, ArrowRight, ChevronRight, Compass, FolderInput, Lightbulb } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button, Chip, Icon, Panel, StarRating, useToast, type IconComponent } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { LinkButton } from "./LinkButton";
import { rememberLastBusiness } from "@/lib/auth/last-business";
import { plural } from "@/lib/format";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { ArchivedBusinesses } from "./ArchivedBusinesses";
import { StudioFrame } from "./StudioFrame";
import { commitHref, num, toConcept } from "./ideate/concepts";

/** What the example door needs from `business.example.get` (null: no example on this deployment, no door). */
export interface ExampleDoor {
  id: string;
  name: string;
  /** `example`: an example membership exists already (the door reopens it); `member`: a real seat (no door). */
  membership: "none" | "example" | "member";
}

export interface DoorsProps {
  viewer: { email: string | null };
  /** From founder.profile.get: the profile line shown under the title. */
  profileLine?: string | null;
  /**
   * The founder's experience key from their profile ("first_time", "exited", …): Door A is recommended to a first-time
   * founder. Left undefined, the screen reads it from `founder.profile.get` itself.
   */
  experience?: string | null;
  /**
   * Every business the founder belongs to, an example membership included: the screen subtracts the example itself
   * (`ownBusinessCount`), and the title says "Your first business" when none of their own is left. Counted here rather
   * than in the server page, which cannot call a function exported from this client module.
   */
  businessCount: number;
  /** The business the founder came from (the last one opened): Back to it. Null for a first business. */
  backTo?: { id: string; name: string } | null;
  /** The example business, when the deployment has one (`business.example.get`). */
  example?: ExampleDoor | null;
}

interface Door {
  id: "ideate" | "import" | "example";
  icon: IconComponent;
  kicker: string;
  /** Who the door is for, in the founder's own words. */
  title: string;
  /** One plain sentence: what happens behind it. */
  lede: string;
  steps: string[];
  cta: string;
}

interface LinkDoor extends Door {
  id: "ideate" | "import";
  href: string;
}

export const DOORS: LinkDoor[] = [
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
    lede: "Point the import at your code, documents, trackers, revenue and registry; it checks what is there and writes an Import report. The reading starts once you take charge, and it never writes to your sources.",
    steps: ["Pick sources: GitHub, Drive, Notion, Linear, Jira, your website", "Stripe, Shopify, a bank, the company registry", "An Import report: what exists, what is missing, first decisions", "Commit and take charge; the import reads your sources then"],
    cta: "Choose sources",
  },
];

/** The third door (docs/UX_AUDIT_AND_PLAN.md §12 item 5): a read-only walk around the seeded example business. */
export const EXAMPLE_DOOR: Door = {
  id: "example",
  icon: Compass,
  kicker: "Example",
  title: "Explore an example",
  lede: "Walk around a running business before you start yours. Nothing you do there is saved.",
  steps: ["Open a running example business as a viewer: Home, the Inbox, every department and its agents", "Read what the team drafted and how it reports back", "Nothing you do there is saved: the team does no work and no decision is taken", "Leave it from Your businesses, or start your own from its top bar"],
  cta: "Open the example",
};

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

/**
 * The example door shows when the deployment has an example business and the founder does not already belong to it for
 * real (its owner, or someone invited, opens it from Switch business). An example membership that exists is reopened.
 */
export function showsExampleDoor(example: ExampleDoor | null | undefined): example is ExampleDoor {
  return Boolean(example) && example!.membership !== "member";
}

/** The founder's own businesses: an example membership (a walk around the demo) is not one of them. */
export function ownBusinessCount(businessCount: number, example: ExampleDoor | null | undefined): number {
  return example?.membership === "example" ? Math.max(0, businessCount - 1) : businessCount;
}

/** The page's lede under the title: the profile line, else the count of doors. */
export function doorsLede(profileLine: string | null | undefined, doorCount: number): string {
  if (profileLine) return `Your profile: ${profileLine}.`;
  return doorCount === 3 ? "Two doors to a business of your own, and an example to walk around first." : "Two doors. Both end at the same Launch screen.";
}

function DoorCard({ door, recommended, action }: { door: Door; recommended: boolean; action: ReactNode }) {
  return (
    <article className="surface-panel glow-brand edge-tint flex flex-col text-primary" data-door={door.id} data-recommended={recommended || undefined} aria-label={`${door.kicker}: ${door.title}`}>
      <div className="flex flex-1 flex-col gap-5 p-5">
        <div className="flex items-start gap-4">
          <span aria-hidden className="icon-halo tone-kit-lift size-12">
            <Icon icon={door.icon} size={20} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="t-data">{door.kicker}</span>
              {recommended ? (
                <Chip tone="kit" data-testid="door-recommended">
                  Recommended for you
                </Chip>
              ) : null}
            </span>
            <h2 className="t-display-md text-primary">{door.title}</h2>
            <p className="text-body text-pretty text-secondary">{door.lede}</p>
          </div>
        </div>
        {/* What happens behind the door: four plain steps, behind a disclosure so the choice reads first. */}
        <details className="group/steps border-t border-line pt-3" data-testid={`door-${door.id}-steps`}>
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm px-1 t-action text-secondary transition-colors duration-hover ease-out hover:text-primary focus-visible:shadow-ring [&::-webkit-details-marker]:hidden">
            <Icon icon={ChevronRight} size="inline" className="transition-transform duration-overlay ease-out group-open/steps:rotate-90" />
            What happens
          </summary>
          <ol className="mt-3 flex flex-col gap-2">
            {door.steps.map((s, i) => (
              <li key={s} className="flex items-baseline gap-3 text-body text-secondary">
                <span className="inline-flex size-badge shrink-0 items-center justify-center rounded-pill font-mono text-micro text-tertiary ring-1 ring-line-strong">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </details>
        <div className="mt-auto flex justify-end">{action}</div>
      </div>
    </article>
  );
}

export function Doors({ viewer, profileLine, experience, businessCount, backTo, example }: DoorsProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const { toast } = useToast();
  const ideasQ = useQuery(trpc.idea.list.queryOptions({ limit: CONCEPTS_SHOWN }, { staleTime: 15_000 }));
  // The experience comes with the page when the server passed it; otherwise the profile is read once here.
  const profileQ = useQuery(trpc.founder.profile.get.queryOptions(undefined, { enabled: experience === undefined, staleTime: 5 * 60_000 }));
  const recommended = recommendedDoor(experience === undefined ? profileQ.data?.profile?.experience : experience);
  const ideas = ideasQ.data?.items ?? [];
  const moreConcepts = Boolean(ideasQ.data?.nextCursor);
  const exampleDoor = showsExampleDoor(example) ? example : null;
  // Open the example: the viewer membership is written (or found) on the server, then its Home opens as the last business.
  const openExample = useMutation(
    trpc.business.example.open.mutationOptions({
      onSuccess: (result) => {
        rememberLastBusiness(result.businessId);
        router.push(routes.today(result.businessId));
      },
      onError: (err) => toast({ title: "Could not open the example", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return (
    <StudioFrame
      step="new"
      title={doorsTitle(ownBusinessCount(businessCount, example))}
      lede={doorsLede(profileLine, exampleDoor ? 3 : 2)}
      viewer={viewer}
      actions={
        backTo ? (
          <LinkButton variant="ghost" icon={ArrowLeft} href={routes.today(backTo.id)} data-testid="new-back-to-business">
            Back to {backTo.name}
          </LinkButton>
        ) : null
      }
    >
      <div className={exampleDoor ? "grid grid-cols-3 gap-gutter" : "grid grid-cols-2 gap-gutter"} data-testid="doors" data-doors={exampleDoor ? 3 : 2}>
        {DOORS.map((d) => (
          <DoorCard
            key={d.id}
            door={d}
            recommended={recommended === d.id}
            action={
              <LinkButton variant="primary" href={d.href} iconRight={ArrowRight} data-testid={`door-${d.id}`}>
                {d.cta}
              </LinkButton>
            }
          />
        ))}
        {exampleDoor ? (
          <DoorCard
            door={EXAMPLE_DOOR}
            recommended={false}
            action={
              <Button variant="primary" iconRight={ArrowRight} loading={openExample.isPending || openExample.isSuccess} onClick={() => openExample.mutate()} data-testid="door-example" data-example-business={exampleDoor.id}>
                {EXAMPLE_DOOR.cta}
              </Button>
            }
          />
        ) : null}
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
