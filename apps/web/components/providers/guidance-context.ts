"use client";
/**
 * The guided layer's app-side contexts and types (docs/UX_AUDIT_AND_PLAN.md §6.3), apart from GuidanceHost so the root
 * providers (GuidanceRoot) can provide the signed-out defaults without shipping the definitions map: this module never
 * imports `@foundmill/shared/terms`. GuidanceHost re-exports everything here, so callers import from either.
 */
import { createContext, useContext } from "react";
import type { GuidanceOffSource } from "@foundmill/shared/constants";
import { isFounderPath } from "@/lib/auth/redirects";
import type { RouterInputs, RouterOutputs } from "@/lib/trpc";

/** The guided layer's preferences, as the API answers them. */
export type GuidancePrefs = RouterOutputs["founder"]["preferences"]["guidance"];
/** A change to them (the date format is DateFormatHost's). */
export type GuidancePatch = Omit<RouterInputs["founder"]["preferences"]["update"], "date" | "time">;

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
export const DEFAULT_GUIDANCE_PREFS: Readonly<GuidancePrefs> = Object.freeze({ guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null, anthropomorphicAgents: false });

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
