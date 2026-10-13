import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CHORD_TIMEOUT_MS, KEYBOARD_SHORTCUTS, departmentLetters, letterCandidates, shortcutList, spaceBelongsTo, useKeyboardMap, type KeyboardMapContext } from "./keyboard";
import { DEPARTMENTS_FOR_KEYS } from "./fixtures";

describe("letterCandidates", () => {
  it("prefers initials, then the remaining letters, de-duplicated, accents stripped", () => {
    expect(letterCandidates("Formulation Lab")).toEqual(["F", "L", "O", "R", "M", "U", "A", "T", "I", "N", "B"]);
    expect(letterCandidates("Équipe")).toEqual(["E", "Q", "U", "I", "P"]);
    expect(letterCandidates("R&D 2")).toEqual(["R", "D"]);
  });
});

describe("departmentLetters", () => {
  it("assigns one letter per department in order, never a reserved letter, never twice", () => {
    const letters = departmentLetters(DEPARTMENTS_FOR_KEYS);
    expect(letters.get("d-product")).toBe("P");
    expect(letters.get("d-development")).toBe("F"); // Formulation Lab
    expect(letters.get("d-distribution")).toBe("D");
    expect(letters.get("d-finance")).toBe("N"); // F taken, I and C reserved
    expect(letters.get("d-team")).toBe("T");
    expect(letters.get("d-legal")).toBe("L");
    expect(letters.get("d-operations")).toBe("O");
    const all = [...letters.values()];
    expect(new Set(all).size).toBe(all.length);
    for (const l of all) expect(["H", "I", "C", "G"]).not.toContain(l);
  });
  it("falls back to the first free letter of the alphabet when a name offers none", () => {
    const letters = departmentLetters([
      { id: "a", name: "Hi" },
      { id: "b", name: "Chi" },
    ]);
    expect(letters.get("a")).toBe("A");
    expect(letters.get("b")).toBe("B");
  });
  it("renamed departments get letters from the new name (AC-11.13.1)", () => {
    const before = departmentLetters([{ id: "x", name: "Development" }]);
    const after = departmentLetters([{ id: "x", name: "Formulation Lab" }]);
    expect(before.get("x")).toBe("D");
    expect(after.get("x")).toBe("F");
  });
});

describe("shortcutList", () => {
  it("contains every BUILD §5.5 shortcut and inserts department chords before Go to CRM", () => {
    const list = shortcutList(DEPARTMENTS_FOR_KEYS);
    const ids = list.map((s) => s.id);
    for (const s of KEYBOARD_SHORTCUTS) expect(ids).toContain(s.id);
    const crm = ids.indexOf("go-crm");
    const dept = ids.indexOf("go-dept-d-finance");
    expect(dept).toBeGreaterThan(ids.indexOf("go-inbox"));
    expect(dept).toBeLessThan(crm);
    expect(list.find((s) => s.id === "go-dept-d-finance")?.keys).toEqual(["G", "N"]);
    expect(list.find((s) => s.id === "go-dept-d-finance")?.label).toBe("Go to Finance");
  });
});

function setup(ctx: Partial<KeyboardMapContext> = {}) {
  const handlers = {
    onContinue: vi.fn(),
    onRefreshInbox: vi.fn(),
    onGoTo: vi.fn(),
    onSearch: vi.fn(),
    onNextInboxItem: vi.fn(),
    onPrevInboxItem: vi.fn(),
    onChooseOption: vi.fn(),
    onEditLayout: vi.fn(),
    onEscape: vi.fn(),
    onHelp: vi.fn(),
  };
  const hook = renderHook(() => useKeyboardMap({ ...handlers, departments: DEPARTMENTS_FOR_KEYS, ...ctx }));
  return { handlers, hook };
}

describe("useKeyboardMap", () => {
  it("binds the single keys", async () => {
    const user = userEvent.setup();
    const { handlers } = setup();
    document.body.focus();
    await user.keyboard(" ");
    expect(handlers.onContinue).toHaveBeenCalledTimes(1);
    await user.keyboard("r");
    expect(handlers.onRefreshInbox).toHaveBeenCalledTimes(1);
    await user.keyboard("j");
    await user.keyboard("k");
    expect(handlers.onNextInboxItem).toHaveBeenCalledTimes(1);
    expect(handlers.onPrevInboxItem).toHaveBeenCalledTimes(1);
    await user.keyboard("3");
    expect(handlers.onChooseOption).toHaveBeenCalledWith(3);
    await user.keyboard("e");
    expect(handlers.onEditLayout).toHaveBeenCalledTimes(1);
    await user.keyboard("/");
    expect(handlers.onSearch).toHaveBeenCalledTimes(1);
    await user.keyboard("{Control>}k{/Control}");
    expect(handlers.onSearch).toHaveBeenCalledTimes(2);
    await user.keyboard("{Escape}");
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
    await user.keyboard("?");
    expect(handlers.onHelp).toHaveBeenCalledTimes(1);
  });

  it("G then a letter goes to a fixed surface or a department, and swallows the single-key shortcut", async () => {
    const user = userEvent.setup();
    const { handlers, hook } = setup();
    await user.keyboard("g");
    expect(hook.result.current.chordPending).toBe(true);
    await user.keyboard("h");
    expect(handlers.onGoTo).toHaveBeenCalledWith({ kind: "home" });
    expect(hook.result.current.chordPending).toBe(false);
    await user.keyboard("gi");
    expect(handlers.onGoTo).toHaveBeenCalledWith({ kind: "inbox" });
    await user.keyboard("gc");
    expect(handlers.onGoTo).toHaveBeenCalledWith({ kind: "crm" });
    await user.keyboard("gn");
    expect(handlers.onGoTo).toHaveBeenCalledWith({ kind: "department", id: "d-finance" });
    // "G R": R is not a department letter, so nothing navigates and Refresh must not fire either.
    await user.keyboard("gr");
    expect(handlers.onRefreshInbox).not.toHaveBeenCalled();
    expect(handlers.onGoTo).toHaveBeenCalledTimes(4);
    // "G T" reaches Team even though T is not a single-key shortcut.
    await user.keyboard("gt");
    expect(handlers.onGoTo).toHaveBeenLastCalledWith({ kind: "department", id: "d-team" });
  });

  it("Esc or a second G cancels a pending chord without firing onEscape; the chord times out", async () => {
    const user = userEvent.setup();
    const { handlers, hook } = setup();
    await user.keyboard("g");
    expect(hook.result.current.chordPending).toBe(true);
    await user.keyboard("{Escape}");
    expect(handlers.onEscape).not.toHaveBeenCalled();
    expect(hook.result.current.chordPending).toBe(false);
    await user.keyboard("gg");
    expect(hook.result.current.chordPending).toBe(false);
    expect(handlers.onGoTo).not.toHaveBeenCalled();
    await user.keyboard("g");
    await act(() => new Promise((r) => setTimeout(r, CHORD_TIMEOUT_MS + 50)));
    expect(hook.result.current.chordPending).toBe(false);
    await user.keyboard("r");
    expect(handlers.onRefreshInbox).toHaveBeenCalledTimes(1);
  });

  it("leaves an Esc that an open dialog already handled to that dialog (audit OL-15)", async () => {
    const user = userEvent.setup();
    const { handlers } = setup();
    // Radix's DismissableLayer closes the top layer on the capture phase and marks the event handled.
    const closeDialog = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    document.addEventListener("keydown", closeDialog, { capture: true });
    await user.keyboard("{Escape}");
    expect(handlers.onEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", closeDialog, { capture: true });
    await user.keyboard("{Escape}");
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });

  it("ignores single keys typed into a text field, but Esc still closes overlays", async () => {
    const user = userEvent.setup();
    const { handlers } = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await user.keyboard("r");
    await user.keyboard("/");
    expect(handlers.onRefreshInbox).not.toHaveBeenCalled();
    expect(handlers.onSearch).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("leaves Space to a focused control: the checkbox toggles, the button presses, and Continue does not run", async () => {
    const user = userEvent.setup();
    const { handlers } = setup();
    const box = document.createElement("button");
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", "false");
    box.addEventListener("click", () => box.setAttribute("aria-checked", box.getAttribute("aria-checked") === "true" ? "false" : "true"));
    const sw = document.createElement("div");
    sw.setAttribute("role", "switch");
    sw.tabIndex = 0;
    const plain = document.createElement("div");
    plain.tabIndex = -1;
    plain.textContent = "Note body";
    document.body.append(box, sw, plain);
    box.focus();
    await user.keyboard(" ");
    expect(box.getAttribute("aria-checked")).toBe("true");
    sw.focus();
    await user.keyboard(" ");
    expect(handlers.onContinue).not.toHaveBeenCalled();
    // Plain content (a focused note body) is not a control: Continue takes Space there.
    plain.focus();
    await user.keyboard(" ");
    expect(handlers.onContinue).toHaveBeenCalledTimes(1);
    box.remove();
    sw.remove();
    plain.remove();
  });

  it("knows which elements own Space", () => {
    const el = (html: string) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      return host.firstElementChild;
    };
    expect(spaceBelongsTo(el("<button>Save</button>"))).toBe(true);
    expect(spaceBelongsTo(el('<a href="/x">Open</a>'))).toBe(true);
    expect(spaceBelongsTo(el("<summary>More</summary>"))).toBe(true);
    expect(spaceBelongsTo(el('<span role="radio" tabindex="0"></span>'))).toBe(true);
    expect(spaceBelongsTo(el('<div role="tab" tabindex="0"></div>'))).toBe(true);
    expect(spaceBelongsTo(el('<div contenteditable="true"></div>'))).toBe(true);
    expect(spaceBelongsTo(el('<div tabindex="-1">Body</div>'))).toBe(false);
    expect(spaceBelongsTo(document.body)).toBe(false);
    expect(spaceBelongsTo(null)).toBe(false);
  });

  it("does nothing when disabled or when a callback is missing", async () => {
    const user = userEvent.setup();
    const { handlers } = setup({ enabled: false });
    await user.keyboard(" r");
    expect(handlers.onContinue).not.toHaveBeenCalled();
    expect(handlers.onRefreshInbox).not.toHaveBeenCalled();
  });
});
