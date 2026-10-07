"use client";
/** Dugout's shell links (Sidebar, TabBar, Breadcrumbs) rendered through next/link (docs/DECISIONS.md "Links are injected"). */
import Link from "next/link";
import type { ShellLinkRenderer } from "@foundmill/dugout";

export const renderNextShellLink: ShellLinkRenderer = ({ href, children, ref, ...rest }) => (
  <Link href={href} ref={ref} prefetch={false} {...rest}>
    {children}
  </Link>
);
