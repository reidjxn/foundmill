/**
 * A legal document as the public reads it (founder, 2026-11-13): the Terms of Service at `/terms` and the Privacy Policy
 * at `/privacy`, signed out, from 390 px, and indexable. The same family as `ProjectPage` and `PersonPage`: dark like
 * the product, the product's accent as the line along the top, the reading measure, a container query at
 * `--container-page-wide`.
 *
 * The order: a bar with the product's name (back to the site) and the two documents, the title and the date it was last
 * updated, "The short version" (a few plain lines, not a replacement for the text), the contents as anchor links, then
 * the numbered sections. Each section is an `h2` with an id, so `/privacy#cookies` lands on it. The footer links the
 * documents again.
 *
 * The text is structured data, never markup: a paragraph is a string or a run of strings and links, a list is items of
 * the same, and `terms` is a list of names with what each one means (the vendors, the cookies). Every string is a text
 * node. A link is an in-site path, an `https:` address or a `mailto:`; anything else is printed as text.
 *
 * Server-safe (no hooks, no handlers): the public routes render it as a Server Component.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { APP_NAME } from "@foundmill/config";
import { cn } from "../../lib/cn";

/** A run of text, or a link inside it. */
export type LegalInline = string | { text: string; href: string };
/** A paragraph's or a list item's content: one run, or several in order. */
export type LegalText = LegalInline | readonly LegalInline[];

export type LegalBlock =
  | { kind: "p"; text: LegalText }
  | { kind: "list"; items: readonly LegalText[] }
  | { kind: "terms"; items: readonly { term: string; detail: LegalText }[] };

export interface LegalSection {
  /** The anchor: lowercase words and hyphens ("cookies"). */
  id: string;
  heading: string;
  blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  title: string;
  /** "Nov 13, 2026" (US dates, CLAUDE.md). */
  updated: string;
  /** Plain lines above the contents; left out when empty. */
  summary?: readonly LegalText[];
  sections: readonly LegalSection[];
}

export interface LegalPageLink {
  href: string;
  label: string;
  /** This page: shown as the current one, not as a link. */
  current?: boolean;
}

export interface LegalPageProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  document: LegalDocument;
  /** The legal documents, this one marked `current`. */
  links: readonly LegalPageLink[];
  /** Where the product's name in the bar goes. Default the site root. */
  homeHref?: string;
}

/** The words the page prints around the document's own. */
export const LEGAL_PAGE_WORDS = {
  updated: "Last updated",
  summary: "The short version",
  contents: "Contents",
  documents: "Legal",
} as const;

const SAFE_HREF = /^(\/(?!\/)|#|https:\/\/|mailto:)/i;

/** Whether `href` is one the page links: an in-site path, an anchor, an https address or a mailto. */
export function isSafeLegalHref(href: string): boolean {
  return SAFE_HREF.test(href.trim());
}

function Inline({ part }: { part: LegalInline }): ReactNode {
  if (typeof part === "string") return part;
  if (!isSafeLegalHref(part.href)) return part.text;
  const external = /^https:/i.test(part.href);
  return (
    <a href={part.href} className="entity-link break-words" {...(external ? { rel: "noopener noreferrer" } : {})}>
      {part.text}
    </a>
  );
}

function Text({ text }: { text: LegalText }): ReactNode {
  if (typeof text === "string" || !Array.isArray(text)) return <Inline part={text as LegalInline} />;
  return (text as readonly LegalInline[]).map((part, i) => <Inline key={i} part={part} />);
}

function Block({ block }: { block: LegalBlock }): ReactNode {
  if (block.kind === "p") {
    return (
      <p className="t-reading break-words text-prose">
        <Text text={block.text} />
      </p>
    );
  }
  if (block.kind === "list") {
    return (
      <ul className="t-reading flex list-disc flex-col gap-1.5 pl-5 text-prose marker:text-secondary">
        {block.items.map((item, i) => (
          <li key={i} className="break-words pl-1">
            <Text text={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface-1" data-legal-terms="">
      {block.items.map((item) => (
        <div key={item.term} className="flex min-w-0 flex-col gap-0.5 px-4 py-3 @page-wide:flex-row @page-wide:gap-4">
          <dt className="t-body-strong shrink-0 break-words text-primary @page-wide:w-44">{item.term}</dt>
          <dd className="t-body min-w-0 break-words text-secondary">
            <Text text={item.detail} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DocumentLinks({ links, className }: { links: readonly LegalPageLink[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5", className)}>
      {links.map((l) => (
        <li key={l.href}>
          {l.current ? (
            <span aria-current="page" className="t-action inline-flex min-h-tap items-center text-primary">
              {l.label}
            </span>
          ) : (
            <a href={l.href} className="t-action inline-flex min-h-tap items-center rounded-sm text-secondary transition-colors duration-hover hover:text-primary focus-ring">
              {l.label}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

export function LegalPage({ document: doc, links, homeHref = "/", className, ...rest }: LegalPageProps) {
  const summary = (doc.summary ?? []).filter((s) => (typeof s === "string" ? s.trim() : true));
  return (
    <article data-legal-page="" className={cn("@container relative flex min-h-dvh flex-col bg-canvas text-primary", className)} {...rest}>
      <div aria-hidden className="h-1 w-full shrink-0 bg-accent" data-brand-line="" />
      <nav aria-label={LEGAL_PAGE_WORDS.documents} className="border-b border-line">
        <div className="mx-auto flex w-full max-w-reading flex-wrap items-center justify-between gap-x-5 px-gutter">
          <a href={homeHref} className="t-action inline-flex min-h-tap items-center rounded-sm text-primary transition-colors duration-hover hover:text-secondary focus-ring" data-legal-home="">
            {APP_NAME}
          </a>
          <DocumentLinks links={links} />
        </div>
      </nav>
      <div className="mx-auto flex w-full max-w-reading min-w-0 flex-1 flex-col gap-8 px-gutter py-10 @page-wide:gap-10 @page-wide:py-16">
        <header className="flex min-w-0 flex-col gap-2">
          <h1 className="t-display-lg min-w-0 text-balance break-words text-primary @page-wide:t-display-xl">{doc.title}</h1>
          <p className="t-body text-secondary" data-legal-updated="">
            {LEGAL_PAGE_WORDS.updated} {doc.updated}
          </p>
        </header>

        {summary.length ? (
          <section aria-labelledby="legal-summary" className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface-1 px-5 py-4" data-legal-summary="">
            <h2 id="legal-summary" className="t-label text-secondary">
              {LEGAL_PAGE_WORDS.summary}
            </h2>
            <ul className="t-body flex list-disc flex-col gap-1.5 pl-5 text-prose marker:text-secondary">
              {summary.map((s, i) => (
                <li key={i} className="break-words pl-1">
                  <Text text={s} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <nav aria-labelledby="legal-contents" className="flex min-w-0 flex-col gap-2.5" data-legal-contents="">
          <h2 id="legal-contents" className="t-label text-secondary">
            {LEGAL_PAGE_WORDS.contents}
          </h2>
          <ol className="t-body flex list-decimal flex-col pl-7 text-secondary marker:tabular-nums marker:text-tertiary">
            {doc.sections.map((s) => (
              <li key={s.id} className="pl-1">
                <a href={`#${s.id}`} className="inline-flex min-h-tap items-center rounded-sm break-words transition-colors duration-hover hover:text-primary focus-ring @page-wide:min-h-0 @page-wide:py-1">
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {doc.sections.map((s, i) => (
          <section key={s.id} aria-labelledby={s.id} className="flex min-w-0 flex-col gap-4" data-legal-section={s.id}>
            <h2 id={s.id} className="t-display-sm min-w-0 scroll-mt-6 text-balance break-words text-primary">
              <span className="tabular-nums text-tertiary">{i + 1}.</span> {s.heading}
            </h2>
            {s.blocks.map((b, j) => (
              <Block key={j} block={b} />
            ))}
          </section>
        ))}
      </div>
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-reading flex-wrap items-center justify-between gap-x-5 px-gutter">
          <a href={homeHref} className="t-action inline-flex min-h-tap items-center rounded-sm text-secondary transition-colors duration-hover hover:text-primary focus-ring">
            {APP_NAME}
          </a>
          <DocumentLinks links={links} />
        </div>
      </footer>
    </article>
  );
}
