import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RightRail } from "./RightRail";

/** A board token opens a profile rail, as the Channel Board does (A11Y-11). */
function Board() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <button type="button" onClick={() => setOpen("Paid advertising")}>
        Paid advertising
      </button>
      <button type="button" onClick={() => setOpen("SEO")}>
        SEO
      </button>
      {open ? (
        <RightRail title={open} open onOpenChange={(next) => !next && setOpen(null)} hideToggle focusOnOpen focusKey={open} closeOnEscape>
          <button type="button">Save budget</button>
        </RightRail>
      ) : null}
    </div>
  );
}

describe("RightRail", () => {
  it("moves focus to its title on open, closes on Esc and gives focus back to what opened it", async () => {
    const user = userEvent.setup();
    render(<Board />);
    const token = screen.getByRole("button", { name: "Paid advertising" });
    token.focus();
    await user.keyboard("{Enter}");
    const title = screen.getByRole("heading", { name: "Paid advertising" });
    expect(document.activeElement).toBe(title);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save budget" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(token);
  });

  it("gives focus back when it closes in place (still mounted, open turned off)", async () => {
    function InPlace() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Paid advertising
          </button>
          <RightRail title="Channel profile" open={open} onOpenChange={setOpen} hideToggle focusOnOpen closeOnEscape>
            <button type="button">Save budget</button>
          </RightRail>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<InPlace />);
    const token = screen.getByRole("button", { name: "Paid advertising" });
    token.focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Channel profile" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save budget" }));
    // The rail's content leaves the page before its effect cleans up, so focus would be on <body> by then.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Save budget" })).toBeNull();
    expect(document.activeElement).toBe(token);
  });

  it("leaves focus alone and ignores Esc unless asked", async () => {
    const user = userEvent.setup();
    let closed = false;
    render(
      <RightRail title="Details" open onOpenChange={() => (closed = true)}>
        <button type="button">Inside</button>
      </RightRail>,
    );
    expect(screen.getByRole("heading", { name: "Details" }).hasAttribute("tabindex")).toBe(false);
    screen.getByRole("button", { name: "Inside" }).focus();
    await user.keyboard("{Escape}");
    expect(closed).toBe(false);
  });
});
