import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkles, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./Dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuTrigger } from "./DropdownMenu";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Skeleton, SkeletonRows, SkeletonText } from "./Skeleton";
import { Spinner } from "./Spinner";
import { ToastPlacement, ToastProvider, toastStack, useToast, type ToastOptions } from "./Toast";
import { menuContentClass, menuItemClass, triggerChevronClass } from "./menuStyles";

describe("menus", () => {
  it("share one glass surface that scales from its trigger, with 32 px items and an 8 % highlight", () => {
    expect(menuContentClass).toContain("surface-popover");
    expect(menuContentClass).toContain("overlay-motion");
    expect(menuItemClass).toContain("h-control-md");
    expect(menuItemClass).toContain("data-highlighted:bg-white/8");
    expect(triggerChevronClass).toContain("group-data-[state=open]/trigger:rotate-180");
  });

  it("renders an open DropdownMenu on the shared surface, danger items tinted, the sub-menu chevron ready to move", () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem variant="danger">Archive</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("surface-popover");
    expect(menu.className).toContain("overlay-motion");
    expect(screen.getByRole("menuitem", { name: "Archive" }).getAttribute("data-variant")).toBe("danger");
    const sub = screen.getByRole("menuitem", { name: "Move to" });
    expect(sub.className).toContain("group/sub");
    expect(sub.querySelector("svg")?.getAttribute("class")).toContain("group-data-[state=open]/sub:translate-x-0.5");
  });
});

describe("Dialog", () => {
  it("is glass on the dialog surface, and its header keeps the title clear of the close button", () => {
    render(
      <Dialog defaultOpen>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>A long title that wraps under where the close button sits in the corner</DialogTitle>
          </DialogHeader>
          <DialogBody>Body</DialogBody>
          <DialogFooter>Footer</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("surface-dialog");
    expect(dialog.className).toContain("overlay-motion");
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("size-control-sm");
    // The close button is 28 px, 9.75 px in from the right: the title's own pr-9 plus the 16 px gutter (45.25 px) leaves
    // it 7.5 px clear; the description under it keeps the full width.
    const header = dialog.querySelector("[data-dialog-header]")!;
    expect(header.className).toContain("[&>:first-child]:pr-9");
    expect(header.className).toContain("px-gutter");
  });

  function StateOpened() {
    // Opened from state by a plain button, as the product's openers are (no DialogTrigger, so Radix has no trigger ref).
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Go on vacation
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Vacation</DialogTitle>
            <DialogFooter>
              <button type="button" autoFocus onClick={() => setOpen(false)}>
                Cancel
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  it("gives focus back to the button that opened it, on Esc and on Cancel (WCAG 2.4.3)", async () => {
    const user = userEvent.setup();
    render(<StateOpened />);
    const opener = screen.getByRole("button", { name: "Go on vacation" });
    opener.focus();
    await user.keyboard("{Enter}");
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  function MenuOpened() {
    // "Merge…" in a row's menu: the dialog opens as the menu closes, so the item it came from is gone by the time it closes.
    const [open, setOpen] = useState(false);
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">Row actions</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setOpen(true)}>Merge…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Merge</DialogTitle>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  it("opened from a menu item, gives focus back to what opened the menu", async () => {
    const user = userEvent.setup();
    render(<MenuOpened />);
    const trigger = screen.getByRole("button", { name: "Row actions" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menuitem", { name: "Merge…" });
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Merge" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  function Chained() {
    // A palette whose command opens another dialog as the palette closes (Ctrl+K › Ask opens the agent's desk).
    const [dialog, setDialog] = useState<"palette" | "desk" | null>(null);
    return (
      <>
        <button type="button" onClick={() => setDialog("palette")}>
          Search
        </button>
        <Dialog open={dialog === "palette"} onOpenChange={(o) => setDialog(o ? "palette" : null)}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Palette</DialogTitle>
            <button type="button" onClick={() => setDialog("desk")}>
              Ask Juno
            </button>
          </DialogContent>
        </Dialog>
        <Dialog open={dialog === "desk"} onOpenChange={(o) => setDialog(o ? "desk" : null)}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Desk</DialogTitle>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  it("opened from an overlay that closes as it opens, gives focus back to where both opened from", async () => {
    const user = userEvent.setup();
    render(<Chained />);
    const search = screen.getByRole("button", { name: "Search" });
    search.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "Ask Juno" }));
    await screen.findByRole("dialog", { name: "Desk" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(search));
  });
});

function Fire({ toasts }: { toasts: ToastOptions[] }) {
  const { toast } = useToast();
  useEffect(() => {
    for (const t of toasts) toast(t);
    // Fire once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe("Toast", () => {
  it("stacks: the newest is in front and each older toast moves by the newer toasts' heights plus gaps", () => {
    expect(toastStack(["a", "b", "c"], { a: 50, b: 60, c: 70 }, 8)).toEqual({
      c: { index: 0, offset: 0 },
      b: { index: 1, offset: 78 },
      a: { index: 2, offset: 146 },
    });
  });

  it("renders a tone tile, a timer and the deck variables; the stack sits bottom left by default", async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <Fire toasts={[{ title: "Saved", tone: "good" }, { title: "Synced", tone: "info", description: "3 accounts", duration: Infinity }]} />
        </ToastProvider>,
      );
    });
    const viewport = document.querySelector("[data-dugout-toasts]")!;
    expect(viewport.getAttribute("data-position")).toBe("bottom-left");
    expect(viewport.className).toContain("toast-viewport");
    const items = Array.from(document.querySelectorAll<HTMLElement>("li.toast"));
    expect(items).toHaveLength(2);
    const [saved, synced] = items as [HTMLElement, HTMLElement];
    expect(synced.hasAttribute("data-front")).toBe(true);
    expect(synced.style.getPropertyValue("--toast-index")).toBe("0");
    expect(saved.style.getPropertyValue("--toast-index")).toBe("1");
    expect(saved.className).toContain("tone-status-good");
    expect(saved.querySelector(".toast-tile svg")).not.toBeNull();
    // A timed toast shows its timer for its own duration; one kept until dismissed has none.
    expect(saved.querySelector("[data-toast-timer]")).not.toBeNull();
    expect(saved.style.getPropertyValue("--toast-duration")).toBe("5000ms");
    expect(synced.querySelector("[data-toast-timer]")).toBeNull();
  });

  it("follows the mounted layout: beside the shell's sidebar at its width, bottom right in a frame without one", async () => {
    const view = (layout: ReactNode) => (
      <ToastProvider>
        {layout}
        <Fire toasts={[{ title: "Saved" }]} />
      </ToastProvider>
    );
    const { rerender } = render(view(<ToastPlacement position="bottom-left" sidebar="collapsed" />));
    const viewport = () => document.querySelector("[data-dugout-toasts]")!;
    expect(viewport().getAttribute("data-position")).toBe("bottom-left");
    expect(viewport().getAttribute("data-sidebar")).toBe("collapsed");
    rerender(view(<ToastPlacement position="bottom-right" sidebar="none" />));
    expect(viewport().getAttribute("data-position")).toBe("bottom-right");
    // The layout gone, the stack goes back to the default.
    rerender(view(null));
    expect(viewport().getAttribute("data-position")).toBe("bottom-left");
    expect(viewport().getAttribute("data-sidebar")).toBe("expanded");
  });

  it("keeps an explicit position whatever the layout says", () => {
    render(
      <ToastProvider position="top-right">
        <ToastPlacement position="bottom-right" />
      </ToastProvider>,
    );
    expect(document.querySelector("[data-dugout-toasts]")?.getAttribute("data-position")).toBe("top-right");
  });

  it("keeps toasts deeper than three hidden in the stack", async () => {
    await act(async () => {
      render(
        <ToastProvider max={5}>
          <Fire toasts={[1, 2, 3, 4].map((n) => ({ title: `T${n}` }))} />
        </ToastProvider>,
      );
    });
    const items = Array.from(document.querySelectorAll<HTMLElement>("li.toast"));
    expect(items.map((li) => li.getAttribute("data-depth"))).toEqual(["far", null, null, null]);
  });
});

describe("EmptyState", () => {
  it("puts the icon on a department-lit halo, one line, and an action slot for a generate control", () => {
    render(
      <EmptyState icon={Users} tone="dept-3" action={{ label: "Hire agent" }} actions={<button type="button">Draft with Juno</button>}>
        No agents yet.
      </EmptyState>,
    );
    const state = screen.getByRole("status");
    expect(state.getAttribute("data-tone")).toBe("dept-3");
    const halo = state.querySelector(".icon-halo")!;
    expect(halo.className).toContain("tone-dept-3");
    expect(halo.className).toContain("size-control-lg");
    expect(screen.getByRole("button", { name: "Hire agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft with Juno" })).toBeTruthy();
  });

  it("is neutral by default, compact on request, and renders on the server", () => {
    const html = renderToStaticMarkup(<EmptyState icon={Sparkles} compact>Nothing yet.</EmptyState>);
    expect(html).toContain("icon-halo");
    expect(html).toContain("size-control-md");
    expect(html).not.toContain("tone-dept");
  });
});

describe("ErrorState", () => {
  it("keeps the pill and the line, with technical detail behind a disclosure", () => {
    render(<ErrorState detail="ECONNRESET">Could not load cash.</ErrorState>);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Error");
    expect(alert.textContent).toContain("Could not load cash.");
    expect(alert.querySelector("details pre")?.textContent).toBe("ECONNRESET");
  });
});

describe("Skeleton", () => {
  it("staggers its band through --i, set from index", () => {
    render(<Skeleton index={3} data-testid="bar" />);
    const bar = screen.getByTestId("bar");
    expect(bar.className).toContain("skeleton-bar");
    expect(bar.style.getPropertyValue("--i")).toBe("3");
  });

  it("numbers text lines and table rows so the band runs top to bottom, and stays server-safe", () => {
    const text = renderToStaticMarkup(<SkeletonText lines={3} start={2} />);
    expect(text.match(/--i:(\d)/g)).toEqual(["--i:2", "--i:3", "--i:4"]);
    const rows = renderToStaticMarkup(<SkeletonRows rows={2} cols={2} />);
    expect(rows.match(/--i:(\d)/g)).toEqual(["--i:0", "--i:0", "--i:1", "--i:1"]);
  });
});

describe("Spinner", () => {
  it("announces loading by default and can be a bare glyph inside a busy control", () => {
    const { rerender } = render(<Spinner />);
    expect(screen.getByRole("status").textContent).toBe("Loading");
    rerender(<Spinner decorative />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
