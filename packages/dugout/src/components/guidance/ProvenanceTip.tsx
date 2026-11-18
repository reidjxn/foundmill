"use client";
/**
 * The explanation behind an estimate or a forecast (finding D3: it was a native `title`). A real Tooltip that opens on
 * the word and its one-sentence meaning, or the definition card when the definitions map holds `estimate` /
 * `forecast` (so "Learn more" can point at connecting a bank). Always shown: provenance is information, not tutoring.
 * ProvenanceChip (foundation/Chip, server-safe) renders the figure in the estimate style, or the word, and hands it
 * here: since Nov 17, 2026 this is where a sighted reader finds the word for a styled figure.
 *
 * Focus opens it only after a key that moves focus (keyboardFocus.ts). The chip is often the first focusable inside a
 * dialog, and Radix's auto-focus would otherwise open the tooltip with the dialog, so that the next Escape closed the
 * tooltip and not the dialog. A script's focus leaves it closed; Tab, the arrows and the pointer open it as before.
 */
import { cloneElement, useEffect, type FocusEvent, type ReactElement } from "react";
import type { ProvenanceKind } from "../foundation/Chip";
import { Tooltip } from "../foundation/Tooltip";
import { DefinitionCard } from "./DefinitionCard";
import { useTerm } from "./GuidanceProvider";
import { isKeyboardFocus, trackKeyboardFocus } from "./keyboardFocus";

export interface ProvenanceTipProps {
  kind: ProvenanceKind;
  /** The sentence shown when the map has no definition. */
  sentence: string;
  /** The figure in the estimate style, or the word (a focusable element). */
  children: ReactElement<{ onFocus?: (e: FocusEvent<HTMLElement>) => void }>;
}

/**
 * The trigger with a focus handler Radix composes before its own: default-prevented, the focus does not open the
 * tooltip. The child's own `onFocus`, if any, still runs first.
 */
export function withKeyboardFocusOnly<P extends { onFocus?: (e: FocusEvent<HTMLElement>) => void }>(child: ReactElement<P>): ReactElement<P> {
  // Idempotent and browser-only: the tracker must be listening before the key that brings focus here, not after.
  trackKeyboardFocus();
  const own = child.props.onFocus;
  return cloneElement(child, {
    onFocus: (e: FocusEvent<HTMLElement>) => {
      own?.(e);
      if (!isKeyboardFocus()) e.preventDefault();
    },
  } as Partial<P>);
}

export function ProvenanceTip({ kind, sentence, children }: ProvenanceTipProps) {
  const def = useTerm(kind);
  useEffect(trackKeyboardFocus, []);
  if (def)
    return (
      <DefinitionCard word={def.word} short={def.short} long={def.long} learn={def.learn} side="top" openOnFocus="keyboard">
        {children}
      </DefinitionCard>
    );
  return (
    <Tooltip content={sentence} side="top">
      {withKeyboardFocusOnly(children)}
    </Tooltip>
  );
}
