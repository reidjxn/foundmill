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

/** The caret label when the person has neither a display name nor an email (the local dev viewer). */
export const ANONYMOUS_NAME = "Founder";

const DEFAULT_USER: SpecUser = { id: "anonymous", name: ANONYMOUS_NAME };
const Ctx = createContext<SpecUser>(DEFAULT_USER);

export function SpecUserProvider({ value, children }: { value: SpecUser; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSpecUser(): SpecUser {
  return useContext(Ctx);
}

/**
 * The name other writers read on this person's caret: their profile's display name, else the part of their email
 * before the @, never "You" (that word is wrong on everyone else's screen).
 */
export function specUserName(viewer: { name?: string | null; email?: string | null }): string {
  const name = viewer.name?.trim();
  if (name) return name;
  const local = viewer.email?.split("@")[0]?.trim();
  return local || ANONYMOUS_NAME;
}

/**
 * Department palette (DESIGN §2): the token each caret uses, with its value from tokens.css as the fallback. The caret
 * extension accepts only a six-digit hex colour (anything else renders transparent and logs a warning on every
 * awareness update), so the token is resolved to its hex value before it is published.
 */
export const CARET_TOKENS = [
  ["--dept-1", "#5b8cff"],
  ["--dept-2", "#3dd68c"],
  ["--dept-3", "#f5b841"],
  ["--dept-4", "#f2545b"],
  ["--dept-5", "#b98cff"],
  ["--dept-6", "#4fd1c5"],
  ["--dept-7", "#ff8a5b"],
  ["--dept-8", "#e879c8"],
] as const;

/** What the caret extension accepts (`@tiptap/extension-collaboration-caret`). */
export const CARET_COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

/** A CSS custom property from the document root ("" outside a browser). */
function readCssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** `#abc` → `#aabbcc`; a six-digit hex as is; anything else (a `var()`, `rgb()`, empty) → null. */
export function toHexColour(value: string): string | null {
  const v = value.trim();
  if (CARET_COLOUR_RE.test(v)) return v.toLowerCase();
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(v);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase() : null;
}

/** A user's caret colour: one department token per user id, resolved to a six-digit hex. */
export function caretColourFor(userId: string, read: (token: string) => string = readCssVar): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  const [token, fallback] = CARET_TOKENS[h % CARET_TOKENS.length]!;
  return toHexColour(read(token)) ?? fallback;
}
