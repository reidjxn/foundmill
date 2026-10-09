import { Children, isValidElement, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";
import { EntityText, type EntityTextProps } from "./EntityText";
import { hasEntityMarkup } from "./entityMarkup";

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
  onResolveAmbiguous,
  onCreateDraft,
  onOpen,
}: MarkdownProps) {
  const handlers = { onResolveAmbiguous, onCreateDraft, onOpen };
  const L = (c: ReactNode) => linkify(c, handlers);
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
      <h4 className="t-label mt-3 mb-1 first:mt-0" {...rest}>
        {L(c)}
      </h4>
    ),
    h5: ({ children: c, ...rest }: ComponentPropsWithoutRef<"h5">) => (
      <h5 className="t-label mt-3 mb-1 first:mt-0" {...rest}>
        {L(c)}
      </h5>
    ),
    h6: ({ children: c, ...rest }: ComponentPropsWithoutRef<"h6">) => (
      <h6 className="t-label mt-3 mb-1 first:mt-0" {...rest}>
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
          className="text-link hover:underline"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          {...rest}
        >
          {c}
          {external ? (
            <Icon icon={ExternalLink} size={12} className="ml-0.5 inline align-baseline" />
          ) : null}
        </a>
      );
    },
    blockquote: ({ children: c, ...rest }: ComponentPropsWithoutRef<"blockquote">) => (
      <blockquote className="my-2 border-l-2 border-subtle pl-3 text-secondary" {...rest}>
        {c}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-subtle" />,
    code: ({ children: c, className: cls, ...rest }: ComponentPropsWithoutRef<"code">) => {
      const block = typeof cls === "string" && cls.startsWith("language-");
      return (
        <code
          className={cn(
            "rounded-chip font-mono text-mono",
            block ? "block" : "bg-panel-alt px-1 py-px text-primary",
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
        className="my-2 overflow-x-auto rounded-panel border border-subtle bg-ink p-3 font-mono text-mono text-primary"
        {...rest}
      >
        {c}
      </pre>
    ),
    table: ({ children: c, ...rest }: ComponentPropsWithoutRef<"table">) => (
      <div className="my-2 overflow-x-auto rounded-panel border border-subtle">
        <table className="w-full border-collapse text-body" {...rest}>
          {c}
        </table>
      </div>
    ),
    thead: ({ children: c, ...rest }: ComponentPropsWithoutRef<"thead">) => (
      <thead className="bg-panel-alt" {...rest}>
        {c}
      </thead>
    ),
    th: ({ children: c, style, ...rest }: ComponentPropsWithoutRef<"th">) => (
      <th
        className={cn(
          "t-label h-panel-header border-b border-subtle px-2 text-left",
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
          className="my-2 max-w-full rounded-panel border border-subtle"
          {...rest}
        />
      ) : alt ? (
        <span className="text-secondary">{alt}</span>
      ) : null,
  };
  return (
    <div
      className={cn(variant === "reading" ? "t-reading" : "t-body", "text-primary", className)}
      data-markdown
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** True when a node tree contains any element (used by tests of linkify behaviour). */
export function hasElements(children: ReactNode): boolean {
  return Children.toArray(children).some((c) => isValidElement(c));
}
