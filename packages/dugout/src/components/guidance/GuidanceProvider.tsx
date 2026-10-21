"use client";
/**
 * The guided layer's one switch (docs/UX_AUDIT_AND_PLAN.md §6.3). The app mounts one provider per signed-in layout with
 * the account's preference (`account_preferences.guidance`, `text_size`, the explainers seen, the tours done, the
 * checklist dismissal) and the definitions map (`TERMS` from @foundmill/shared), the way `DateFormatProvider` carries
 * the date format; the business shell replaces the map with its glossary's words through `GuidanceTermsProvider`.
 * Outside a provider (stories, tests) guidance reads as on, text standard, no terms, and every action is a no-op.
 *
 * The value travels in two contexts: the mode (switch, text size, terms, `loaded`, actions) and the progress
 * (explainers seen, tours done, checklist). `useGuided`, `useTerm` and `useGuidanceMode` read the first only.
 *
 * Guidance "off" hides tutoring (explainers, the checklist, coach marks, term underlines) and never hides information
 * (consequences, provenance, Estimate). Keyboard caps on buttons go the other way: they render only when guidance is
 * off (an operator's affordance, noise to a first-timer); the shortcuts work in both states.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { GuidanceMode, TextSize } from "@foundmill/shared/constants";

// The tuples' one source (GUIDANCE_MODES, TEXT_SIZES in @foundmill/shared/constants, re-exported by the db schema):
// the zod-free constants entry keeps the design system free of the validation library.
export type { GuidanceMode, TextSize };

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
  /**
   * False while the account's preferences are still on their way (the values above are the defaults until then). Coach
   * marks wait for it, so a tour the account already finished never opens for a frame on load and moves the focus when
   * it closes again. True outside the app.
   */
  loaded: boolean;
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
  loaded: true,
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

/** What changes rarely: the switch, the text size, the definitions, whether the account has answered, and the actions. */
export type GuidanceModeValue = Pick<GuidanceState, "guidance" | "textSize" | "terms" | "loaded"> & GuidanceActions;
/** What a "Got it", a finished tour or the checklist's dismissal changes. */
export type GuidanceProgressValue = Pick<GuidanceState, "explainersSeen" | "toursDone" | "checklistDismissedAt">;

const DEFAULT_MODE: GuidanceModeValue = {
  guidance: DEFAULT_GUIDANCE_STATE.guidance,
  textSize: DEFAULT_GUIDANCE_STATE.textSize,
  terms: DEFAULT_GUIDANCE_STATE.terms,
  loaded: DEFAULT_GUIDANCE_STATE.loaded,
  ...NOOP_GUIDANCE_ACTIONS,
};
const DEFAULT_PROGRESS: GuidanceProgressValue = {
  explainersSeen: DEFAULT_GUIDANCE_STATE.explainersSeen,
  toursDone: DEFAULT_GUIDANCE_STATE.toursDone,
  checklistDismissedAt: DEFAULT_GUIDANCE_STATE.checklistDismissedAt,
};

// Two contexts (perf audit item 8): a "Got it" or a finished tour changes only the progress one, so the readers of the
// mode and the terms (every Term, the Estimate and Forecast tips, PlainFigure, DataTable's headers) do not render again.
const GuidanceModeContext = createContext<GuidanceModeValue>(DEFAULT_MODE);
const GuidanceProgressContext = createContext<GuidanceProgressValue>(DEFAULT_PROGRESS);

export interface GuidanceProviderProps {
  /** The account's state; anything missing reads as the default (on, standard, nothing seen). */
  value?: Partial<GuidanceState> | null;
  /** The persistence actions; missing ones are no-ops. */
  actions?: Partial<GuidanceActions> | null;
  children?: ReactNode;
}

export function GuidanceProvider({ value, actions, children }: GuidanceProviderProps) {
  const v = value ?? {};
  const { guidance = DEFAULT_MODE.guidance, textSize = DEFAULT_MODE.textSize, terms = DEFAULT_MODE.terms, loaded = DEFAULT_MODE.loaded } = v;
  const { explainersSeen = DEFAULT_PROGRESS.explainersSeen, toursDone = DEFAULT_PROGRESS.toursDone, checklistDismissedAt = DEFAULT_PROGRESS.checklistDismissedAt } = v;
  const mode = useMemo<GuidanceModeValue>(() => ({ ...NOOP_GUIDANCE_ACTIONS, ...(actions ?? {}), guidance, textSize, terms, loaded }), [actions, guidance, textSize, terms, loaded]);
  const progress = useMemo<GuidanceProgressValue>(() => ({ explainersSeen, toursDone, checklistDismissedAt }), [explainersSeen, toursDone, checklistDismissedAt]);
  return (
    <GuidanceModeContext.Provider value={mode}>
      <GuidanceProgressContext.Provider value={progress}>{children}</GuidanceProgressContext.Provider>
    </GuidanceModeContext.Provider>
  );
}

/**
 * Replaces the definitions map below it and keeps everything else from the provider above: the business shell hands
 * its own glossary's words here (apps/web BusinessShell), so the account's host never watches the business.
 */
export function GuidanceTermsProvider({ terms, children }: { terms: Record<string, TermDefinition>; children?: ReactNode }) {
  const parent = useContext(GuidanceModeContext);
  const mode = useMemo<GuidanceModeValue>(() => ({ ...parent, terms }), [parent, terms]);
  return <GuidanceModeContext.Provider value={mode}>{children}</GuidanceModeContext.Provider>;
}

/** The switch, the text size, the definitions, `loaded` and the actions; never renders again for progress alone. */
export function useGuidanceMode(): GuidanceModeValue {
  return useContext(GuidanceModeContext);
}

/** The explainers seen, the tours done and the checklist's dismissal (Explainer, Coachmark, the checklist). */
export function useGuidanceProgress(): GuidanceProgressValue {
  return useContext(GuidanceProgressContext);
}

/** The current account's guidance state and actions (on, standard and no-ops outside a provider). Prefer the narrower hooks above. */
export function useGuidance(): GuidanceContextValue {
  const mode = useGuidanceMode();
  const progress = useGuidanceProgress();
  return useMemo(() => ({ ...mode, ...progress }), [mode, progress]);
}

/**
 * True when tutoring surfaces (explainers, the checklist, coach marks, term underlines) should render. Key caps on
 * buttons go the other way: they render when this is false.
 */
export function useGuided(): boolean {
  return useGuidanceMode().guidance === "on";
}

/** One definition by id, or undefined when the map does not hold it. */
export function useTerm(id: string): TermDefinition | undefined {
  return useGuidanceMode().terms[id];
}
