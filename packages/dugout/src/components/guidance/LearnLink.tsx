"use client";
/**
 * Where "Learn more" goes. A `TermDefinition.learn` is a route slug the app resolves ("finance/runway") or an
 * absolute URL. The app mounts one `LearnLinkProvider` beside its GuidanceProvider with a resolver that knows the
 * business's base path; outside one (stories, tests) a slug becomes a root-relative path and a URL passes through.
 */
import { createContext, useContext, type ReactNode } from "react";

export type LearnResolver = (learn: string) => string | undefined;

/** The default resolver: absolute URLs and paths pass through; a slug becomes "/<slug>". */
export function resolveLearnHref(learn: string): string | undefined {
  const t = learn.trim();
  if (!t) return undefined;
  if (/^(https?:)?\/\//i.test(t) || t.startsWith("/") || t.startsWith("#")) return t;
  return `/${t}`;
}

/** True for a target outside the app (opens in a new tab). */
export function isExternalLearnHref(href: string): boolean {
  return /^(https?:)?\/\//i.test(href);
}

const LearnLinkContext = createContext<LearnResolver>(resolveLearnHref);

export function LearnLinkProvider({ resolve, children }: { resolve: LearnResolver; children?: ReactNode }) {
  return <LearnLinkContext.Provider value={resolve}>{children}</LearnLinkContext.Provider>;
}

/** The href for a definition's `learn`, through the app's resolver; undefined when there is nothing to open. */
export function useLearnHref(learn: string | undefined): string | undefined {
  const resolve = useContext(LearnLinkContext);
  if (!learn) return undefined;
  return resolve(learn) ?? undefined;
}
