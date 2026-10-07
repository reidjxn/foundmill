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

  describe("asChild", () => {
    it("renders the child element as the button when no icon is given", () => {
      render(
        <Button asChild variant="primary">
          <a href="/b/1/home">Go home</a>
        </Button>,
      );
      const a = screen.getByRole("link", { name: "Go home" });
      expect(a.tagName).toBe("A");
      expect(a.getAttribute("href")).toBe("/b/1/home");
      expect(a.className).toContain("bg-kit-primary");
      expect(a.getAttribute("type")).toBeNull();
      expect(a.getAttribute("data-variant")).toBe("primary");
    });
    it("keeps leading and trailing icons inside the child element", () => {
      render(
        <Button asChild icon={Plus} iconRight={Plus}>
          <a href="/x">Both</a>
        </Button>,
      );
      const a = screen.getByRole("link", { name: "Both" });
      expect(a.querySelectorAll("svg")).toHaveLength(2);
      expect(a.firstElementChild?.tagName.toLowerCase()).toBe("svg");
      expect(a.lastElementChild?.tagName.toLowerCase()).toBe("svg");
    });
    it("renders only the leading or only the trailing icon", () => {
      const { rerender } = render(
        <Button asChild icon={Plus}>
          <a href="/x">Lead</a>
        </Button>,
      );
      expect(screen.getByRole("link", { name: "Lead" }).querySelectorAll("svg")).toHaveLength(1);
      rerender(
        <Button asChild iconRight={Plus}>
          <a href="/x">Trail</a>
        </Button>,
      );
      expect(screen.getByRole("link", { name: "Trail" }).querySelectorAll("svg")).toHaveLength(1);
    });
    it("shows the spinner and aria-busy while loading", () => {
      render(
        <Button asChild loading>
          <a href="/x">Busy</a>
        </Button>,
      );
      const a = screen.getByRole("link", { name: "Busy" });
      expect(a.getAttribute("aria-busy")).toBe("true");
      expect(a.querySelector("svg.animate-spin")).not.toBeNull();
    });
    it("merges the child's own onClick with the button's", async () => {
      const outer = vi.fn();
      const inner = vi.fn((e: React.MouseEvent) => e.preventDefault());
      render(
        <Button asChild onClick={outer}>
          <a href="/x" onClick={inner}>
            Click
          </a>
        </Button>,
      );
      await userEvent.click(screen.getByRole("link", { name: "Click" }));
      expect(outer).toHaveBeenCalledTimes(1);
      expect(inner).toHaveBeenCalledTimes(1);
    });
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
