"use client";
/**
 * Who is typing: the awareness payload the collaborative SpecEditor publishes (name on the caret label, colour from
 * the department palette keyed by user id). Provided by the business shell so `ModuleEnv.SpecEditor` stays a stable
 * component identity (no remount when the token or viewer arrives).
 */
import { createContext, useContext, type ReactNode } from "react";

export interface SpecUser {
  id: string;
  name: string;
}

const DEFAULT_USER: SpecUser = { id: "anonymous", name: "You" };
const Ctx = createContext<SpecUser>(DEFAULT_USER);

export function SpecUserProvider({ value, children }: { value: SpecUser; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSpecUser(): SpecUser {
  return useContext(Ctx);
}

/** Department palette tokens (DESIGN §2); a user's caret keeps one colour for the session. */
export const CARET_COLOURS = ["var(--dept-1)", "var(--dept-2)", "var(--dept-3)", "var(--dept-4)", "var(--dept-5)", "var(--dept-6)", "var(--dept-7)", "var(--dept-8)"] as const;

export function caretColourFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return CARET_COLOURS[h % CARET_COLOURS.length]!;
}
