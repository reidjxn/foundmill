"use client";
/**
 * Render options for the development screens the host (or a test) may override: the terminal renderer and diff
 * engine the tiles use (xterm + Monaco in a browser; plain + local in tests and SSR), a fixed clock for
 * deterministic elapsed/ETA labels, and the unfocused-tile flush interval.
 */
import { createContext, useContext, type ReactNode } from "react";

export interface DevScreenOptions {
  terminalRenderer?: "xterm" | "plain";
  diffEngine?: "monaco" | "local";
  /** Fixed "now" for stories and tests. */
  now?: Date;
  /** ms between bursts for unfocused tiles (default 250). */
  flushMs?: number;
}

const Ctx = createContext<DevScreenOptions>({});

export function DevScreenOptionsProvider({ value, children }: { value: DevScreenOptions; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDevScreenOptions(): DevScreenOptions {
  return useContext(Ctx);
}
