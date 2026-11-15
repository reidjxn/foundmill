"use client";
/**
 * The keyboard map (BUILD §5.5):
 * Space = Continue (unless a control has focus: then Space is the control's) · R = refresh Inbox · G then letter = go to
 * section (G H Today, G I Needs you, then the founder areas: G P Plan, G C Customers, G M Money, G R Product, G T
 * Team; a department with no modules keeps its stored letter, or gets one from its name, around those) · / or Cmd-K = search · J/K = next/prev inbox item · 1–4 = choose decision option · E = edit layout ·
 * Esc = close overlay.
 *
 * `departmentLetters` (in @foundmill/shared, so the API stores the same letters) is pure and tested; `useKeyboardMap`
 * binds the keys with react-hotkeys-hook. The G chord is tracked here rather than with the library's `g>h` sequences
 * because a department letter may coincide with a single-key shortcut (R, J, K, E) and the chord must win while it is
 * pending.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AREA_LABELS, AREA_LETTERS, CHORD_LETTER, SHELL_FIXED_LETTERS, SHELL_RESERVED_LETTERS, departmentLetters, type AreaKey, type DepartmentForKeys } from "@foundmill/shared";

// The letter rules are pure and shared with the API, which stores each department's letter (departments.shortcut).
export { AREA_LETTERS, CHORD_LETTER, DEPARTMENT_SHORTCUT_LETTERS, RESERVED_SECTION_LETTERS, SHELL_FIXED_LETTERS, SHELL_RESERVED_LETTERS, departmentLetters, isDepartmentShortcut, letterCandidates, type DepartmentForKeys } from "@foundmill/shared";

/** The letters of the shell's module-less departments: stored or from the name, never Today's, Needs you's or an area's. */
export function shellDepartmentLetters(departments: readonly DepartmentForKeys[]): Map<string, string> {
  return departmentLetters(departments, SHELL_RESERVED_LETTERS);
}

/** Milliseconds a pending G chord waits for its letter. */
export const CHORD_TIMEOUT_MS = 1000;

/** Elements whose own behavior Space drives: it presses buttons, toggles boxes, opens summaries, types into fields. */
const SPACE_TAGS = new Set(["BUTTON", "A", "SUMMARY", "INPUT", "SELECT", "TEXTAREA", "OPTION", "AUDIO", "VIDEO", "IFRAME"]);
/** ARIA widgets that take Space (WAI-ARIA APG): activation, selection or toggling. */
const SPACE_ROLES = new Set([
  "button",
  "checkbox",
  "switch",
  "radio",
  "radiogroup",
  "tab",
  "tablist",
  "option",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "link",
  "treeitem",
  "tree",
  "grid",
  "gridcell",
  "row",
  "slider",
  "spinbutton",
  "combobox",
  "textbox",
  "searchbox",
]);

/**
 * True when Space belongs to the focused element rather than to Continue: a native control (button, link, summary, form
 * field), anything editable, or an ARIA widget. Continue (and any page-level Space) fires only when focus is on the page
 * or on plain content; otherwise a keyboard user toggling a checkbox or a switch would start a cycle instead.
 */
export function spaceBelongsTo(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (SPACE_TAGS.has(target.tagName)) return true;
  if ((target as HTMLElement).isContentEditable || target.matches('[contenteditable]:not([contenteditable="false"])')) return true;
  const role = target.getAttribute("role");
  return role ? role.split(/\s+/).some((r) => SPACE_ROLES.has(r)) : false;
}

export type GoToTarget = { kind: "home" } | { kind: "inbox" } | { kind: "area"; area: AreaKey } | { kind: "department"; id: string };

export interface KeyboardMapContext {
  /** Space. */
  onContinue?: () => void;
  /** R. */
  onRefreshInbox?: () => void;
  /** G then a letter. */
  onGoTo?: (target: GoToTarget) => void;
  /** The founder areas the sidebar shows; each takes its `AREA_LETTERS` letter. */
  areas?: readonly AreaKey[];
  /** Module-less departments in the founder's order; their letters come from `shellDepartmentLetters`. */
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
  const letters = useMemo(() => shellDepartmentLetters(ctx.departments ?? []), [ctx.departments]);
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
    // Space stays with a focused control (it presses the button, ticks the box); Continue only takes it from the page.
    { enabled: (e) => single(e) && !spaceBelongsTo(e.target) },
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
      const fixed = SHELL_FIXED_LETTERS[letter];
      if (fixed) {
        e.preventDefault();
        go({ kind: fixed });
        return;
      }
      const area = (ctxRef.current.areas ?? []).find((a) => AREA_LETTERS[a] === letter);
      if (area) {
        e.preventDefault();
        go({ kind: "area", area });
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
    (e) => {
      // An open dialog, sheet, menu or popover took this Esc to close itself (Radix handles it on the capture phase and
      // marks it handled): the page underneath must not also react, e.g. Home leaving Edit mode when Esc closed the
      // Add widget drawer (audit OL-15).
      if (e.defaultPrevented) return;
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

/** The fixed list from BUILD §5.5. Area and department chords are inserted by `shortcutList`. */
export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  { id: "continue", keys: ["Space"], label: "Continue", group: "Navigation" },
  { id: "search", keys: ["/"], label: "Search", group: "Navigation" },
  { id: "search-cmd", keys: ["⌘K"], label: "Search (Ctrl-K on Windows and Linux)", group: "Navigation" },
  { id: "go-home", keys: ["G", "H"], label: "Go to Today", group: "Navigation" },
  // The sidebar's "Needs you" opens the Inbox on what needs a response (founder areas, 2026-11-09).
  { id: "go-inbox", keys: ["G", "I"], label: "Go to Needs you", group: "Navigation" },
  { id: "refresh", keys: ["R"], label: "Refresh Inbox: one new note", group: "Inbox" },
  { id: "next", keys: ["J"], label: "Next inbox item", group: "Inbox" },
  { id: "prev", keys: ["K"], label: "Previous inbox item", group: "Inbox" },
  { id: "option", keys: ["1", "–", "4"], label: "Choose a decision option", group: "Decisions" },
  { id: "edit", keys: ["E"], label: "Edit layout", group: "Layout" },
  { id: "escape", keys: ["Esc"], label: "Close overlay", group: "Layout" },
  { id: "help", keys: ["?"], label: "Keyboard shortcuts", group: "Help" },
];

/**
 * The fixed shortcuts plus, after Go to Needs you, one "Go to <area>" chord per area the sidebar shows (Contacts is a
 * Customers tab now, so G C opens Customers) and one "Go to <department>" chord per module-less department.
 */
export function shortcutList(departments: readonly DepartmentForKeys[] = [], areas: readonly AreaKey[] = []): KeyboardShortcut[] {
  const letters = shellDepartmentLetters(departments);
  const areaChords: KeyboardShortcut[] = areas.map((a) => ({ id: `go-area-${a}`, keys: ["G", AREA_LETTERS[a]], label: `Go to ${AREA_LABELS[a]}`, group: "Navigation" }));
  const depts: KeyboardShortcut[] = departments
    .filter((d) => letters.has(d.id))
    .map((d) => ({ id: `go-dept-${d.id}`, keys: ["G", letters.get(d.id) as string], label: `Go to ${d.name}`, group: "Navigation" }));
  const fixed = [...KEYBOARD_SHORTCUTS];
  const after = fixed.findIndex((s) => s.id === "go-inbox") + 1;
  fixed.splice(after, 0, ...areaChords, ...depts);
  return fixed;
}
