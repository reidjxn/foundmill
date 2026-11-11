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
 * phone does. No form, no sign-up: the one link is "Made with Foundmill", to the site's home.
 *
 * Server-safe (no hooks, no handlers): the public route renders it as a Server Component.
 */
import { useId, type CSSProperties, type HTMLAttributes } from "react";
import { Sprout } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { PAGE_STAGE_LABELS, builtByLine, pageParagraphs, type PageStage } from "@foundmill/shared/project-page";
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
  /** Where "Made with Foundmill" goes. Default the site root. */
  homeHref?: string;
  /** "page" fills the window (the public route); "preview" sits inside a frame (the console). */
  variant?: "page" | "preview";
}

/** The words the page prints around the founder's own. */
export const PROJECT_PAGE_WORDS = {
  forWhom: "Who it is for",
  about: "About",
  published: (on: string) => `Published ${on}`,
  madeWith: `Made with ${APP_NAME}`,
} as const;

export function ProjectPage({ name, pitch, about, forWhom, stage, publishedAt, brandPrimary, brandSecondary, logo, founderNames, homeHref = "/", variant = "page", className, style, ...rest }: ProjectPageProps) {
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
          <h1 className="t-display-lg min-w-0 text-balance break-words text-primary @page-wide:t-display-xl" data-project-pitch="">
            {pitch}
          </h1>
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
            <h2 id={whoId} className="t-label text-kit-lift">
              {PROJECT_PAGE_WORDS.forWhom}
            </h2>
            <p className="t-reading whitespace-pre-line break-words text-prose">{who}</p>
          </section>
        ) : null}

        {builtBy ? (
          <p className="t-body break-words text-secondary" data-project-built-by="">
            {builtBy}
          </p>
        ) : null}
      </div>
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-reading px-gutter">
          <a href={homeHref} className="t-action inline-flex min-h-tap items-center rounded-sm text-secondary transition-colors duration-hover hover:text-primary focus-ring" data-project-made-with="">
            {PROJECT_PAGE_WORDS.madeWith}
          </a>
        </div>
      </footer>
    </article>
  );
}
