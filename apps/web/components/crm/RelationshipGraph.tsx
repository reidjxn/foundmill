"use client";
/**
 * Relationship graph (BUILD §11.12 Relationships tab): the entity in the centre, every related record on a ring,
 * edge width and label from the 1–20 strength, kind icon per node. Plain SVG on tokens (same approach as Dugout's
 * charts); clicks open the related profile. An sr-only list carries the same facts.
 */
import { plainWords } from "@/lib/format";
import { useMemo } from "react";
import { ENTITY_KIND_ICONS, ENTITY_KIND_LABELS, Icon, initials, ratingClass } from "@foundmill/dugout";
import type { EntityKind } from "@foundmill/shared";

export interface GraphNode {
  id: string;
  name: string;
  kind: EntityKind;
  type: string;
  /** 1–20 */
  strength: number;
}

export interface RelationshipGraphProps {
  centre: { id: string; name: string; kind: EntityKind };
  nodes: readonly GraphNode[];
  onOpen?: (id: string) => void;
  width?: number;
  height?: number;
  className?: string;
}

export function layoutRing(count: number, cx: number, cy: number, radius: number): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(1, count)) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

const TONE_STROKE: Record<string, string> = { "rating-1": "var(--rating-1)", "rating-2": "var(--rating-2)", "rating-3": "var(--rating-3)", "rating-4": "var(--rating-4)" };

export function RelationshipGraph({ centre, nodes, onOpen, width = 640, height = 360, className }: RelationshipGraphProps) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 56;
  const positions = useMemo(() => layoutRing(nodes.length, cx, cy, radius), [nodes.length, cx, cy, radius]);
  const CentreIcon = ENTITY_KIND_ICONS[centre.kind];
  return (
    <figure className={className} data-relationship-graph data-nodes={nodes.length}>
      {/* With clickable nodes the drawing is a group of buttons, not an image (an image is one leaf for assistive tech). */}
      <svg width={width} height={height} role={onOpen ? "group" : "img"} aria-label={`${centre.name}: ${nodes.length} ${nodes.length === 1 ? "relationship" : "relationships"}`} className="block max-w-full">
        {nodes.map((n, i) => {
          const p = positions[i]!;
          const tone = ratingClass(n.strength).includes("rating-4") ? "rating-4" : ratingClass(n.strength).includes("rating-3") ? "rating-3" : ratingClass(n.strength).includes("rating-2") ? "rating-2" : "rating-1";
          return <line key={`e-${n.id}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={TONE_STROKE[tone]} strokeOpacity={0.7} strokeWidth={1 + (n.strength / 20) * 3} />;
        })}
        <g transform={`translate(${cx} ${cy})`}>
          <circle r={28} className="fill-kit-primary" />
          <text y={4} textAnchor="middle" className="fill-kit-on-primary font-display text-small font-semibold">
            {initials(centre.name)}
          </text>
        </g>
        {nodes.map((n, i) => {
          const p = positions[i]!;
          const label = n.name.length > 18 ? `${n.name.slice(0, 17)}…` : n.name;
          return (
            <g key={n.id} transform={`translate(${p.x} ${p.y})`} className={onOpen ? "cursor-pointer" : undefined} onClick={onOpen ? () => onOpen(n.id) : undefined} role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onKeyDown={onOpen ? (e) => (e.key === "Enter" || e.key === " ") && onOpen(n.id) : undefined} aria-label={`${n.name}, ${ENTITY_KIND_LABELS[n.kind]}, ${plainWords(n.type).toLowerCase()}, strength ${n.strength} of 20`}>
              <circle r={20} className="fill-panel-alt stroke-subtle" strokeWidth={1} />
              <text y={4} textAnchor="middle" className="fill-primary font-display text-micro font-semibold">
                {initials(n.name)}
              </text>
              <text y={34} textAnchor="middle" className="fill-primary font-body text-micro">
                {label}
              </text>
              <text y={46} textAnchor="middle" className="fill-tertiary font-mono text-micro tabular-nums">
                {n.strength}/20 · {plainWords(n.type).toLowerCase()}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        <span>
          <Icon icon={CentreIcon} size="inline" /> {centre.name}
        </span>
        <ul>
          {nodes.map((n) => (
            <li key={n.id}>
              {n.name} ({ENTITY_KIND_LABELS[n.kind]}) · {plainWords(n.type).toLowerCase()} · strength {n.strength} of 20
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
