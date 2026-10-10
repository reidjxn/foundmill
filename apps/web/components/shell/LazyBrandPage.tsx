"use client";
/**
 * BrandPage for the not-found files. Every page's server payload carries its layouts' not-found trees, so a static
 * import would put the brand frame and the wordmark into the first load of every page; through this wrapper only the
 * wrapper ships until a not-found page actually renders (on the server first, like any page). React's own `lazy`
 * rather than next/dynamic: the root layout then carries no second copy of next/dynamic's loader beside the shell's.
 */
import { lazy } from "react";
import type { BrandPageProps } from "./BrandPage";

const BrandPage = lazy(() => import("./BrandPage").then((m) => ({ default: m.BrandPage })));

export function LazyBrandPage(props: BrandPageProps) {
  return <BrandPage {...props} />;
}
