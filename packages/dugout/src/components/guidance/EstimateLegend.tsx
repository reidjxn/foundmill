"use client";
/**
 * One legend line for each screen that shows an estimate (WP-14 T7, Nov 17, 2026). `EstimateLegendScope` wraps a
 * screen (AppShell's content does it for every console and phone screen; a page outside the shell wraps itself); each
 * `Estimated` figure inside it registers while it is mounted, and the scope draws the line once, after its content,
 * only while at least one is on screen. Outside a scope (a story of one component) registering does nothing.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/** The legend's words, the brief's line. */
export const ESTIMATE_LEGEND_TEXT = "Numbers in this style are your team's estimates. Everything else is measured.";

type Register = () => () => void;

const EstimateLegendContext = createContext<Register | null>(null);

/** Called by each `Estimated` figure: counts it while mounted. */
export function useRegisterEstimate(): void {
  const register = useContext(EstimateLegendContext);
  useEffect(() => (register ? register() : undefined), [register]);
}

/** The legend line itself; `EstimateLegendScope` renders it, a story or a test may render it alone. */
export function EstimateLegend({ className }: { className?: string }) {
  return (
    <p data-estimate-legend className={cn("text-small text-tertiary", className)}>
      <span aria-hidden className="est-figure mr-1.5 cursor-default text-secondary tabular-nums">
        12
      </span>
      {ESTIMATE_LEGEND_TEXT}
    </p>
  );
}

export interface EstimateLegendScopeProps {
  children: ReactNode;
  /** Classes for the legend line (its padding inside the surface it closes). */
  legendClassName?: string;
}

export function EstimateLegendScope({ children, legendClassName }: EstimateLegendScopeProps) {
  const [count, setCount] = useState(0);
  const register = useCallback<Register>(() => {
    setCount((n) => n + 1);
    return () => setCount((n) => n - 1);
  }, []);
  const value = useMemo(() => register, [register]);
  return (
    <EstimateLegendContext.Provider value={value}>
      {children}
      {count > 0 ? <EstimateLegend className={legendClassName} /> : null}
    </EstimateLegendContext.Provider>
  );
}
