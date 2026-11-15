/**
 * Department shortcuts for the G chord (BUILD §5.5, §11.13): pure, shared by the shell (which binds the keys) and the
 * API (which stores each department's letter so renaming one department never moves another's).
 *
 * Since the founder areas (2026-11-09) the shell's chords follow the areas (G P Plan, G C Customers, G M Money, G R
 * Product, G T Team; `AREA_LETTERS` in ./areas) next to G H Today and G I Needs you (`SHELL_FIXED_LETTERS`). Only a
 * department with no modules keeps a letter of its own in the shell, chosen around the area letters. The stored
 * `departments.shortcut` column and its rules here are unchanged (no migration).
 */
import { AREA_LETTERS } from "./areas";

/** Letters the stored department shortcut reserves for fixed surfaces. G is excluded so "G G" never restarts the chord. */
export const RESERVED_SECTION_LETTERS: Readonly<Record<string, "home" | "inbox" | "crm">> = { H: "home", I: "inbox", C: "crm" };
export const CHORD_LETTER = "G";

/** The shell's fixed chords: G H Today, G I Needs you. Every area letter is taken as well (`SHELL_RESERVED_LETTERS`). */
export const SHELL_FIXED_LETTERS: Readonly<Record<string, "home" | "inbox">> = { H: "home", I: "inbox" };

/** Every letter the shell's chord gives to something other than a module-less department: Today, Needs you, the areas. */
export const SHELL_RESERVED_LETTERS: readonly string[] = [...Object.keys(SHELL_FIXED_LETTERS), ...Object.values(AREA_LETTERS)];

export interface DepartmentForKeys {
  id: string;
  name: string;
  /** The stored letter (departments.shortcut). Kept when valid and free; otherwise the letter is derived from the name. */
  shortcut?: string | null;
}

function asciiLetters(name: string): string[] {
  return Array.from(name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()).filter((c) => /^[A-Z]$/.test(c));
}

/** True for a letter a department may hold: A–Z, not G and not a fixed surface's (H, I, C). */
export function isDepartmentShortcut(letter: unknown): letter is string {
  return typeof letter === "string" && /^[A-Z]$/.test(letter) && letter !== CHORD_LETTER && !(letter in RESERVED_SECTION_LETTERS);
}

/** Every letter a department may hold, A to Z. */
export const DEPARTMENT_SHORTCUT_LETTERS: readonly string[] = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).filter(isDepartmentShortcut);

/** Candidate letters for a name: initials of each word first, then the remaining letters in order. */
export function letterCandidates(name: string): string[] {
  const words = name
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => asciiLetters(w))
    .filter((w) => w.length > 0);
  const initials = words.map((w) => w[0] as string);
  const rest = words.flatMap((w) => w.slice(1));
  const out: string[] = [];
  for (const c of [...initials, ...rest]) if (!out.includes(c)) out.push(c);
  return out;
}

/**
 * Assign one letter per department for the G chord, in the founder's order, de-duplicated. A department's stored
 * letter wins (so renaming or moving one department never changes another's); the rest take the first free letter of
 * their name. Reserved letters (H, I, C, G) are never used. A department whose name offers no free letter takes the
 * first free letter of the alphabet; when the alphabet is exhausted it gets none. `reserved` keeps more letters out
 * (the shell passes `SHELL_RESERVED_LETTERS`, so a module-less department never takes an area's letter).
 */
export function departmentLetters(departments: readonly DepartmentForKeys[], reserved: readonly string[] = []): Map<string, string> {
  const used = new Set<string>([...Object.keys(RESERVED_SECTION_LETTERS), CHORD_LETTER, ...reserved]);
  const out = new Map<string, string>();
  for (const d of departments) {
    const stored = d.shortcut?.toUpperCase();
    if (isDepartmentShortcut(stored) && !used.has(stored)) {
      used.add(stored);
      out.set(d.id, stored);
    }
  }
  for (const d of departments) {
    if (out.has(d.id)) continue;
    const pick = letterCandidates(d.name).find((c) => !used.has(c));
    if (pick) {
      used.add(pick);
      out.set(d.id, pick);
    }
  }
  for (const d of departments) {
    if (out.has(d.id)) continue;
    const fallback = DEPARTMENT_SHORTCUT_LETTERS.find((c) => !used.has(c));
    if (!fallback) continue;
    used.add(fallback);
    out.set(d.id, fallback);
  }
  return out;
}
