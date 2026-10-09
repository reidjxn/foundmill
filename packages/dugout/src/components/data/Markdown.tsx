import { Children, isValidElement, lazy, Suspense, type ComponentPropsWithoutRef, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { cn } from "../../lib/cn";
import { EntityText, type EntityTextProps } from "./EntityText";
import { entityNodesToPlain, hasEntityMarkup, parseEntityText } from "./entityMarkup";
import type MarkdownEngineType from "./MarkdownEngine";

/*
 * The parser (react-markdown + remark-gfm) is its own chunk: pages that can show Markdown do not carry it in their
 * first load. The browser starts fetching it as soon as this module runs, so it is normally in before any Markdown
 * renders (page data arrives after hydration); until then the text shows plain. Server rendering waits for it.
 */
let engine: typeof MarkdownEngineType | null = null;
let engineLoad: Promise<unknown> | null = null;

/** Load the Markdown parser now (tests, or a page about to show Markdown). Resolves when `Markdown` renders formatted. */
export function preloadMarkdown(): Promise<void> {
  engineLoad ??= import("./MarkdownEngine").then(
    (m) => {
      engine = m.default;
      return m;
    },
    (err: unknown) => {
      engineLoad = null;
      throw err;
    },
  );
  return engineLoad.then(() => undefined);
}

const LazyEngine = lazy(() => preloadMarkdown().then(() => ({ default: engine! })));

if (typeof window !== "undefined") void preloadMarkdown().catch(() => undefined);

/** Shown only while the parser loads: the text, plain (entity mentions by name when they would be linked). */
function PlainFallback({ text, entities }: { text: string; entities: boolean }) {
  return <p className="my-0 whitespace-pre-wrap">{entities ? entityNodesToPlain(parseEntityText(text)) : text}</p>;
}

export interface MarkdownProps extends Pick<
  EntityTextProps,
  "onResolveAmbiguous" | "onCreateDraft" | "onOpen"
> {
  children: string;
  /** `reading` (Inbox note, Inter 15/24 within a 640 px measure) or `body` (13/19). Default reading. */
  variant?: "reading" | "body";
  className?: string;
  /** Open external links in a new tab (default true). */
  externalLinks?: boolean;
  /**
   * Load images (default true). Text written by other people (a community post) passes `false`: an image there would
   * make the reader's browser fetch from a stranger's server, so it shows its alt text instead.
   */
  images?: boolean;
  /**
   * Turn `[[ent:<uuid>|Name]]` mentions into entity links (default true). Text written by other people passes `false`:
   * a mention there names something in the author's business, not one the reader can open, so nothing in it is ever
   * linked and the mention stays as the literal text it was typed as (no pre-filtering that a Markdown escape or a
   * character reference could get around).
   */
  entities?: boolean;
}

/** Replace string children that carry entity markup with EntityText; leave everything else as is. */
function linkify(
  children: ReactNode,
  handlers: Pick<EntityTextProps, "onResolveAmbiguous" | "onCreateDraft" | "onOpen">,
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return hasEntityMarkup(child) ? <EntityText {...handlers}>{child}</EntityText> : child;
    }
    return child;
  });
}

/**
 * Markdown in the DESIGN §4 reading style (react-markdown + remark-gfm). Entity markup inside paragraphs, list items,
 * headings, table cells and emphasis renders through `EntityText`. Raw HTML is skipped.
 */
export function Markdown({
  children,
  variant = "reading",
  className,
  externalLinks = true,
  images = true,
  entities = true,
  onResolveAmbiguous,
  onCreateDraft,
  onOpen,
}: MarkdownProps) {
  const handlers = { onResolveAmbiguous, onCreateDraft, onOpen };
  const L = (c: ReactNode) => (entities ? linkify(c, handlers) : c);
  const components: Components = {
    p: ({ children: c, ...rest }: ComponentPropsWithoutRef<"p">) => (
      <p className="my-0 [&+&]:mt-3 [&+ul]:mt-2 [&+ol]:mt-2" {...rest}>
        {L(c)}
      </p>
    ),
    h1: ({ children: c, ...rest }: ComponentPropsWithoutRef<"h1">) => (
      <h1 className="t-display-md mt-5 mb-2 text-primary first:mt-0" {...rest}>
        {L(c)}
      </h1>
    ),
    h2: ({ children: c, ...rest }: ComponentPropsWithoutRef<"h2">) => (
      <h2 className="t-display-sm mt-4 mb-1.5 text-primary first:mt-0" {...rest}>
        {L(c)}
      </h2>
    ),
    h3: ({ children: c, ...rest }: ComponentPropsWithoutRef<"h3">) => (
      <h3 className="t-body-strong mt-3 mb-1 text-primary first:mt-0" {...rest}>
        {L(c)}
      </h3>
    ),
    h4: ({ children: c, ...rest }: ComponentPropsWithoutRef<"h4">) => (
      <h4 className="t-title mt-3 mb-1 text-primary first:mt-0" {...rest}>
        {L(c)}
      </h4>
    ),
    h5: ({ children: c, ...rest }: ComponentPropsWithoutRef<"h5">) => (
      <h5 className="t-title mt-3 mb-1 text-secondary first:mt-0" {...rest}>
        {L(c)}
      </h5>
    ),
    h6: ({ children: c, ...rest }: ComponentPropsWithoutRef<"h6">) => (
      <h6 className="t-data mt-3 mb-1 first:mt-0" {...rest}>
        {L(c)}
      </h6>
    ),
    ul: ({ children: c, className: cls, ...rest }: ComponentPropsWithoutRef<"ul">) => (
      <ul
        className={cn(
          "my-2 list-disc pl-5 marker:text-secondary",
          cls?.includes("contains-task-list") && "list-none pl-1",
        )}
        {...rest}
      >
        {c}
      </ul>
    ),
    ol: ({ children: c, ...rest }: ComponentPropsWithoutRef<"ol">) => (
      <ol className="my-2 list-decimal pl-5 marker:text-secondary marker:tabular-nums" {...rest}>
        {c}
      </ol>
    ),
    li: ({ children: c, ...rest }: ComponentPropsWithoutRef<"li">) => (
      <li className="my-0.5 [&>p]:my-0" {...rest}>
        {L(c)}
      </li>
    ),
    strong: ({ children: c, ...rest }: ComponentPropsWithoutRef<"strong">) => (
      <strong className="font-medium text-primary" {...rest}>
        {L(c)}
      </strong>
    ),
    em: ({ children: c, ...rest }: ComponentPropsWithoutRef<"em">) => (
      <em className="italic" {...rest}>
        {L(c)}
      </em>
    ),
    a: ({ children: c, href, ...rest }: ComponentPropsWithoutRef<"a">) => {
      const external = externalLinks && !!href && /^https?:/i.test(href);
      return (
        <a
          href={href}
          className="entity-link"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          {...rest}
        >
          {c}
          {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
        </a>
      );
    },
    blockquote: ({ children: c, ...rest }: ComponentPropsWithoutRef<"blockquote">) => (
      <blockquote className="my-2 border-l-2 border-kit-lift/40 pl-3 text-secondary" {...rest}>
        {c}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-line" />,
    code: ({ children: c, className: cls, ...rest }: ComponentPropsWithoutRef<"code">) => {
      const block = typeof cls === "string" && cls.startsWith("language-");
      return (
        <code
          className={cn(
            "rounded-xs font-mono text-mono",
            block ? "block" : "bg-white/6 px-1 py-px text-primary ring-1 ring-inset ring-line",
            cls,
          )}
          {...rest}
        >
          {c}
        </code>
      );
    },
    pre: ({ children: c, ...rest }: ComponentPropsWithoutRef<"pre">) => (
      <pre
        className="my-2 overflow-x-auto rounded-md border border-line bg-ink p-3 font-mono text-mono text-primary"
        {...rest}
      >
        {c}
      </pre>
    ),
    table: ({ children: c, ...rest }: ComponentPropsWithoutRef<"table">) => (
      <div className="my-2 overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-body" {...rest}>
          {c}
        </table>
      </div>
    ),
    thead: ({ children: c, ...rest }: ComponentPropsWithoutRef<"thead">) => (
      <thead {...rest}>
        {c}
      </thead>
    ),
    th: ({ children: c, style, ...rest }: ComponentPropsWithoutRef<"th">) => (
      <th
        className={cn(
          "t-data h-control-sm border-b border-line px-2.5 text-left",
          style?.textAlign === "right" && "text-right",
        )}
        style={style}
        {...rest}
      >
        {L(c)}
      </th>
    ),
    td: ({ children: c, style, ...rest }: ComponentPropsWithoutRef<"td">) => (
      <td
        className={cn(
          "h-row-compact border-b hairline-50 px-2 align-middle last:border-b-0",
          style?.textAlign === "right" && "text-right tabular-nums",
        )}
        style={style}
        {...rest}
      >
        {L(c)}
      </td>
    ),
    input: ({ type, checked, ...rest }: ComponentPropsWithoutRef<"input">) =>
      type === "checkbox" ? (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          className="mr-1.5 size-3.5 accent-kit-primary align-middle"
          {...rest}
        />
      ) : (
        <input type={type} {...rest} />
      ),
    img: ({ alt, ...rest }: ComponentPropsWithoutRef<"img">) =>
      images ? (
        <img
          alt={alt ?? ""}
          className="my-2 max-w-full rounded-md border border-line"
          {...rest}
        />
      ) : alt ? (
        <span className="text-secondary">{alt}</span>
      ) : null,
  };
  // Once loaded, the parser renders at once (no Suspense round); before that, LazyEngine suspends to the fallback.
  const Engine = engine ?? LazyEngine;
  return (
    <div
      className={cn(variant === "reading" ? "t-reading" : "t-body", "text-primary", className)}
      data-markdown
    >
      <Suspense fallback={<PlainFallback text={children} entities={entities} />}>
        <Engine components={components}>{children}</Engine>
      </Suspense>
    </div>
  );
}

/** True when a node tree contains any element (used by tests of linkify behaviour). */
export function hasElements(children: ReactNode): boolean {
  return Children.toArray(children).some((c) => isValidElement(c));
}
