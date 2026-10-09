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
    // Where to go first (departments and agents), commands (settings among them) last.
    expect(groups.map((g) => g.kind)).toEqual(["department", "agent", "screen", "inbox", "person", "organisation", "team_member", "community", "command"]);
    expect(groups[0]?.label).toBe("Departments");
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

  it("leads with Ask and Generate: Ask carries the query and stays while typing, Generate follows it", async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    const onSelect = vi.fn();
    const ask = [{ id: "ask-cos", kind: "command" as const, label: "Ask the Chief of Staff", description: "Anything about the business" }];
    const generate = [
      { id: "gen-concepts", kind: "command" as const, label: "Draft 12 concepts" },
      { id: "gen-cover", kind: "command" as const, label: "Draft a cover plan", keywords: ["holiday"] },
    ];
    render(<CommandPalette open onOpenChange={() => {}} items={PALETTE_ITEMS} recent={RECENT_PALETTE_ITEMS} ask={ask} generate={generate} onAsk={onAsk} onSelect={onSelect} />);
    const headings = [...screen.getByTestId("command-palette").querySelectorAll("[cmdk-group-heading]")].map((h) => h.textContent);
    expect(headings.slice(0, 4)).toEqual(["Ask", "Generate", "Recent", "Departments"]);
    await user.type(screen.getByRole("combobox"), "cover");
    expect(await screen.findByRole("option", { name: /Ask the Chief of Staff.*“cover”/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Draft a cover plan/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Draft 12 concepts/ })).toBeNull();
    await user.click(screen.getByRole("option", { name: /Ask the Chief of Staff/ }));
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ id: "ask-cos", kind: "ask" }), "cover");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("matches the business by name even when the app searches remotely", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CommandPalette open onOpenChange={() => {}} items={[]} remote business={{ name: "Northwind Skincare", href: "/b/northwind/home" }} onSelect={onSelect} />);
    expect(screen.queryByRole("option", { name: /Northwind/ })).toBeNull();
    await user.type(screen.getByRole("combobox"), "skin");
    await user.click(await screen.findByRole("option", { name: /Northwind Skincare/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "business", href: "/b/northwind/home" }));
  });
});
