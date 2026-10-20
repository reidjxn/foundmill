"use client";
/**
 * An inline defined word (docs/UX_AUDIT_AND_PLAN.md §6.2 `Term`, principle 3 "define on first use"). The text keeps
 * its own colour with a 1 px dotted underline at 40 % (`term-link`: the entity link's geometry, dotted so "dotted =
 * something to learn"; dashed stays "not measured"). Hover or focus after 300 ms opens the definition card; Enter
 * pins it so "Learn more" is reachable. Guidance off: plain text, no underline, unless `always` (Estimate, Forecast).
 * An id the map does not hold renders its children as plain text: never a broken underline.
 */
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { DefinitionCard } from "./DefinitionCard";
import { useGuided, useTerm, type TermDefinition } from "./GuidanceProvider";

export interface TermProps {
  /** The definition's stable id, looked up through `useTerm`. */
  id: string;
  /** The words shown; defaults to the definition's display word. Use it for a lowercase or plural form in a sentence. */
  children?: ReactNode;
  /** The business's own figure: "In this business: £18,400 · 7 months". */
  fact?: ReactNode;
  /** Keep the definition when guidance is off (information, not tutoring: Estimate, Forecast). */
  always?: boolean;
  /** An inline definition for a word the map does not hold. */
  definition?: TermDefinition;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}

export function Term({ id, children, fact, always, definition, side, align, className }: TermProps) {
  const guided = useGuided();
  const fromMap = useTerm(id);
  const def = definition ?? fromMap;
  if (!def) return children === undefined ? null : <>{children}</>;
  const text = children ?? def.word;
  if (!guided && !always)
    return (
      <span data-term={id} data-guided="off" className={className}>
        {text}
      </span>
    );
  return (
    <DefinitionCard word={def.word} short={def.short} long={def.long} learn={def.learn} fact={fact} side={side} align={align}>
      <button type="button" className={cn("term-link", className)} data-term={id}>
        {text}
      </button>
    </DefinitionCard>
  );
}
