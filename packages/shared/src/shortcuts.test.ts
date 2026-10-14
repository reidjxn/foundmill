import { describe, expect, it } from "vitest";
import { DEPARTMENT_SHORTCUT_LETTERS, departmentLetters, isDepartmentShortcut, letterCandidates } from "./shortcuts";

const HARDWARE = [
  { id: "dev", name: "Development" },
  { id: "ops", name: "Operations" },
  { id: "dist", name: "Distribution" },
  { id: "fin", name: "Finance" },
];

describe("department shortcuts", () => {
  it("derives letters from names: initials first, reserved letters never", () => {
    expect(letterCandidates("Formulation Lab")).toEqual(["F", "L", "O", "R", "M", "U", "A", "T", "I", "N", "B"]);
    expect(Object.fromEntries(departmentLetters(HARDWARE))).toEqual({ dev: "D", ops: "O", dist: "S", fin: "F" });
    expect(isDepartmentShortcut("Q")).toBe(true);
    for (const reserved of ["G", "H", "I", "C", "q", "QQ", "", null]) expect(isDepartmentShortcut(reserved)).toBe(false);
    expect(DEPARTMENT_SHORTCUT_LETTERS).toHaveLength(22);
  });

  it("keeps stored letters, so renaming one department moves only its own (audit AC-13)", () => {
    const stored = HARDWARE.map((d) => ({ ...d, shortcut: departmentLetters(HARDWARE).get(d.id) }));
    // Without stored letters a rename cascades: Distribution S → D, Finance F → N.
    const renamed = HARDWARE.map((d) => (d.id === "dev" ? { ...d, name: "Formulation Lab" } : d));
    expect(Object.fromEntries(departmentLetters(renamed))).toEqual({ dev: "F", ops: "O", dist: "D", fin: "N" });
    // With them, the renamed department (its letter cleared) takes the first free letter of its new name.
    const settled = stored.map((d) => (d.id === "dev" ? { ...d, name: "Formulation Lab", shortcut: null } : d));
    expect(Object.fromEntries(departmentLetters(settled))).toEqual({ dev: "L", ops: "O", dist: "S", fin: "F" });
  });

  it("ignores a stored letter that is reserved or already taken, and derives one instead", () => {
    const letters = departmentLetters([
      { id: "a", name: "Analytics", shortcut: "H" },
      { id: "b", name: "Brand", shortcut: "x" },
      { id: "c", name: "Content", shortcut: "X" },
    ]);
    expect(Object.fromEntries(letters)).toEqual({ a: "A", b: "X", c: "O" });
  });
});
