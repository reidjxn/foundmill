"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { streamDelayMs } from "../../lib/motion";
import { usePrefersReducedMotion } from "../../lib/reducedMotion";
import { toneClass } from "./types";

/** An entity mention in agent markup: revealed whole, never cut mid-token. */
const ENTITY_TOKEN = /\[\[ent:[^\]|]+\|[^\]]*\]\]/g;
const ENTITY_NAME = /\[\[ent:[^\]|]+\|([^\]]*)\]\]/g;

/**
 * Split text into the units a stream reveals: an entity mention (`[[ent:id|Name]]`) is one unit, everything else one
 * character (code point) at a time. Pure.
 */
export function streamAtoms(text: string): string[] {
  const atoms: string[] = [];
  let last = 0;
  for (const m of text.matchAll(ENTITY_TOKEN)) {
    atoms.push(...Array.from(text.slice(last, m.index)));
    atoms.push(m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  atoms.push(...Array.from(text.slice(last)));
  return atoms;
}

/** Agent markup as words: mentions become their names (what a screen reader hears while the stream is open). */
export function plainMentions(text: string): string {
  return text.replace(ENTITY_NAME, "$1");
}

/** How many units to reveal on the next tick: one at the SPEC cadence, more when far behind the source (catch up). */
export function streamStep(behind: number): number {
  return behind > 160 ? Math.ceil(behind / 80) : 1;
}

/** Delay before the unit after `atom`: 22–34 ms per character, +120 ms after a comma or full stop. */
export function atomDelayMs(atom: string): number {
  if (atom.startsWith("[[ent:")) return streamDelayMs("a") * 2;
  return streamDelayMs(atom.slice(-1));
}

export interface StreamingTextProps {
  /** The text so far. It may grow while `open` (a live source); the reveal continues from where it was. */
  text: string;
  /** The source is still open: more may arrive, so the caret stays after the last character. */
  open?: boolean;
  /** Reveal at the streaming cadence. False shows the text whole (history, already settled). Default true. */
  animate?: boolean;
  /** Render the revealed prefix (e.g. through EntityText). Mentions are revealed whole, so the prefix stays valid. */
  render?: (visible: string) => ReactNode;
  /** The caret's colour: the agent's department, or the brand's kit-lift. */
  tone?: DeptColourToken | "kit";
  /** How many of the newest characters show in text-2 until they settle. Default 14. */
  freshChars?: number;
  /** Called once the whole text is shown and the source has closed. */
  onSettled?: () => void;
  as?: "span" | "div" | "p";
  className?: string;
}

/**
 * Agent words arriving (SPEC "Streaming"): 22–34 ms per character with a 120 ms pause at commas, the newest words in
 * text-2 until they settle, and a caret in the agent's colour while the stream is open. Reduced motion: the text
 * renders whole. Screen readers get the words once, not a character at a time: while the stream runs, the animated
 * copy is hidden and inert, and a visually hidden copy carries the text.
 */
export function StreamingText({
  text,
  open = false,
  animate = true,
  render,
  tone,
  freshChars = 14,
  onSettled,
  as: Tag = "span",
  className,
}: StreamingTextProps) {
  const reduced = usePrefersReducedMotion();
  const instant = reduced || !animate;
  const atoms = useMemo(() => streamAtoms(text), [text]);
  // How far the reveal has got, and the text it was counting in: a text that does not continue it starts again.
  const [progress, setProgress] = useState(() => ({ base: text, n: instant ? atoms.length : 0 }));
  const continues = text.startsWith(progress.base);
  const count = instant ? atoms.length : Math.min(continues ? progress.n : 0, atoms.length);

  useEffect(() => {
    if (instant || count >= atoms.length) return;
    const t = setTimeout(
      () =>
        setProgress((p) => {
          const from = text.startsWith(p.base) ? Math.min(p.n, atoms.length) : 0;
          return { base: text, n: Math.min(atoms.length, from + streamStep(atoms.length - from)) };
        }),
      count === 0 ? 0 : atomDelayMs(atoms[count - 1] ?? ""),
    );
    return () => clearTimeout(t);
  }, [instant, count, atoms, text]);

  const revealing = count < atoms.length;
  const settled = !revealing && !open;

  const settledRef = useRef(false);
  useEffect(() => {
    if (settled && !settledRef.current) {
      settledRef.current = true;
      onSettled?.();
    } else if (!settled) settledRef.current = false;
  }, [settled, onSettled]);

  // The newest characters (after the last mention) show in text-2 until the stream settles.
  let split = count;
  if (!settled && !instant) {
    let lastEntity = -1;
    for (let i = 0; i < count; i++)
      if (atoms[i]!.startsWith("[[ent:") && atoms[i]!.length > 1) lastEntity = i;
    split = Math.max(lastEntity + 1, count - freshChars);
  }
  const settledText = atoms.slice(0, split).join("");
  const freshText = atoms.slice(split, count).join("");
  const live = !settled;

  return (
    <Tag
      className={cn("relative", className)}
      data-streaming={live || undefined}
      data-testid="streaming-text"
    >
      <span aria-hidden={live || undefined} inert={live || undefined}>
        {render ? render(settledText) : settledText}
        {freshText ? <span className="text-secondary">{freshText}</span> : null}
        {live ? <span className={cn("stream-caret", toneClass(tone))} data-caret="" /> : null}
      </span>
      {live ? <span className="sr-only">{plainMentions(text)}</span> : null}
    </Tag>
  );
}
