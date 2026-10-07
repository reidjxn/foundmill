"use client";
/**
 * Screen chrome: pages under /b/[bid] tell the shell their title, tab bar, breadcrumbs and right rail. The shell
 * lives in the layout, the page below it owns its tabs, so the page registers them here:
 *
 *   useShellChrome({ title: "Finance", tabs: { tabs, activeId } });
 *
 * Two contexts on purpose: the page that declares its chrome subscribes only to the stable setter, the shell that
 * renders it subscribes to the value. One context carrying both made every declaring page a consumer of its own
 * declaration (setChrome → provider re-render → page re-render → new `trailing` node → effect again → …), which
 * React stopped with "Maximum update depth exceeded" on every business screen.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AppShellProps, BreadcrumbItem, TabBarProps } from "@foundmill/dugout";

export interface ShellChrome {
  title?: ReactNode;
  tabs?: TabBarProps;
  breadcrumbs?: BreadcrumbItem[];
  rightRail?: AppShellProps["rightRail"];
}

type SetChrome = (chrome: ShellChrome) => void;

const ValueCtx = createContext<ShellChrome>({});
const SetterCtx = createContext<SetChrome | null>(null);

export function ShellChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<ShellChrome>({});
  return (
    <SetterCtx.Provider value={setChrome}>
      <ValueCtx.Provider value={chrome}>{children}</ValueCtx.Provider>
    </SetterCtx.Provider>
  );
}

/** The shell reads the current chrome. */
export function useShellChromeValue(): ShellChrome {
  return useContext(ValueCtx);
}

/** Pages declare their chrome for as long as they are mounted. */
export function useShellChrome(chrome: ShellChrome, deps: readonly unknown[] = []): void {
  const setChrome = useContext(SetterCtx);
  useEffect(() => {
    if (!setChrome) return;
    setChrome(chrome);
    return () => setChrome({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the values the chrome depends on
  }, [setChrome, ...deps]);
}
