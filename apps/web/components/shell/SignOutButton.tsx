"use client";
/**
 * Sign out for the pages outside a business (the brand frame's pages and the first-run frame). A button that posts to
 * /auth/signout (lib/auth/sign-out.ts), never a link: the route answers POST only, so no other site can sign the founder
 * out with a link, and the founder's other tabs hear about it.
 */
import type { ComponentProps } from "react";
import { Button } from "@foundmill/dugout";
import { signOut } from "@/lib/auth/sign-out";

export function SignOutButton({ variant = "ghost", size = "sm", children = "Sign out", ...rest }: Omit<ComponentProps<typeof Button>, "onClick" | "type" | "asChild">) {
  return (
    <Button type="button" variant={variant} size={size} onClick={() => signOut()} {...rest}>
      {children}
    </Button>
  );
}
