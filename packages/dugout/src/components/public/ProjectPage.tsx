/**
 * A project's public page (docs/THESIS_REVIEW.md package 1.1; DESIGN §9 "Public project page"): what anyone sees at
 * `/p/<slug>`, signed out, from 390 px. The same component draws the console's live preview (Product › Public page) at
 * phone width, so the founder sees exactly what goes out.
 *
 * Dark like the product. The business's brand colors are accents only, as on the business badge: the logo tile, a
 * brand line along the top and the stage chip in the brand's lifted tone. The pitch is the headline; "about" reads in
 * the 640 px measure, split into paragraphs on blank lines; "Who it is for" and "Built by …" appear only when there is
 * something to say. Every string is a text node: nothing here is ever read as markdown or HTML. The layout follows its
 * own width (a container query at `--container-page-wide`), not the window's, so the preview frame lays it out as a
 * phone does. The one form is the "Follow" form (`ProjectFollowForm`, package 1.6), passed in as `follow` when the
 * founders left it on; the page itself sends nothing. When the founders turned on their quiz (`ProjectQuiz`, 0105) it
 * comes just before, as `quiz`.
 *
 * The foot carries the mark, "Built on Foundmill" (docs/NETWORK.md F2; founder, 2026-11-12): small, quiet, and made for
 * the project's visitors more than for Foundmill's own members. `mark` says who is looking:
 *   - "visitor": the one link on the page, in small secondary text, which comes up from dim as the foot scrolls into
 *     view (`mark-arrive`) and goes to `markHref`;
 *   - "member": the same words as plain metadata (`text-3`), no link, for someone signed in to Foundmill;
 *   - "none": no foot at all, for a project on a paid plan.
 *
 * Server-safe (no hooks, no handlers): the public route renders it as a Server Component.
 */
import { useId, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { Sprout } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { PAGE_STAGE_LABELS, builtByLine, builtOnWords, pageParagraphs, type PageStage } from "@foundmill/shared/project-page";
import { cn } from "../../lib/cn";
import { formatDate } from "../../lib/format";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { Chip } from "../foundation/Chip";
import { kitStyle } from "../shell/KitBar";

export interface ProjectPageProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The project's name. */
  name: string;
  /** One line, the headline. */
  pitch: string;
  /** Plain text; paragraphs on blank lines. */
  about: string;
  /** "Who it is for"; left out when empty. */
  forWhom?: string | null;
  stage: PageStage;
  /** When the page went live ("Published Oct 7, 2026"); left out before it is published. */
  publishedAt?: Date | string | null;
  /** Brand colors (hex): accents only. */
  brandPrimary: string;
  brandSecondary: string;
  /** The logo as a checked `data:` URL; the initials mark otherwise. */
  logo?: string | null;
  /** The people it names ("Built by Maya and Sam"); nothing when empty. */
  founderNames?: readonly string[] | null;
  /** Who the "Built on" mark is drawn for (see above). Default "visitor". */
  mark?: ProjectPageMark;
  /** Where a visitor's mark goes. Default the site root. */
  markHref?: string;
  /**
   * The level of the page's title: 1 on its own route (default); 3 when the page is shown inside another page as an
   * example (the landing page), so that page keeps one h1. Its section labels follow one level below.
   */
  titleLevel?: 1 | 3;
  /** "page" fills the window (the public route); "preview" sits inside a frame (the console). */
  variant?: "page" | "preview";
  /** The "Follow" form (`ProjectFollowForm`), after everything the founders wrote; nothing when the page has none. */
  follow?: ReactNode;
  /** The optional "Which one is for you?" quiz (`ProjectQuiz`, 0105), just before the Follow form; nothing when it is off. */
  quiz?: ReactNode;
}

/** Who the foot's mark is drawn for; "none" leaves the foot out (a paid plan). */
export type ProjectPageMark = "visitor" | "member" | "none";

/** The words the page prints around the founder's own. */
export const PROJECT_PAGE_WORDS = {
  forWhom: "Who it is for",
  about: "About",
  published: (on: string) => `Published ${on}`,
  builtOn: builtOnWords(APP_NAME).mark,
} as const;

export function ProjectPage({ name, pitch, about, forWhom, stage, publishedAt, brandPrimary, brandSecondary, logo, founderNames, mark = "visitor", markHref = "/", titleLevel = 1, variant = "page", follow, quiz, className, style, ...rest }: ProjectPageProps) {
  const Title = titleLevel === 1 ? "h1" : "h3";
  const Sub = titleLevel === 1 ? "h2" : "h4";
  const paragraphs = pageParagraphs(about);
  const who = (forWhom ?? "").trim();
  const builtBy = builtByLine(founderNames);
  const published = publishedAt ? formatDate(publishedAt, "date") : null;
  const whoId = useId();
  const rootStyle: CSSProperties = { ...kitStyle({ primary: brandPrimary, secondary: brandSecondary }), ...style };
  return (
    <article
      data-project-page=""
      data-variant={variant}
      className={cn("@container relative flex flex-col bg-canvas text-primary", variant === "page" ? "min-h-dvh" : "min-h-full", className)}
      style={rootStyle}
      {...rest}
    >
      {/* The brand line, as on the top bar's lower edge: the business's color, never a fill behind text. */}
      <div aria-hidden className="h-1 w-full shrink-0 bg-kit-primary" data-brand-line="" />
      <div className="mx-auto flex w-full max-w-reading min-w-0 flex-1 flex-col gap-8 px-gutter py-10 @page-wide:gap-10 @page-wide:py-16">
        <header className="flex min-w-0 flex-col gap-5">
          <div className="flex min-w-0 items-center gap-3">
            <BusinessLogo src={logo} name={name} primary={brandPrimary} size={48} title="" />
            <p className="t-display-sm min-w-0 break-words text-primary" data-project-name="">
              {name}
            </p>
          </div>
          <Title className="t-display-lg min-w-0 text-balance break-words text-primary @page-wide:t-display-xl" data-project-pitch="">
            {pitch}
          </Title>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Chip tone="kit" icon={Sprout} data-project-stage={stage}>
              {PAGE_STAGE_LABELS[stage]}
            </Chip>
            {published ? (
              <span className="t-small text-secondary" data-project-published="">
                {PROJECT_PAGE_WORDS.published(published)}
              </span>
            ) : null}
          </div>
        </header>

        <section aria-label={PROJECT_PAGE_WORDS.about} className="flex min-w-0 flex-col gap-4" data-project-about="">
          {paragraphs.map((p, i) => (
            <p key={i} className="t-reading whitespace-pre-line break-words text-prose">
              {p}
            </p>
          ))}
        </section>

        {who ? (
          <section aria-labelledby={whoId} className="flex min-w-0 flex-col gap-2 border-l-2 border-kit-primary pl-4" data-project-for-whom="">
            <Sub id={whoId} className="t-label text-kit-lift">
              {PROJECT_PAGE_WORDS.forWhom}
            </Sub>
            <p className="t-reading whitespace-pre-line break-words text-prose">{who}</p>
          </section>
        ) : null}

        {builtBy ? (
          <p className="t-body break-words text-secondary" data-project-built-by="">
            {builtBy}
          </p>
        ) : null}

        {quiz ?? null}

        {/* The quiz's Follow buttons lead here (`#follow`). */}
        {follow ? (
          <div id="follow" className="min-w-0 scroll-mt-6">
            {follow}
          </div>
        ) : null}
      </div>
      {mark === "none" ? null : (
        <footer className="border-t border-line-faint" data-project-mark={mark}>
          <div className="mx-auto flex w-full max-w-reading px-gutter">
            {mark === "visitor" ? (
              <a href={markHref} className="mark-arrive t-small inline-flex min-h-tap items-center rounded-sm text-secondary transition-colors duration-hover hover:text-primary focus-ring">
                {PROJECT_PAGE_WORDS.builtOn}
              </a>
            ) : (
              <p className="t-small flex min-h-tap items-center text-tertiary">{PROJECT_PAGE_WORDS.builtOn}</p>
            )}
          </div>
        </footer>
      )}
    </article>
  );
}
