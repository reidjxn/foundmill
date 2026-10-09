"use client";
import { createElement, Fragment, type ReactNode } from "react";
import { ENTITY_MARKUP_RE, type EntityKind } from "@foundmill/shared/constants";
import { EntityLink } from "../data/EntityLink";
import type { EntityRef } from "../data/types";

/**
 * Journey-group mention rendering. Internal to this group (not exported from the package barrel): the public
 * `EntityText` / `EntityLink` live in the data group. This file keeps the journey components' small prop surface
 * (`text`, `kinds`, `onOpenEntity`) and renders every mention through the data group's `EntityLink`, so hover cards,
 * provider hrefs and right-click verbs (`EntityLinkProvider`) work inside the Ribbon, Customer Update and Home widgets.
 */

/** Segments of agent text: plain runs and `[[ent:<uuid>|Name]]` mentions (BUILD §11.3). */
export type EntitySegment = { type: "text"; text: string } | { type: "entity"; id: string; name: string };

/** Split text on the shared markup regex. Malformed openings stay plain text; nothing is guessed. */
export function parseEntityText(text: string): EntitySegment[] {
  const out: EntitySegment[] = [];
  const re = new RegExp(ENTITY_MARKUP_RE.source, "g");
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    out.push({ type: "entity", id: m[1] as string, name: m[2] as string });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** Plain text with mentions replaced by their display names (aria labels, titles). */
export function entityPlainText(text: string): string {
  return parseEntityText(text)
    .map((s) => (s.type === "text" ? s.text : s.name))
    .join("");
}

/** Ids mentioned in a text, in order, de-duplicated. */
export function entityIdsIn(text: string): string[] {
  const ids: string[] = [];
  for (const s of parseEntityText(text)) if (s.type === "entity" && !ids.includes(s.id)) ids.push(s.id);
  return ids;
}

export interface EntityMentionProps {
  id: string;
  name: string;
  /** Kind for the 14 px icon; when omitted the `EntityLinkProvider`'s `resolve(id)` supplies it. */
  kind?: EntityKind;
  href?: string;
  onOpen?: (id: string) => void;
  className?: string;
}

/** One mention as the data group's `EntityLink` (DESIGN §8: kind icon, accent-link, 300 ms hover card). */
export function EntityMention({ id, name, kind, href, onOpen, className }: EntityMentionProps) {
  // `kind` may be unknown here; EntityLink resolves it through the provider (`entity.kind ?? resolve(id).kind`).
  const entity = { id, name, kind, ...(href ? { href } : {}) } as EntityRef;
  return <EntityLink entity={entity} display={name} onOpen={onOpen ? () => onOpen(id) : undefined} className={className} />;
}

export type EntityRenderer = (mention: { id: string; name: string }) => ReactNode;

export interface EntityTextProps {
  /** Text with `[[ent:<uuid>|Name]]` markup. */
  text: string;
  /** Kind per id, for the icon (unknown ids are resolved by the provider or get the generic glyph). */
  kinds?: Record<string, EntityKind>;
  /** Profile link per id (otherwise the provider's `hrefFor`). */
  hrefs?: Record<string, string>;
  onOpenEntity?: (id: string) => void;
  /** Replace the default mention rendering. */
  renderEntity?: EntityRenderer;
  as?: "span" | "p" | "div";
  className?: string;
}

/** Renders agent text with its entity mentions as links (CLAUDE.md: every mention renders as an entity link). */
export function EntityText({ text, kinds, hrefs, onOpenEntity, renderEntity, as = "span", className }: EntityTextProps) {
  const segments = parseEntityText(text);
  const children = segments.map((s, i) =>
    s.type === "text" ? (
      <Fragment key={i}>{s.text}</Fragment>
    ) : (
      <Fragment key={i}>{renderEntity ? renderEntity({ id: s.id, name: s.name }) : <EntityMention id={s.id} name={s.name} kind={kinds?.[s.id]} href={hrefs?.[s.id]} onOpen={onOpenEntity} />}</Fragment>
    ),
  );
  return createElement(as, { className, "data-entity-count": segments.filter((s) => s.type === "entity").length }, ...children);
}
