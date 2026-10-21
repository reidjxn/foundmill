"use client";
/**
 * An inline defined word (docs/UX_AUDIT_AND_PLAN.md §6.2 `Term`, principle 3 "define on first use"). The text keeps
 * its own colour with a 1 px dotted underline at 40 % (`term-link`: the entity link's geometry, dotted so "dotted =
 * something to learn"; dashed stays "not measured"). Hover or focus after 300 ms opens the definition card; Enter
 * pins it so "Learn more" is reachable. Guidance off: plain text, no underline, unless `always` (Estimate, Forecast).
 * An id the map does not hold renders its children as plain text: never a broken underline.
 *
 * Opening the card (hover past the delay, focus by key, Enter or a click) calls `onOpen` and the provider's
 * `onTermOpen` with the term's id, once per opening: the app records the product signal `guidance.term_opened`
 * (apps/web GuidanceHost, which keeps it to once per term per session).
 */
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { DefinitionCard } from "./DefinitionCard";
import { useGuidance, useGuided, useTerm, type GuidanceContextValue, type TermDefinition } from "./GuidanceProvider";

/**
 * The provider's optional "a definition was opened" action. The app passes it with the other actions (GuidanceHost);
 * outside it nothing listens.
 */
export interface TermOpenAction {
  onTermOpen?(termId: string): void;
}

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
  /** Called with the id each time the definition card opens (after the provider's `onTermOpen`). */
  onOpen?: (termId: string) => void;
}

/**
 * The underlined word: a button the definition card's trigger renders through (Radix Slot hands it `aria-expanded`
 * with the card's state). When that turns true the card has opened: `onOpened` runs once for that opening.
 */
const TermTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { onOpened: () => void }>(function TermTrigger({ onOpened, ...props }, ref) {
  const expanded = props["aria-expanded"] === true || props["aria-expanded"] === "true";
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;
  useEffect(() => {
    if (expanded) onOpenedRef.current();
  }, [expanded]);
  return <button ref={ref} type="button" {...props} />;
});

export function Term({ id, children, fact, always, definition, side, align, className, onOpen }: TermProps) {
  const guided = useGuided();
  const fromMap = useTerm(id);
  const { onTermOpen } = useGuidance() as GuidanceContextValue & TermOpenAction;
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
      <TermTrigger
        className={cn("term-link", className)}
        data-term={id}
        onOpened={() => {
          onTermOpen?.(id);
          onOpen?.(id);
        }}
      >
        {text}
      </TermTrigger>
    </DefinitionCard>
  );
}
