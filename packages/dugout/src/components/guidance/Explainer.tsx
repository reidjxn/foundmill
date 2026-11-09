"use client";
/**
 * The per-screen explanation (docs/UX_AUDIT_AND_PLAN.md §6.2 `Explainer`), now one "Explain this page" button per page
 * instead of a banner on every tab. A screen still renders `<Explainer screenId purpose action watchFor onExample />`
 * where it always did; the component registers those lines with the page (`PageExplainProvider`, mounted by the shell)
 * and draws nothing in place. The shell's `ExplainPageButton` shows them on request. If two Explainers are mounted on
 * one page, the last mounted wins; unmounting it hands the page back to the one below.
 *
 * Outside a provider (stories, isolated tests, the full-screen ideation studio) there is no button in a header to find,
 * so the Explainer draws the same button and panel in place, which keeps it usable. Guidance off or not yet loaded:
 * nothing, in both modes. The screen is remembered in `account_preferences.explainers_seen` when the panel is opened.
 */
import { useEffect, useId, useMemo, useRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { ExplainTrigger } from "./ExplainPageButton";
import { EXPLAINER_LABELS, usePageExplainSetters } from "./PageExplain";

export { EXPLAINER_LABELS };

export interface ExplainerProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The screen's stable id ("home", "inbox", "finance/runway"); the key in `explainersSeen`. */
  screenId: string;
  /** What this screen is for. */
  purpose: ReactNode;
  /** What to do here. */
  action: ReactNode;
  /** Watch for. */
  watchFor: ReactNode;
  /** "Show me an example": swaps the panel for a labeled example (ExampleToggle). Omitted: no button. */
  onExample?: () => void;
}

export function Explainer({ screenId, purpose, action, watchFor, onExample, className, ...rest }: ExplainerProps) {
  const setters = usePageExplainSetters();
  const token = useId();
  // A fresh arrow each render must not re-register the entry each time: the entry calls through a ref.
  const exampleRef = useRef(onExample);
  exampleRef.current = onExample;
  const hasExample = Boolean(onExample);
  const entry = useMemo(
    () => ({ screenId, purpose, action, watchFor, onExample: hasExample ? () => exampleRef.current?.() : undefined }),
    [screenId, purpose, action, watchFor, hasExample],
  );
  useEffect(() => {
    if (!setters) return;
    setters.register(token, entry);
    return () => setters.unregister(token);
  }, [setters, token, entry]);

  if (setters) return null;
  return (
    <div className={cn("flex min-w-0", className)} {...rest}>
      <ExplainTrigger entry={entry} />
    </div>
  );
}
