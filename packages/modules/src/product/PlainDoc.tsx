/**
 * A spec block's ProseMirror JSON read as plain text (headings, paragraphs, lists, quotes, code), in the reading style
 * the design system's Markdown uses. Nothing is parsed from the text: no images, no links and no entity mentions, so
 * whatever an agent wrote in a block (security review M1) can never load a resource or become a link on the Vision tab.
 */
import type { ReactNode } from "react";
import { cn } from "@foundmill/dugout";
import type { PmNode } from "./prosemirror";
import type { PmDoc } from "./types";

const isNode = (v: unknown): v is PmNode => typeof v === "object" && v !== null && typeof (v as PmNode).type === "string";
const children = (n: PmNode): PmNode[] => (Array.isArray(n.content) ? n.content.filter(isNode) : []);

function inline(nodes: PmNode[], key: string): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}.${i}`;
    if (n.type === "hardBreak" || n.type === "hard_break") return <br key={k} />;
    if (n.type !== "text") return <span key={k}>{inline(children(n), k)}</span>;
    const marks = new Set((n.marks ?? []).map((m) => m.type));
    let out: ReactNode = typeof n.text === "string" ? n.text : "";
    if (marks.has("italic")) out = <em className="italic">{out}</em>;
    if (marks.has("bold")) out = <strong className="font-medium text-primary">{out}</strong>;
    if (marks.has("code")) out = <code className="rounded-chip bg-panel-alt px-1 py-px font-mono text-mono text-primary">{out}</code>;
    return <span key={k}>{out}</span>;
  });
}

function block(n: PmNode, key: string): ReactNode {
  switch (n.type) {
    case "heading": {
      const level = Number(n.attrs?.level ?? 2);
      return level <= 2 ? (
        <h4 key={key} className="t-body-strong mt-3 mb-1 text-primary first:mt-0">
          {inline(children(n), key)}
        </h4>
      ) : (
        <h5 key={key} className="t-label mt-3 mb-1 first:mt-0">
          {inline(children(n), key)}
        </h5>
      );
    }
    case "paragraph":
      return (
        <p key={key} className="my-0 [&+&]:mt-3 [&+ol]:mt-2 [&+ul]:mt-2">
          {inline(children(n), key)}
        </p>
      );
    case "bulletList":
    case "bullet_list":
    case "orderedList":
    case "ordered_list": {
      const ordered = n.type.startsWith("ordered");
      const items = children(n).map((li, i) => (
        <li key={`${key}.${i}`} className="my-0.5 [&>p]:my-0">
          {children(li).map((c, j) => block(c, `${key}.${i}.${j}`))}
        </li>
      ));
      return ordered ? (
        <ol key={key} className="my-2 list-decimal pl-5 marker:text-secondary marker:tabular-nums">
          {items}
        </ol>
      ) : (
        <ul key={key} className="my-2 list-disc pl-5 marker:text-secondary">
          {items}
        </ul>
      );
    }
    case "blockquote":
      return (
        <blockquote key={key} className="my-2 border-l-2 border-subtle pl-3 text-secondary">
          {children(n).map((c, i) => block(c, `${key}.${i}`))}
        </blockquote>
      );
    case "codeBlock":
    case "code_block":
      return (
        <pre key={key} className="my-2 overflow-x-auto rounded-panel border border-subtle bg-ink p-3 font-mono text-mono text-primary">
          {inline(children(n), key)}
        </pre>
      );
    case "horizontalRule":
    case "horizontal_rule":
      return <hr key={key} className="my-4 border-subtle" />;
    default: {
      const kids = children(n);
      if (!kids.length) return typeof n.text === "string" && n.text ? <p key={key}>{n.text}</p> : null;
      return kids.some((c) => c.type === "text") ? <p key={key}>{inline(kids, key)}</p> : kids.map((c, i) => block(c, `${key}.${i}`));
    }
  }
}

export function PlainDoc({ doc, variant = "reading", className }: { doc: PmDoc | null | undefined; variant?: "reading" | "body"; className?: string }) {
  if (!isNode(doc)) return null;
  const nodes = doc.type === "doc" ? children(doc) : [doc];
  return (
    <div className={cn(variant === "reading" ? "t-reading" : "t-body", "text-primary", className)} data-plain-doc>
      {nodes.map((n, i) => block(n, String(i)))}
    </div>
  );
}
