import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CHORD_TIMEOUT_MS, KEYBOARD_SHORTCUTS, departmentLetters, letterCandidates, shellDepartmentLetters, shortcutList, spaceBelongsTo, useKeyboardMap, type KeyboardMapContext } from "./keyboard";
import { AREAS_FOR_KEYS, DEPARTMENTS_FOR_KEYS } from "./fixtures";

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

describe("shellDepartmentLetters", () => {
  it("keeps a module-less department off Today's, Needs you's and the areas' letters, stored letters included", () => {
    const letters = shellDepartmentLetters([
      { id: "a", name: "Partners", shortcut: "P" },
      { id: "b", name: "Merch" },
      { id: "c", name: "Studio", shortcut: "Q" },
    ]);
    expect(Object.fromEntries(letters)).toEqual({ a: "A", b: "E", c: "Q" });
  });
});

describe("shortcutList", () => {
  it("lists every BUILD §5.5 shortcut, then the area chords and the module-less departments' after Go to Needs you", () => {
    const list = shortcutList([{ id: "d-studio", name: "Studio" }], AREAS_FOR_KEYS);
    const ids = list.map((s) => s.id);
    for (const s of KEYBOARD_SHORTCUTS) expect(ids).toContain(s.id);
    expect(ids).not.toContain("go-crm");
    expect(ids.slice(ids.indexOf("go-inbox"), ids.indexOf("go-inbox") + 7)).toEqual(["go-inbox", "go-area-plan", "go-area-customers", "go-area-money", "go-area-product", "go-area-team", "go-dept-d-studio"]);
    expect(list.filter((s) => s.id.startsWith("go-")).map((s) => `${s.keys.join(" ")} ${s.label}`)).toEqual([
      "G H Go to Today",
      "G I Go to Needs you",
      "G P Go to Plan",
      "G C Go to Customers",
      "G M Go to Money",
      "G R Go to Product",
      "G T Go to Team",
      "G S Go to Studio",
    ]);
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

  it("G then a letter goes to Today, Needs you, an area or a module-less department, and swallows the single-key shortcut", async () => {
    const user = userEvent.setup();
    const { handlers, hook } = setup({ areas: AREAS_FOR_KEYS, departments: [{ id: "d-studio", name: "Studio" }] });
    await user.keyboard("g");
    expect(hook.result.current.chordPending).toBe(true);
    await user.keyboard("h");
    expect(handlers.onGoTo).toHaveBeenCalledWith({ kind: "home" });
    expect(hook.result.current.chordPending).toBe(false);
    await user.keyboard("gi");
    expect(handlers.onGoTo).toHaveBeenCalledWith({ kind: "inbox" });
    // G C is Customers now (Contacts is one of its tabs).
    await user.keyboard("gc");
    expect(handlers.onGoTo).toHaveBeenLastCalledWith({ kind: "area", area: "customers" });
    await user.keyboard("gm");
    expect(handlers.onGoTo).toHaveBeenLastCalledWith({ kind: "area", area: "money" });
    // "G R" is Product: Refresh (R) must not fire.
    await user.keyboard("gr");
    expect(handlers.onGoTo).toHaveBeenLastCalledWith({ kind: "area", area: "product" });
    expect(handlers.onRefreshInbox).not.toHaveBeenCalled();
    await user.keyboard("gs");
    expect(handlers.onGoTo).toHaveBeenLastCalledWith({ kind: "department", id: "d-studio" });
    // "G X": no one's letter, so nothing navigates.
    await user.keyboard("gx");
    expect(handlers.onGoTo).toHaveBeenCalledTimes(6);
    await user.keyboard("gp");
    await user.keyboard("gt");
    expect(handlers.onGoTo).toHaveBeenCalledWith({ kind: "area", area: "plan" });
    expect(handlers.onGoTo).toHaveBeenLastCalledWith({ kind: "area", area: "team" });
  });

  it("an area the sidebar does not show has no chord", async () => {
    const user = userEvent.setup();
    const { handlers } = setup({ areas: ["plan", "product"], departments: [] });
    await user.keyboard("gc");
    expect(handlers.onGoTo).not.toHaveBeenCalled();
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
