import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette, filterPaletteItems, groupPaletteItems, kindsForFilter, matchScore, parseSearchQuery } from "./CommandPalette";
import { PALETTE_ITEMS, RECENT_PALETTE_ITEMS } from "./fixtures";

beforeAll(() => {
  // cmdk scrolls the selected item into view; happy-dom has no layout.
  if (typeof Element.prototype.scrollIntoView !== "function") Element.prototype.scrollIntoView = () => {};
});

describe("parseSearchQuery", () => {
  it("extracts BUILD §11.12 operators, quoted values and the command prefix", () => {
    const q = parseSearchQuery('kind:person owner:me role:"head of buying" nordic  beauty');
    expect(q.text).toBe("nordic beauty");
    expect(q.filters).toEqual({ kind: "person", owner: "me", role: "head of buying" });
    expect(q.commandsOnly).toBe(false);
    expect(parseSearchQuery("> stop")).toEqual({ raw: "> stop", text: "stop", filters: {}, commandsOnly: true });
    expect(parseSearchQuery("Department:Finance runway").filters.department).toBe("finance");
    expect(parseSearchQuery("kind:").filters.kind).toBeUndefined();
    expect(parseSearchQuery("   ").text).toBe("");
  });
  it("maps kind aliases", () => {
    expect(kindsForFilter("org")).toEqual(["organisation"]);
    expect(kindsForFilter("people")).toEqual(["person"]);
    expect(kindsForFilter("nope")).toBeUndefined();
  });
});

describe("filterPaletteItems", () => {
  it("ranks prefix over word-prefix over substring and keeps order for ties", () => {
    expect(matchScore({ label: "Sara Lindqvist" }, "sar")).toBe(3);
    expect(matchScore({ label: "Sara Lindqvist" }, "lind")).toBe(2);
    expect(matchScore({ label: "Sara Lindqvist" }, "ndq")).toBe(1);
    expect(matchScore({ label: "Formulation Lab", keywords: ["development"] }, "devel")).toBe(1);
    expect(matchScore({ label: "x" }, "zzz")).toBe(0);
    const out = filterPaletteItems(PALETTE_ITEMS, parseSearchQuery("me"));
    expect(out[0]?.label).toBe("Meridian Labs replied about the bundle");
    expect(out.map((i) => i.id)).toContain("o-meridian");
  });
  it("applies kind: and > locally, and skips text matching when remote", () => {
    expect(filterPaletteItems(PALETTE_ITEMS, parseSearchQuery("kind:agent")).every((i) => i.kind === "agent")).toBe(true);
    expect(filterPaletteItems(PALETTE_ITEMS, parseSearchQuery("kind:agent")).length).toBe(3);
    expect(filterPaletteItems(PALETTE_ITEMS, parseSearchQuery(">")).every((i) => i.kind === "command")).toBe(true);
    expect(filterPaletteItems(PALETTE_ITEMS, parseSearchQuery("> hol")).map((i) => i.id)).toEqual(["cmd-holiday"]);
    expect(filterPaletteItems(PALETTE_ITEMS, parseSearchQuery("zzz"), { remote: true }).length).toBe(PALETTE_ITEMS.length);
    expect(filterPaletteItems(PALETTE_ITEMS, parseSearchQuery("kind:unknown zzz"), { remote: true }).length).toBe(PALETTE_ITEMS.length);
  });
  it("groups by kind in the fixed order", () => {
    const groups = groupPaletteItems(PALETTE_ITEMS);
    expect(groups.map((g) => g.kind)).toEqual(["command", "screen", "department", "inbox", "person", "organisation", "agent", "team_member", "community"]);
    expect(groups[0]?.label).toBe("Commands");
  });
});

describe("CommandPalette", () => {
  it("shows recents when empty, filters as you types, selects with Enter and closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const onQueryChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} items={PALETTE_ITEMS} recent={RECENT_PALETTE_ITEMS} onSelect={onSelect} onQueryChange={onQueryChange} />);
    const dialog = screen.getByTestId("command-palette");
    expect(dialog.querySelector("[cmdk-group-heading]")?.textContent).toBe("Recent");
    const input = screen.getByRole("combobox");
    await user.type(input, "kind:person sar");
    expect(onQueryChange).toHaveBeenLastCalledWith("kind:person sar", expect.objectContaining({ text: "sar", filters: { kind: "person" } }));
    await waitFor(() => expect(screen.getByRole("option", { name: /Sara Lindqvist/ })).toBeTruthy());
    expect(screen.queryByRole("option", { name: /Scout/ })).toBeNull();
    expect(screen.queryByText("Recent")).toBeNull();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "p-sara" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the empty state and the operators hint, labels public profiles", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onOpenChange={() => {}} items={PALETTE_ITEMS} onSelect={() => {}} />);
    expect(screen.getByTestId("palette-hints").textContent).toContain("kind:");
    expect(screen.getByText(/On Foundmill/)).toBeTruthy();
    await user.type(screen.getByRole("combobox"), "qqqq");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Nothing matches"));
  });
});
