"use client";
/**
 * Screen chrome: pages under /b/[bid] tell the shell their title, tab bar, breadcrumbs and right rail. The shell
 * lives in the layout, the page below it owns its tabs, so the page registers them here:
 *
 *   useShellChrome({ title: "Finance", tabs: { tabs, activeId } });
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppShellProps, BreadcrumbItem, TabBarProps } from "@foundmill/dugout";

export interface ShellChrome {
  title?: ReactNode;
  tabs?: TabBarProps;
  breadcrumbs?: BreadcrumbItem[];
  rightRail?: AppShellProps["rightRail"];
}

interface ChromeStore {
  chrome: ShellChrome;
  setChrome: (chrome: ShellChrome) => void;
}

const Ctx = createContext<ChromeStore | null>(null);

export function ShellChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<ShellChrome>({});
  const value = useMemo(() => ({ chrome, setChrome }), [chrome]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The shell reads the current chrome. */
export function useShellChromeValue(): ShellChrome {
  return useContext(Ctx)?.chrome ?? {};
}

/** Pages declare their chrome for as long as they are mounted. */
export function useShellChrome(chrome: ShellChrome, deps: readonly unknown[] = []): void {
  const store = useContext(Ctx);
  useEffect(() => {
    if (!store) return;
    store.setChrome(chrome);
    return () => store.setChrome({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the values the chrome depends on
  }, [store, ...deps]);
}
