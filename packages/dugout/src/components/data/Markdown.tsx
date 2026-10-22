"use client";
import { Children, isValidElement, lazy, Suspense, useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { ENTITY_MARKUP_RE } from "@foundmill/shared/constants";
import { cn } from "../../lib/cn";
import { useGuidance, type TermDefinition } from "../guidance/GuidanceProvider";
import { Term } from "../guidance/Term";
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

/* ---------- defined terms in a note (docs/UX_AUDIT_AND_PLAN.md §6.2 `Term`: "a Markdown rule that wraps the first occurrence of a defined term per note") ---------- */

/**
 * The first occurrence of each defined term is marked in the source before it is parsed, with private-use characters
 * the parser carries through as text: `<id><words as written>`. The render side turns a mark into a
 * `Term` and strips any stray marker. Marking the source (rather than wrapping at render time) keeps "first per note"
 * exact whatever order or how many times React renders the parsed tree.
 */
const TERM_OPEN = "";
const TERM_MID = "";
const TERM_CLOSE = "";
const TERM_MARK_RE = /([^-]*)([^-]*)/g;
const TERM_MARKERS_RE = /[-]/g;

/**
 * Where a term is never wrapped: fenced and inline code, links and images (text and target), reference links and their
 * definitions, autolinks and HTML tags, bare URLs and emails (GFM links), and entity mentions.
 */
const SKIP_PATTERNS: readonly RegExp[] = [
  /```[\s\S]*?(?:```|$)/g,
  /~~~[\s\S]*?(?:~~~|$)/g,
  /`[^`\n]*`/g,
  /!?\[[^\]\n]*\]\([^)\n]*\)/g,
  /\[[^\]\n]*\]\[[^\]\n]*\]/g,
  /^[ \t]*\[[^\]\n]+\]:[^\n]*$/gm,
  /<[^<>\s][^<>]*>/g,
  /\b(?:https?:\/\/|www\.)[^\s<>)]+/gi,
  /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi,
  new RegExp(ENTITY_MARKUP_RE.source, "g"),
];

type Span = readonly [start: number, end: number, ...rest: unknown[]];

function skipSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const re of SKIP_PATTERNS) for (const m of text.matchAll(re)) if (m[0].length) out.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return out;
}

const overlaps = (spans: readonly Span[], start: number, end: number): boolean => spans.some(([a, b]) => start < b && end > a);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A whole-word, case-insensitive match of the term's display word (a multi-word term matches on one line), with an
 * optional plural ("cycles", "branches"). Word edges are letters, digits and underscores, so "runway" never matches
 * inside "runways-end" and "MRR" never inside "MRRX".
 */
export function termRegExp(word: string): RegExp {
  const body = word
    .trim()
    .split(/\s+/)
    .map(escapeRe)
    .join("[ \\t]+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?:s|es)?(?![\\p{L}\\p{N}_])`, "giu");
}

export interface CompiledTerm {
  readonly id: string;
  readonly re: RegExp;
}

/** Compiled expressions per terms map (the provider's map is stable, so a note re-render compiles nothing). */
const compiledByTerms = new WeakMap<object, readonly CompiledTerm[]>();

/**
 * The terms map's words as compiled expressions, longest word first, cached per map object. Exported for tests.
 */
export function compiledTerms(terms: Readonly<Record<string, TermDefinition>>): readonly CompiledTerm[] {
  let compiled = compiledByTerms.get(terms);
  if (!compiled) {
    compiled = Object.values(terms)
      .filter((d) => d.word.trim().length > 0)
      .sort((a, b) => b.word.length - a.word.length)
      .map((d) => ({ id: d.id, re: termRegExp(d.word) }));
    compiledByTerms.set(terms, compiled);
  }
  return compiled;
}

/**
 * The source with the first occurrence of each defined term marked (one per term, never inside a link, code or an
 * entity mention). Longer words are placed first, so "Net burn" is taken before "Burn" can claim its tail; a shorter
 * term then takes its first occurrence outside any longer one. Pure; exported for tests.
 */
export function markTerms(text: string, terms: Readonly<Record<string, TermDefinition>>): string {
  const compiled = compiledTerms(terms);
  if (!text || compiled.length === 0) return text;
  const skips = skipSpans(text);
  const taken: Array<[start: number, end: number, id: string]> = [];
  for (const def of compiled) {
    // matchAll works on a copy of the expression, so the cached one is never advanced.
    for (const m of text.matchAll(def.re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (overlaps(skips, start, end) || overlaps(taken, start, end)) continue;
      taken.push([start, end, def.id]);
      break;
    }
  }
  if (taken.length === 0) return text;
  taken.sort((a, b) => a[0] - b[0]);
  let out = "";
  let cursor = 0;
  for (const [start, end, id] of taken) {
    out += `${text.slice(cursor, start)}${TERM_OPEN}${id}${TERM_MID}${text.slice(start, end)}${TERM_CLOSE}`;
    cursor = end;
  }
  return out + text.slice(cursor);
}

/** The text without any term marker (the words stay). */
export function unmarkTerms(text: string): string {
  return text.replace(TERM_MARK_RE, "$2").replace(TERM_MARKERS_RE, "");
}

const hasTermMarks = (text: string): boolean => text.includes(TERM_OPEN);

/** Shown only while the parser loads: the text, plain (entity mentions by name when they would be linked). */
function PlainFallback({ text, entities }: { text: string; entities: boolean }) {
  const plain = unmarkTerms(text);
  return <p className="my-0 whitespace-pre-wrap">{entities ? entityNodesToPlain(parseEntityText(plain)) : plain}</p>;
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
  /**
   * Wrap the first occurrence of each defined term (the GuidanceProvider's map, `TERMS` through the business glossary)
   * in a `Term` with its definition on hover (default false; the Inbox turns it on for note bodies). Whole word,
   * case-insensitive, once per term per note, never inside a link, code or an entity mention. Off while guidance is off.
   */
  terms?: boolean;
}

type Handlers = Pick<EntityTextProps, "onResolveAmbiguous" | "onCreateDraft" | "onOpen">;

/** A string with entity markup → EntityText (when entities are on); anything else as is. Stray term markers are dropped. */
function entityOrPlain(text: string, handlers: Handlers, entities: boolean): ReactNode {
  const plain = unmarkTerms(text);
  return entities && hasEntityMarkup(plain) ? <EntityText {...handlers}>{plain}</EntityText> : plain;
}

/**
 * Replace string children that carry term marks or entity markup with `Term`s and `EntityText`; leave everything else
 * as is.
 */
function inline(children: ReactNode, handlers: Handlers, entities: boolean): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    if (!hasTermMarks(child)) return entityOrPlain(child, handlers, entities);
    const parts: ReactNode[] = [];
    let cursor = 0;
    for (const m of child.matchAll(TERM_MARK_RE)) {
      const start = m.index ?? 0;
      if (start > cursor) parts.push(entityOrPlain(child.slice(cursor, start), handlers, entities));
      parts.push(
        <Term key={`${m[1]}-${start}`} id={m[1]!}>
          {m[2]}
        </Term>,
      );
      cursor = start + m[0].length;
    }
    if (cursor < child.length) parts.push(entityOrPlain(child.slice(cursor), handlers, entities));
    return <>{parts}</>;
  });
}

/** Plain text for the places a term never goes (links, code): the words without their markers. */
function plain(children: ReactNode): ReactNode {
  return Children.map(children, (child) => (typeof child === "string" ? unmarkTerms(child) : child));
}

/**
 * Markdown in the DESIGN §4 reading style (react-markdown + remark-gfm). Entity markup inside paragraphs, list items,
 * headings, table cells and emphasis renders through `EntityText`; with `terms`, the first occurrence of each defined
 * term in those places renders through `Term`. Raw HTML is skipped.
 */
export function Markdown({
  children,
  variant = "reading",
  className,
  externalLinks = true,
  images = true,
  entities = true,
  terms = false,
  onResolveAmbiguous,
  onCreateDraft,
  onOpen,
}: MarkdownProps) {
  const handlers = { onResolveAmbiguous, onCreateDraft, onOpen };
  const guidance = useGuidance();
  // The source with its terms marked; a note shows no term while guidance is off (tutoring, UX plan §5 principle 9).
  const markOn = terms && guidance.guidance === "on";
  const termMap = guidance.terms;
  const source = useMemo(() => (markOn ? markTerms(children, termMap) : children), [markOn, children, termMap]);
  const L = (c: ReactNode) => (entities || terms ? inline(c, handlers, entities) : c);
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
      // The parser blanks a URL it will not follow (javascript:, data:, vbscript:) to "". That is text, not a link: an
      // anchor with an empty href would look clickable and reload the page.
      if (!href) return <span>{plain(c)}</span>;
      const external = externalLinks && /^https?:/i.test(href);
      return (
        <a
          href={href}
          className="entity-link"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          {...rest}
        >
          {plain(c)}
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
          {plain(c)}
        </code>
      );
    },
    pre: ({ children: c, ...rest }: ComponentPropsWithoutRef<"pre">) => (
      <pre
        className="my-2 overflow-x-auto rounded-md border border-line bg-ink p-3 font-mono text-mono text-primary"
        data-scroll-region="code"
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
          alt={alt === undefined ? "" : unmarkTerms(alt)}
          className="my-2 max-w-full rounded-md border border-line"
          {...rest}
        />
      ) : alt ? (
        <span className="text-secondary">{unmarkTerms(alt)}</span>
      ) : null,
  };
  // Once loaded, the parser renders at once (no Suspense round); before that, LazyEngine suspends to the fallback.
  const Engine = engine ?? LazyEngine;
  return (
    <div
      className={cn(variant === "reading" ? "t-reading" : "t-body", "text-primary", className)}
      data-markdown
      data-terms={source !== children || undefined}
    >
      <Suspense fallback={<PlainFallback text={source} entities={entities} />}>
        <Engine components={components}>{source}</Engine>
      </Suspense>
    </div>
  );
}

/** True when a node tree contains any element (used by tests of linkify behaviour). */
export function hasElements(children: ReactNode): boolean {
  return Children.toArray(children).some((c) => isValidElement(c));
}
