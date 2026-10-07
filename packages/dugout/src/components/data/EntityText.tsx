"use client";
import { useMemo, useState, type ReactNode } from "react";
import { CircleHelp, Plus } from "lucide-react";
import type { EntityKind } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { Popover, PopoverContent, PopoverTrigger } from "../foundation/Popover";
import {
  ENTITY_KIND_ICONS,
  ENTITY_KIND_LABELS,
  EntityLink,
  useEntityLinkContext,
} from "./EntityLink";
import {
  parseEntityText,
  type AmbiguousCandidate,
  type AmbiguousNode,
  type DraftNode,
  type EntityRenderNode,
} from "./entityMarkup";
import type { EntityRef } from "./types";

export interface EntityTextProps {
  /** Markup text, or a render tree from `@foundmill/entity-linker`'s `toRenderTree` (same node shapes). */
  children: string | readonly EntityRenderNode[];
  /** A span matched several entities: the founder picked one. */
  onResolveAmbiguous?: (node: AmbiguousNode, candidate: AmbiguousCandidate) => void;
  /** Create the draft as a CRM entity (BUILD §11.3 "unverified draft"). */
  onCreateDraft?: (node: DraftNode) => void;
  /** Open an entity (overrides the provider). */
  onOpen?: (entity: EntityRef) => void;
  className?: string;
  /** Element to render; default span (inline). */
  as?: "span" | "p" | "div";
}

/** Dotted underline + "Which one?" chooser (DECISIONS: an ambiguous span is never guessed). */
export function AmbiguousSpan({
  node,
  onResolve,
}: {
  node: AmbiguousNode;
  onResolve?: (candidate: AmbiguousCandidate) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-ambiguous
          aria-haspopup="dialog"
          aria-label={`${node.text}: ${node.prompt}`}
          className="inline rounded-chip border-b border-dotted border-secondary text-primary hover:bg-white/4 focus-visible:outline-2"
        >
          {node.text}
          <span className="ml-1 inline-flex items-baseline gap-0.5 text-small text-secondary">
            <Icon icon={CircleHelp} size={12} className="relative top-0.5" />
            {node.prompt}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" aria-label={node.prompt}>
        <p className="t-label px-2 pb-1 pt-1.5">{node.prompt}</p>
        <ul className="flex flex-col">
          {node.candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex h-row-compact w-full items-center gap-2 rounded-chip px-2 text-left text-body text-primary hover:bg-white/4 focus-visible:outline-2"
                onClick={() => {
                  setOpen(false);
                  onResolve?.(c);
                }}
              >
                <Icon icon={ENTITY_KIND_ICONS[c.kind]} size="inline" className="text-secondary" />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-small text-secondary">{ENTITY_KIND_LABELS[c.kind]}</span>
                <span className="font-mono text-mono text-secondary tabular-nums">
                  {Math.round(c.score * 100)}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Plain name with an "Unverified" chip and an optional "Add to CRM" affordance. */
export function DraftSpan({
  node,
  onCreate,
}: {
  node: DraftNode;
  onCreate?: (node: DraftNode) => void;
}) {
  const KindIcon = ENTITY_KIND_ICONS[node.kindGuess];
  return (
    <span data-draft className="inline-flex max-w-full items-baseline gap-1 align-baseline">
      <span className="underline decoration-dashed decoration-secondary/70 underline-offset-2">
        {node.name}
      </span>
      <Chip
        tone="warn"
        icon={KindIcon}
        title={`Possibly a new ${ENTITY_KIND_LABELS[node.kindGuess].toLowerCase()}; not yet in the CRM`}
        className="relative -top-px"
      >
        Unverified
      </Chip>
      {onCreate ? (
        <Button
          size="sm"
          variant="ghost"
          icon={Plus}
          className="h-chip px-1 text-label"
          onClick={() => onCreate(node)}
          aria-label={`Add ${node.name} to the CRM`}
        >
          Add
        </Button>
      ) : null}
    </span>
  );
}

/**
 * Renders `[[ent:id|Name]]` markup (or a linker render tree) as text with `EntityLink`s. Ambiguous nodes get the
 * dotted "Which one?" chooser; drafts get the unverified style. Entity details, hrefs and click handling come from
 * `EntityLinkProvider`.
 */
export function EntityText({
  children,
  onResolveAmbiguous,
  onCreateDraft,
  onOpen,
  className,
  as: Tag = "span",
}: EntityTextProps) {
  const ctx = useEntityLinkContext();
  const nodes = useMemo<readonly EntityRenderNode[]>(
    () => (typeof children === "string" ? parseEntityText(children) : children),
    [children],
  );
  return (
    <Tag className={cn("[overflow-wrap:anywhere]", className)} data-entity-text>
      {nodes.map((node, i) =>
        renderNode(node, i, {
          onResolveAmbiguous,
          onCreateDraft,
          onOpen,
          resolveKind: (id) => ctx.resolve?.(id)?.kind,
        }),
      )}
    </Tag>
  );
}

function renderNode(
  node: EntityRenderNode,
  key: number,
  h: {
    onResolveAmbiguous?: EntityTextProps["onResolveAmbiguous"];
    onCreateDraft?: EntityTextProps["onCreateDraft"];
    onOpen?: EntityTextProps["onOpen"];
    resolveKind: (id: string) => EntityKind | undefined;
  },
): ReactNode {
  switch (node.type) {
    case "text":
      return <span key={key}>{node.text}</span>;
    case "entity": {
      const kind = node.kind ?? h.resolveKind(node.id) ?? "person";
      return (
        <EntityLink
          key={key}
          entity={{
            id: node.id,
            kind,
            name: node.name ?? node.display,
            ...(node.href ? { href: node.href } : {}),
          }}
          display={node.display}
          onOpen={h.onOpen ? (e) => h.onOpen?.(e) : undefined}
        />
      );
    }
    case "ambiguous":
      return (
        <AmbiguousSpan
          key={key}
          node={node}
          onResolve={h.onResolveAmbiguous ? (c) => h.onResolveAmbiguous?.(node, c) : undefined}
        />
      );
    case "draft":
      return <DraftSpan key={key} node={node} onCreate={h.onCreateDraft} />;
  }
}
