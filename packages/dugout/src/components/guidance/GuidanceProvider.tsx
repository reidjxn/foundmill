"use client";
/**
 * The guided layer's one switch (docs/UX_AUDIT_AND_PLAN.md §6.3). The app mounts one provider per signed-in layout with
 * the account's preference (`account_preferences.guidance`, `text_size`, the explainers seen, the tours done, the
 * checklist dismissal) and the definitions map (`TERMS` from @foundmill/shared, already run through the business
 * glossary), the way `DateFormatProvider` carries the date format. Outside a provider (signed-out pages, stories,
 * tests) guidance reads as on, text standard, no terms, and every action is a no-op.
 *
 * Guidance "off" hides tutoring (explainers, the checklist, coach marks, term underlines) and never hides information
 * (consequences, provenance, Estimate). Keyboard caps on buttons go the other way: they render only when guidance is
 * off (an operator's affordance, noise to a first-timer); the shortcuts work in both states.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

export type GuidanceMode = "on" | "off";
export type TextSize = "standard" | "comfortable";

/** One entry of the definitions map (`packages/shared/src/terms.ts`), keyed by a stable id, never by the display word. */
export interface TermDefinition {
  id: string;
  /** The display word, sentence case ("Runway"). */
  word: string;
  /** One sentence a student understands ("How many months your cash lasts at today's spending."). */
  short: string;
  /** An optional longer explanation for the hover card. */
  long?: string;
  /** An optional "Learn more" target: a route slug the app resolves, or an absolute URL. */
  learn?: string;
}

export interface GuidanceState {
  guidance: GuidanceMode;
  textSize: TextSize;
  /** Screen ids whose Explainer was dismissed with "Got it". */
  explainersSeen: Record<string, true>;
  /** Tour ids completed or skipped. */
  toursDone: Record<string, true>;
  /** ISO time the first-week checklist was dismissed, or null. */
  checklistDismissedAt: string | null;
  /** The definitions map; empty outside the app. */
  terms: Record<string, TermDefinition>;
}

export interface GuidanceActions {
  setGuidance(mode: GuidanceMode): void;
  setTextSize(size: TextSize): void;
  markExplainerSeen(screenId: string): void;
  markTourDone(tourId: string): void;
  dismissChecklist(): void;
  /** "Show the first-week checklist again" and "Replay the tour": clears explainers, tours and the checklist dismissal. */
  resetGuidance(): void;
}

export type GuidanceContextValue = GuidanceState & GuidanceActions;

export const DEFAULT_GUIDANCE_STATE: GuidanceState = {
  guidance: "on",
  textSize: "standard",
  explainersSeen: {},
  toursDone: {},
  checklistDismissedAt: null,
  terms: {},
};

const noop = () => {};
export const NOOP_GUIDANCE_ACTIONS: GuidanceActions = {
  setGuidance: noop,
  setTextSize: noop,
  markExplainerSeen: noop,
  markTourDone: noop,
  dismissChecklist: noop,
  resetGuidance: noop,
};

const GuidanceContext = createContext<GuidanceContextValue>({ ...DEFAULT_GUIDANCE_STATE, ...NOOP_GUIDANCE_ACTIONS });

export interface GuidanceProviderProps {
  /** The account's state; anything missing reads as the default (on, standard, nothing seen). */
  value?: Partial<GuidanceState> | null;
  /** The persistence actions; missing ones are no-ops. */
  actions?: Partial<GuidanceActions> | null;
  children?: ReactNode;
}

export function GuidanceProvider({ value, actions, children }: GuidanceProviderProps) {
  const ctx = useMemo<GuidanceContextValue>(
    () => ({ ...DEFAULT_GUIDANCE_STATE, ...(value ?? {}), ...NOOP_GUIDANCE_ACTIONS, ...(actions ?? {}) }),
    [value, actions],
  );
  return <GuidanceContext.Provider value={ctx}>{children}</GuidanceContext.Provider>;
}

/** The current account's guidance state and actions (on, standard and no-ops outside a provider). */
export function useGuidance(): GuidanceContextValue {
  return useContext(GuidanceContext);
}

/** True when tutoring surfaces (explainers, checklist, coach marks, term underlines, kbd caps on buttons) should render. */
export function useGuided(): boolean {
  return useGuidance().guidance === "on";
}

/** One definition by id, or undefined when the map does not hold it. */
export function useTerm(id: string): TermDefinition | undefined {
  return useGuidance().terms[id];
}
