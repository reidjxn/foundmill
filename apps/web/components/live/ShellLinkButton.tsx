"use client";
/** A Dugout button that navigates: the Next.js link inside a button's clothes (keeps one focus stop and Enter to follow). */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@foundmill/dugout";

export function ShellLinkButton({ href, children, ...button }: { href: string; children: ReactNode } & Omit<ComponentProps<typeof Button>, "asChild" | "children">) {
  return (
    <Button asChild {...button}>
      <Link href={href} prefetch={false}>
        {children}
      </Link>
    </Button>
  );
}
