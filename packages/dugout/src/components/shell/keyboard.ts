/**
 * The keyboard map (BUILD §5.5):
 * Space = Continue · R = refresh Inbox · G then letter = go to section (G H Home, G I Inbox, G C CRM; departments get
 * letters from their names, de-duplicated) · / or Cmd-K = search · J/K = next/prev inbox item · 1–4 = choose decision
 * option · E = edit layout · Esc = close overlay.
 *
 * `departmentLetters` is pure and tested; `useKeyboardMap` binds the keys with react-hotkeys-hook. The G chord is
 * tracked here rather than with the library's `g>h` sequences because a department letter may coincide with a
 * single-key shortcut (R, J, K, E) and the chord must win while it is pending.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

/** Letters the chord reserves for fixed surfaces. G is excluded so "G G" never restarts the chord. */
export const RESERVED_SECTION_LETTERS: Readonly<Record<string, "home" | "inbox" | "crm">> = { H: "home", I: "inbox", C: "crm" };
const CHORD_LETTER = "G";
/** Milliseconds a pending G chord waits for its letter. */
export const CHORD_TIMEOUT_MS = 1000;

export interface DepartmentForKeys {
  id: string;
  name: string;
}

function asciiLetters(name: string): string[] {
  return Array.from(name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()).filter((c) => /^[A-Z]$/.test(c));
}

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
 * Assign one letter per department for the G chord, in the founder's order, de-duplicated.
 * Reserved letters (H, I, C, G) are never used. A department whose name offers no free letter takes the first free
 * letter of the alphabet; when the alphabet is exhausted it gets none.
 */
export function departmentLetters(departments: readonly DepartmentForKeys[]): Map<string, string> {
  const used = new Set<string>([...Object.keys(RESERVED_SECTION_LETTERS), CHORD_LETTER]);
  const out = new Map<string, string>();
  for (const d of departments) {
    const pick = letterCandidates(d.name).find((c) => !used.has(c));
    if (pick) {
      used.add(pick);
      out.set(d.id, pick);
    }
  }
  const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  for (const d of departments) {
    if (out.has(d.id)) continue;
    const fallback = alphabet.find((c) => !used.has(c));
    if (!fallback) continue;
    used.add(fallback);
    out.set(d.id, fallback);
  }
  return out;
}

export type GoToTarget = { kind: "home" } | { kind: "inbox" } | { kind: "crm" } | { kind: "department"; id: string };

export interface KeyboardMapContext {
  /** Space. */
  onContinue?: () => void;
  /** R. */
  onRefreshInbox?: () => void;
  /** G then a letter. */
  onGoTo?: (target: GoToTarget) => void;
  /** Departments in the founder's order; their letters come from `departmentLetters`. */
  departments?: readonly DepartmentForKeys[];
  /** / or Cmd-K (Ctrl-K elsewhere). */
  onSearch?: () => void;
  /** J. */
  onNextInboxItem?: () => void;
  /** K. */
  onPrevInboxItem?: () => void;
  /** 1–4. Only bound when provided, so a DecisionBar with its own hotkeys does not double-fire. */
  onChooseOption?: (option: 1 | 2 | 3 | 4) => void;
  /** E. */
  onEditLayout?: () => void;
  /** Esc. Also fires from inside inputs so overlays close from a search box. */
  onEscape?: () => void;
  /** ? (Shift+/). Opens the keyboard help overlay; not in BUILD §5.5 but harmless. */
  onHelp?: () => void;
  /** Master switch (default true). */
  enabled?: boolean;
}

export interface KeyboardMapResult {
  /** Department id → letter. */
  letters: Map<string, string>;
  /** True while G has been pressed and a letter is awaited. */
  chordPending: boolean;
  /** Cancel a pending chord (e.g. when an overlay opens). */
  cancelChord: () => void;
}

/** Every letter but G: the chord key itself is handled by its own binding (G G cancels a pending chord). */
const LETTER_KEYS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i))
  .filter((c) => c !== CHORD_LETTER.toLowerCase())
  .join(",");

/** Binds BUILD §5.5 to callbacks. Call once per shell. */
export function useKeyboardMap(ctx: KeyboardMapContext): KeyboardMapResult {
  const enabled = ctx.enabled ?? true;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const letters = useMemo(() => departmentLetters(ctx.departments ?? []), [ctx.departments]);
  const lettersRef = useRef(letters);
  lettersRef.current = letters;

  const pendingRef = useRef(false);
  const consumedRef = useRef<KeyboardEvent | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chordPending, setChordPending] = useState(false);

  const cancelChord = useCallback(() => {
    pendingRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setChordPending(false);
  }, []);

  const startChord = useCallback(() => {
    pendingRef.current = true;
    setChordPending(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(cancelChord, CHORD_TIMEOUT_MS);
  }, [cancelChord]);

  useEffect(() => () => cancelChord(), [cancelChord]);

  /** Single keys are suppressed while a chord is pending and for the event that completed one. */
  const single = useCallback((e: KeyboardEvent) => enabled && !pendingRef.current && e !== consumedRef.current, [enabled]);
  const whilePending = useCallback(() => enabled && pendingRef.current, [enabled]);

  useHotkeys(
    "space",
    (e) => {
      if (!ctxRef.current.onContinue) return;
      e.preventDefault();
      ctxRef.current.onContinue();
    },
    { enabled: single },
  );
  useHotkeys(
    "r",
    (e) => {
      if (!ctxRef.current.onRefreshInbox) return;
      e.preventDefault();
      ctxRef.current.onRefreshInbox();
    },
    { enabled: single },
  );
  useHotkeys(
    "g",
    (e) => {
      if (!ctxRef.current.onGoTo) return;
      e.preventDefault();
      if (pendingRef.current) cancelChord();
      else startChord();
    },
    { enabled },
  );
  useHotkeys(
    LETTER_KEYS,
    (e, hotkey) => {
      const letter = (hotkey.keys?.[0] ?? "").toUpperCase();
      consumedRef.current = e;
      cancelChord();
      const go = ctxRef.current.onGoTo;
      if (!go || !letter) return;
      const fixed = RESERVED_SECTION_LETTERS[letter];
      if (fixed) {
        e.preventDefault();
        go({ kind: fixed });
        return;
      }
      for (const [id, l] of lettersRef.current) {
        if (l === letter) {
          e.preventDefault();
          go({ kind: "department", id });
          return;
        }
      }
    },
    { enabled: whilePending },
  );
  // "/" is matched on event.key (useKey) so it works on every keyboard layout; ⌘K / Ctrl-K on the key code.
  useHotkeys(
    "/",
    (e) => {
      if (!ctxRef.current.onSearch) return;
      e.preventDefault();
      ctxRef.current.onSearch();
    },
    { enabled: single, useKey: true },
  );
  useHotkeys(
    "mod+k",
    (e) => {
      if (!ctxRef.current.onSearch) return;
      e.preventDefault();
      ctxRef.current.onSearch();
    },
    { enabled: single, enableOnFormTags: true },
  );
  useHotkeys(
    "j",
    (e) => {
      if (!ctxRef.current.onNextInboxItem) return;
      e.preventDefault();
      ctxRef.current.onNextInboxItem();
    },
    { enabled: single },
  );
  useHotkeys(
    "k",
    (e) => {
      if (!ctxRef.current.onPrevInboxItem) return;
      e.preventDefault();
      ctxRef.current.onPrevInboxItem();
    },
    { enabled: single },
  );
  useHotkeys(
    "1,2,3,4",
    (e, hotkey) => {
      const n = Number(hotkey.keys?.[0]);
      const choose = ctxRef.current.onChooseOption;
      if (!choose || !(n >= 1 && n <= 4)) return;
      e.preventDefault();
      choose(n as 1 | 2 | 3 | 4);
    },
    { enabled: (e) => single(e) && !!ctxRef.current.onChooseOption },
  );
  useHotkeys(
    "e",
    (e) => {
      if (!ctxRef.current.onEditLayout) return;
      e.preventDefault();
      ctxRef.current.onEditLayout();
    },
    { enabled: single },
  );
  useHotkeys(
    "escape",
    () => {
      if (pendingRef.current) {
        cancelChord();
        return;
      }
      ctxRef.current.onEscape?.();
    },
    { enabled, enableOnFormTags: true },
  );
  // "?" is matched on event.key with modifiers ignored (it is Shift + / on most layouts).
  useHotkeys(
    "?",
    (e) => {
      if (!ctxRef.current.onHelp) return;
      e.preventDefault();
      ctxRef.current.onHelp();
    },
    { enabled: single, useKey: true, ignoreModifiers: true },
  );

  return { letters, chordPending, cancelChord };
}


export type ShortcutGroup = "Navigation" | "Inbox" | "Decisions" | "Layout" | "Help";

export interface KeyboardShortcut {
  id: string;
  /** Keys shown as caps; a chord is two entries ("G", "H"). */
  keys: string[];
  label: string;
  group: ShortcutGroup;
}

/** The fixed list from BUILD §5.5. Department chords are appended by `shortcutList`. */
export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  { id: "continue", keys: ["Space"], label: "Continue", group: "Navigation" },
  { id: "search", keys: ["/"], label: "Search", group: "Navigation" },
  { id: "search-cmd", keys: ["⌘K"], label: "Search (Ctrl-K on Windows and Linux)", group: "Navigation" },
  { id: "go-home", keys: ["G", "H"], label: "Go to Home", group: "Navigation" },
  { id: "go-inbox", keys: ["G", "I"], label: "Go to Inbox", group: "Navigation" },
  { id: "go-crm", keys: ["G", "C"], label: "Go to CRM", group: "Navigation" },
  { id: "refresh", keys: ["R"], label: "Refresh Inbox: one new note", group: "Inbox" },
  { id: "next", keys: ["J"], label: "Next inbox item", group: "Inbox" },
  { id: "prev", keys: ["K"], label: "Previous inbox item", group: "Inbox" },
  { id: "option", keys: ["1", "–", "4"], label: "Choose a decision option", group: "Decisions" },
  { id: "edit", keys: ["E"], label: "Edit layout", group: "Layout" },
  { id: "escape", keys: ["Esc"], label: "Close overlay", group: "Layout" },
  { id: "help", keys: ["?"], label: "Keyboard shortcuts", group: "Help" },
];

/** The fixed shortcuts plus one "Go to <department>" chord per department. */
export function shortcutList(departments: readonly DepartmentForKeys[] = []): KeyboardShortcut[] {
  const letters = departmentLetters(departments);
  const depts: KeyboardShortcut[] = departments
    .filter((d) => letters.has(d.id))
    .map((d) => ({ id: `go-dept-${d.id}`, keys: ["G", letters.get(d.id) as string], label: `Go to ${d.name}`, group: "Navigation" }));
  const fixed = [...KEYBOARD_SHORTCUTS];
  const crmIndex = fixed.findIndex((s) => s.id === "go-crm");
  fixed.splice(crmIndex, 0, ...depts);
  return fixed;
}
