/**
 * A person's public profile (docs/THESIS_REVIEW.md package 2.3; DESIGN §9b "Public pages"): what anyone sees at
 * `/u/<handle>`, signed out, from 390 px. The same component draws the edit screen's live preview at phone width, so
 * the person sees exactly what goes out. The same family as `ProjectPage`: dark like the product, a line along the top
 * (Foundmill's accent: a person has no brand colors of their own), the reading measure, a container query at
 * `--container-page-wide` so the preview lays it out as a phone does,. It carries no mark of the product at all (founder, 2026-11-12): the mark belongs to what a person builds, a project's page on the free plan, never to the person.
 *
 * An initials avatar (no picture yet), the name as the headline, then the person's own headline, the place, one line
 * for what they are here for only when it is about people (`lookingForLine`; "Building on my own" shows nothing at
 * all), about in paragraphs, "Good at" and "Wants to learn" as chips, and the person's public project pages as cards
 * that link to `/p/<slug>`. Every section appears only when there is something in it. Every string is a text node:
 * nothing is ever read as markdown or HTML. No contact button (connecting is a later package).
 *
 * Server-safe (no hooks beyond useId, no handlers): the public route renders it as a Server Component.
 */
import { useId, type HTMLAttributes } from "react";
import { ArrowUpRight, Handshake, MapPin } from "lucide-react";
import { lookingForLine, type PersonLookingFor } from "@foundmill/shared/person-profile";
import { pageParagraphs } from "@foundmill/shared/project-page";
import { cn } from "../../lib/cn";
import { AvatarBase } from "../foundation/Avatar";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";

export interface PersonPageProject {
  /** The project page's address under /p/. */
  slug: string;
  name: string;
  pitch: string;
  /** Where the card links. Default `/p/<slug>`. */
  href?: string;
}

export interface PersonPageProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "about"> {
  /** The person's display name: the headline and the avatar's initials. */
  name: string;
  /** One line under the name; left out when empty. */
  headline?: string | null;
  /** Plain text; paragraphs on blank lines; left out when empty. */
  about?: string | null;
  /** "Good at" chips. */
  strengths?: readonly string[] | null;
  /** "Wants to learn" chips. */
  wantsToLearn?: readonly string[] | null;
  /** What the person is here for. "on_my_own" (the default) shows nothing at all. */
  lookingFor?: PersonLookingFor | null;
  /** Free text ("Manchester, UK"); left out when empty. */
  place?: string | null;
  /** The person's public project pages. */
  projects?: readonly PersonPageProject[] | null;
  /** "page" fills the window (the public route); "preview" sits inside a frame (the edit screen). */
  variant?: "page" | "preview";
}

/** The words the page prints around the person's own. */
export const PERSON_PAGE_WORDS = {
  about: "About",
  strengths: "Good at",
  wantsToLearn: "Wants to learn",
  projects: "Projects",
  place: "Based in",
} as const;

const clean = (tags: readonly string[] | null | undefined): string[] => (tags ?? []).map((t) => t.trim()).filter(Boolean);

export function PersonPage({ name, headline, about, strengths, wantsToLearn, lookingFor, place, projects, variant = "page", className, ...rest }: PersonPageProps) {
  const paragraphs = pageParagraphs(about ?? "");
  const good = clean(strengths);
  const learn = clean(wantsToLearn);
  const line = lookingForLine(lookingFor ?? "on_my_own");
  const where = (place ?? "").trim();
  const sub = (headline ?? "").trim();
  const list = (projects ?? []).filter((p) => p.slug && p.name);
  const goodId = useId();
  const learnId = useId();
  const projectsId = useId();
  // A full page is the document's one main landmark; a preview sits inside the console's own <main>, as an article.
  const Root = variant === "page" ? "div" : "article";
  const Body = variant === "page" ? "main" : "div";
  return (
    <Root data-person-page="" data-variant={variant} className={cn("@container relative flex flex-col bg-canvas text-primary", variant === "page" ? "min-h-dvh" : "min-h-full", className)} {...rest}>
      {/* The line along the top, as on a project's page; a person has no brand colors, so it is the product's accent. */}
      <div aria-hidden className="h-1 w-full shrink-0 bg-accent" data-brand-line="" />
      <Body className="mx-auto flex w-full max-w-reading min-w-0 flex-1 flex-col gap-8 px-gutter py-10 @page-wide:gap-10 @page-wide:py-16">
        <header className="flex min-w-0 flex-col gap-4">
          <AvatarBase name={name} size={64} ring="none" className="self-start" data-person-avatar="" />
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="t-display-lg min-w-0 text-balance break-words text-primary @page-wide:t-display-xl" data-person-name="">
              {name}
            </h1>
            {sub ? (
              <p className="t-reading min-w-0 text-balance break-words text-secondary" data-person-headline="">
                {sub}
              </p>
            ) : null}
          </div>
          {where || line ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {where ? (
                <span className="t-body inline-flex min-w-0 items-center gap-1.5 break-words text-secondary" data-person-place="">
                  <Icon icon={MapPin} size="inline" label={PERSON_PAGE_WORDS.place} />
                  {where}
                </span>
              ) : null}
              {line ? (
                <Chip tone="info" icon={Handshake} data-person-looking-for={lookingFor ?? ""}>
                  {line}
                </Chip>
              ) : null}
            </div>
          ) : null}
        </header>

        {paragraphs.length ? (
          <section aria-label={PERSON_PAGE_WORDS.about} className="flex min-w-0 flex-col gap-4" data-person-about="">
            {paragraphs.map((p, i) => (
              <p key={i} className="t-reading whitespace-pre-line break-words text-prose">
                {p}
              </p>
            ))}
          </section>
        ) : null}

        {good.length ? (
          <section aria-labelledby={goodId} className="flex min-w-0 flex-col gap-2.5" data-person-strengths="">
            <h2 id={goodId} className="t-label text-secondary">
              {PERSON_PAGE_WORDS.strengths}
            </h2>
            <ul className="flex flex-wrap gap-1.5">
              {good.map((t) => (
                <li key={t} className="flex max-w-full">
                  <Chip tone="neutral">{t}</Chip>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {learn.length ? (
          <section aria-labelledby={learnId} className="flex min-w-0 flex-col gap-2.5" data-person-wants-to-learn="">
            <h2 id={learnId} className="t-label text-secondary">
              {PERSON_PAGE_WORDS.wantsToLearn}
            </h2>
            <ul className="flex flex-wrap gap-1.5">
              {learn.map((t) => (
                <li key={t} className="flex max-w-full">
                  <Chip tone="neutral">{t}</Chip>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {list.length ? (
          <section aria-labelledby={projectsId} className="flex min-w-0 flex-col gap-2.5" data-person-projects="">
            <h2 id={projectsId} className="t-label text-secondary">
              {PERSON_PAGE_WORDS.projects}
            </h2>
            <ul className="flex flex-col gap-2">
              {list.map((p) => (
                <li key={p.slug}>
                  <a
                    href={p.href ?? `/p/${p.slug}`}
                    className="group flex min-h-tap min-w-0 items-start justify-between gap-3 rounded-md border border-line bg-surface-1 px-4 py-3 transition-colors duration-hover hover:border-line-strong hover:no-underline focus-ring"
                    data-person-project={p.slug}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="t-body-strong break-words text-primary">{p.name}</span>
                      {p.pitch ? <span className="t-small break-words text-secondary">{p.pitch}</span> : null}
                    </span>
                    <Icon icon={ArrowUpRight} size="inline" className="mt-0.5 shrink-0 text-tertiary transition-colors duration-hover group-hover:text-primary" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </Body>
    </Root>
  );
}
