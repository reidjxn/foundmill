import { describe, expect, it } from "vitest";
import { EXAMPLE_ROLE_LABEL, switcherBusinesses, switcherRoleLabel } from "../business-switcher";

const current = { id: "nw", name: "Northwind Skincare (renamed)", kitPrimary: "#2B6CB0", logoSrc: "data:image/png;base64,AAAA", isDemo: true, role: "owner" as const };

describe("switcherBusinesses (Switch project)", () => {
  it("puts the open business first from business.get, even before the list loads or when it is missing from it", () => {
    expect(switcherBusinesses(undefined, current, {})).toEqual([{ id: "nw", name: "Northwind Skincare (renamed)", current: true, logoSrc: "data:image/png;base64,AAAA", primary: "#2B6CB0", roleLabel: null, demo: true }]);
    const rows = [
      { id: "lg", name: "Ledgerly", kitPrimary: "#1F6F5F", isDemo: true, role: "owner" as const },
      { id: "nw", name: "Northwind Skincare", kitPrimary: "#000000", isDemo: true, role: "owner" as const },
      { id: "tl", name: "Tutorlane", kitPrimary: "#7A3B8F", isDemo: false, role: "admin" as const },
    ];
    const list = switcherBusinesses(rows, current, { lg: "data:image/svg+xml;base64,BBBB" });
    expect(list.map((b) => b.id)).toEqual(["nw", "lg", "tl"]);
    // business.get's name and logo win for the open business.
    expect(list[0]).toMatchObject({ name: "Northwind Skincare (renamed)", primary: "#2B6CB0", current: true });
    expect(list[1]).toMatchObject({ logoSrc: "data:image/svg+xml;base64,BBBB", roleLabel: null, demo: true });
    expect(list[2]).toMatchObject({ logoSrc: null, roleLabel: "Admin", demo: false });
  });

  it("reads Example, not Viewer, for an example membership: the open one from the shell or the list, the others from the list", () => {
    expect(EXAMPLE_ROLE_LABEL).toBe("Example");
    expect(switcherRoleLabel("viewer")).toBe("Viewer");
    expect(switcherRoleLabel("viewer", true)).toBe("Example");
    const rows = [
      { id: "nw", name: "Northwind Skincare", kitPrimary: "#2B6CB0", isDemo: true, role: "viewer" as const, isExample: true },
      { id: "lg", name: "Ledgerly", kitPrimary: "#1F6F5F", isDemo: true, role: "viewer" as const, isExample: true },
      { id: "tl", name: "Tutorlane", kitPrimary: "#7A3B8F", isDemo: false, role: "viewer" as const, isExample: false },
    ];
    const viewer = { ...current, role: "viewer" as const };
    expect(switcherBusinesses(rows, { ...viewer, isExample: true }, {}).map((b) => b.roleLabel)).toEqual(["Example", "Example", "Viewer"]);
    // Before the shell knows, the list's mark for the open row decides.
    expect(switcherBusinesses(rows, viewer, {})[0]?.roleLabel).toBe("Example");
    // The shell's answer wins over a stale list.
    expect(switcherBusinesses(rows, { ...viewer, isExample: false }, {})[0]?.roleLabel).toBe("Viewer");
  });
});
