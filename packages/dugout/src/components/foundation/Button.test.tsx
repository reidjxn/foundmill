import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

describe("Button", () => {
  it("renders a type=button with the label and variant", () => {
    render(<Button variant="primary">Continue</Button>);
    const b = screen.getByRole("button", { name: "Continue" });
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("data-variant")).toBe("primary");
    expect(b.className).toContain("bg-kit-primary");
  });
  it("fires onClick from the keyboard", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    b.focus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it("is disabled and busy while loading", () => {
    render(
      <Button loading icon={Plus}>
        Working
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Working" });
    expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.querySelector("svg.animate-spin")).not.toBeNull();
  });
  it("renders a leading icon decoratively", () => {
    render(<Button icon={Plus}>Add</Button>);
    const svg = screen.getByRole("button", { name: "Add" }).querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("width")).toBe("16");
  });
  it("uses 14 px icons at size sm", () => {
    render(
      <Button size="sm" icon={Plus}>
        Add
      </Button>,
    );
    expect(screen.getByRole("button").querySelector("svg")?.getAttribute("width")).toBe("14");
  });
  it("sizes map to the 28/32 px tokens", () => {
    const { rerender } = render(<Button size="sm">A</Button>);
    expect(screen.getByRole("button").className).toContain("h-control-sm");
    rerender(<Button size="md">A</Button>);
    expect(screen.getByRole("button").className).toContain("h-control-md");
  });
});

describe("IconButton", () => {
  it("always has an accessible name", () => {
    render(<IconButton icon={Plus} label="Add agent" tooltip={false} />);
    expect(screen.getByRole("button", { name: "Add agent" })).toBeTruthy();
  });
  it("exposes pressed state", () => {
    render(<IconButton icon={Plus} label="Pin" pressed tooltip={false} />);
    expect(screen.getByRole("button", { name: "Pin" }).getAttribute("aria-pressed")).toBe("true");
  });
});
