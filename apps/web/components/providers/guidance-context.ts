"use client";
/**
 * The guided layer's app-side contexts and types (docs/UX_AUDIT_AND_PLAN.md §6.3), apart from GuidanceHost so the root
 * providers (GuidanceRoot) can provide the signed-out defaults without shipping the definitions map: this module never
 * imports `@foundmill/shared/terms`. GuidanceHost re-exports everything here, so callers import from either.
 */
import { createContext, useContext, useMemo } from "react";
import type { GuidanceOffSource } from "@foundmill/shared/constants";
import { DEFAULT_AGENT_STYLE, isAgentStyle, type AgentStyle } from "@foundmill/shared/personas";
import { isFounderPath } from "@/lib/auth/redirects";
import type { RouterInputs, RouterOutputs } from "@/lib/trpc";

/**
 * The guided layer's preferences, as the API answers them. `agentStyle` (which kind of character the agents wear when
 * `anthropomorphicAgents` is on) comes with the answer; `agentStyleOf` still reads an answer without it (a test fixture, an
 * older API) as "humans".
 */
export type GuidancePrefs = RouterOutputs["founder"]["preferences"]["guidance"];
/** A change to them (the date format is DateFormatHost's). */
export type GuidancePatch = Omit<RouterInputs["founder"]["preferences"]["update"], "date" | "time">;

/** The account's agent style: the stored one, else "humans" (an older answer, signed out, or an unknown value). */
export function agentStyleOf(prefs: { agentStyle?: unknown } | null | undefined): AgentStyle {
  return isAgentStyle(prefs?.agentStyle) ? prefs.agentStyle : DEFAULT_AGENT_STYLE;
}

/** One guided-layer signal as `founder.preferences.signal` takes it (the payload of a guidance.* event, with its type). */
export type GuidanceSignal = RouterInputs["founder"]["preferences"]["signal"]["signal"];
export type GuidanceSignalKind = GuidanceSignal["type"];
/** The payload of one kind of signal, without its type. */
export type GuidanceSignalPayload<K extends GuidanceSignalKind> = Omit<Extract<GuidanceSignal, { type: K }>, "type">;
/** Sends one signal, fire and forget: it returns at once, never throws, and a failure is dropped. */
export type GuidanceSignalFn = <K extends GuidanceSignalKind>(kind: K, payload: GuidanceSignalPayload<K>) => void;
/** What the host hands `founder.preferences.signal`. */
export type GuidanceSignalInput = RouterInputs["founder"]["preferences"]["signal"];

const noSignal: GuidanceSignalFn = () => undefined;
const GuidanceSignalCtx = createContext<GuidanceSignalFn>(noSignal);

/** Provides a `signal` below it: the host's own, or a fake in a story or a test. */
export const GuidanceSignalProvider = GuidanceSignalCtx.Provider;

/** The host's `signal` (a no-op outside <GuidanceHost>, so a tour or a test can call it anywhere). */
export function useGuidanceSignal(): GuidanceSignalFn {
  return useContext(GuidanceSignalCtx);
}

/** What everyone reads until the account answers, and on every signed-out page. */
export const DEFAULT_GUIDANCE_PREFS: Readonly<GuidancePrefs> = Object.freeze({ guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null, anthropomorphicAgents: false, agentStyle: DEFAULT_AGENT_STYLE, builderView: false });

/** True on the pages the proxy reserves for a signed-in founder; `/` is the landing page for a visitor, so it is not one. */
export function isSignedInPath(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && pathname !== "/" && isFounderPath(pathname);
}

export interface GuidanceSaveOptions {
  /** Where a change that turns guidance off was made (the `guidance.turned_off` signal); default "settings". */
  from?: GuidanceOffSource;
}

export interface GuidancePreferencesApi {
  prefs: GuidancePrefs;
  /**
   * Saves a change; the guided layer follows at once everywhere. Rejects when the save fails (then it is rolled back).
   * A saved change from on to off sends `guidance.turned_off`.
   */
  save: (patch: GuidancePatch, options?: GuidanceSaveOptions) => Promise<GuidancePrefs>;
  /** Sends one product signal (fire and forget; see GuidanceHost). */
  signal: GuidanceSignalFn;
  saving: boolean;
  /** False on a signed-out page: nothing is read, nothing can be saved, everything reads as the default. */
  signedIn: boolean;
  /**
   * False while a signed-in account's answer is still on its way (the values above are the defaults until then). Missing
   * reads as true (a fake in a story or a test).
   */
  loaded?: boolean;
}

/** Outside a signed-in layout: the defaults, nothing saved, no signal. */
export const SIGNED_OUT_GUIDANCE: GuidancePreferencesApi = Object.freeze({
  prefs: DEFAULT_GUIDANCE_PREFS,
  save: () => Promise.reject(new Error("Sign in to change your preferences")),
  signal: noSignal,
  saving: false,
  signedIn: false,
});

const GuidancePreferencesCtx = createContext<GuidancePreferencesApi | null>(null);

/** Provides the preferences API below it (GuidanceHost on a signed-in page, GuidanceRoot's signed-out one elsewhere). */
export const GuidancePreferencesProvider = GuidancePreferencesCtx.Provider;

/** The current choice and a way to change it (Settings › Preferences). Throws outside <GuidanceHost> and <GuidanceRoot>. */
export function useGuidancePreferences(): GuidancePreferencesApi {
  const ctx = useContext(GuidancePreferencesCtx);
  if (!ctx) throw new Error("useGuidancePreferences must be used inside <GuidanceHost>");
  return ctx;
}

/** The toast after Builder view is saved (Settings › Preferences, and the gated tab's "Turn on Builder view"). */
export function builderViewSavedLine(on: boolean): { title: string; description: string } {
  return on
    ? { title: "Builder view on", description: "How the platform runs the team now shows, in every business." }
    : { title: "Builder view off", description: "The technical details are hidden again, in every business." };
}

/** The account's Builder view switch, whether it is known yet, and a way to change it. */
export interface BuilderViewPreference {
  /** Builder view is on (false until the account answers, and on every signed-out page). */
  on: boolean;
  /** The account's answer has arrived (a builder-only route shows a skeleton until then, never the gate). */
  loaded: boolean;
  /** Saves the switch for the account, in every business; rejects when the save fails (it is rolled back). */
  setOn: (on: boolean) => Promise<GuidancePrefs>;
}

/**
 * Builder view as the app reads and changes it (docs/DESIGN.md "Builder view"). The design system's `useBuilderView()`
 * reads the same value from the BuilderViewProvider GuidanceHost mounts; this hook adds `loaded` and the save. Outside
 * a host it reads off, loaded, and saving rejects.
 */
export function useBuilderViewPreference(): BuilderViewPreference {
  const api = useContext(GuidancePreferencesCtx) ?? SIGNED_OUT_GUIDANCE;
  const { prefs, save } = api;
  const loaded = api.loaded ?? true;
  return useMemo(() => ({ on: prefs.builderView === true, loaded, setOn: (on: boolean) => save({ builderView: on }) }), [prefs.builderView, loaded, save]);
}
