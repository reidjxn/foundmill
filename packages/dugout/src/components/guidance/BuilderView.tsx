"use client";
/**
 * Builder view (founder, Nov 8, 2026; docs/DESIGN.md "Builder view"): one account-wide switch that shows how the
 * platform runs the team (cycle numbers, AI usage in tokens, ETAs, test counts, the Code, Health and Hierarchy tabs,
 * ratings out of 20, the technical columns of the change and preview lists). Off by default. The app mounts one
 * provider per signed-in layout from `account_preferences.builder_view` (apps/web GuidanceHost).
 *
 * Off hides, never rewrites: a gated element is simply not rendered (or its `fallback` is), so nothing a founder reads
 * is less true. Outside a provider it reads **off**, so a missing provider never shows the engine; stories and tests
 * that need it wrap in `<BuilderViewProvider on>`. Unlike guidance (which hides tutoring only), this switch hides
 * information on purpose; that is why it is its own switch and never follows guidance.
 */
import { createContext, useContext, type ReactNode } from "react";

const BuilderViewContext = createContext<boolean>(false);

export interface BuilderViewProviderProps {
  /** True shows the engine. Default false. */
  on?: boolean;
  children?: ReactNode;
}

/** Carries the account's Builder view switch to everything below it. */
export function BuilderViewProvider({ on = false, children }: BuilderViewProviderProps) {
  return <BuilderViewContext.Provider value={on}>{children}</BuilderViewContext.Provider>;
}

/** Whether Builder view is on here: false outside a provider. */
export function useBuilderView(): boolean {
  return useContext(BuilderViewContext);
}

export interface BuilderOnlyProps {
  children?: ReactNode;
  /** What shows while Builder view is off (nothing by default). Never a rewrite of the hidden content. */
  fallback?: ReactNode;
}

/** Renders its children only while Builder view is on; otherwise its `fallback` (nothing by default). */
export function BuilderOnly({ children, fallback = null }: BuilderOnlyProps) {
  return <>{useBuilderView() ? children : fallback}</>;
}
