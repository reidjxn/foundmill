import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
import { Button, GenerateControl } from "./Button";
import { IconButton } from "./IconButton";

describe("Button", () => {
  it("renders a type=button with the label and variant", () => {
    render(<Button variant="primary">Continue</Button>);
    const b = screen.getByRole("button", { name: "Continue" });
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("data-variant")).toBe("primary");
    // The brand gradient with its glow (controls.css btn-primary) and the computed text colour.
    expect(b.className).toContain("btn-primary");
    expect(b.className).toContain("text-kit-on-primary");
  });
  it("is sentence case Inter 500 with a tactile press: no uppercase, no tracking, pressable", () => {
    render(<Button>Save and continue</Button>);
    const b = screen.getByRole("button", { name: "Save and continue" });
    expect(b.className).not.toMatch(/\buppercase\b|tracking-/);
    expect(b.className).toContain("font-body");
    expect(b.className).toContain("font-medium");
    expect(b.className).toContain("pressable");
    expect(b.className).toContain("btn-secondary");
  });
  it.each([
    ["ghost", "btn-ghost"],
    ["danger", "btn-danger"],
    ["gold", "btn-gold"],
    ["tinted", "btn-tinted"],
    ["secondary", "btn-secondary"],
  ] as const)("variant %s draws %s", (variant, cls) => {
    render(<Button variant={variant}>V</Button>);
    expect(screen.getByRole("button").className).toContain(cls);
  });
  it("lets a caller's border colour still apply (the variants keep a transparent 1 px border)", () => {
    render(<Button className="border-gold/40">Edge</Button>);
    expect(screen.getByRole("button").className).toContain("border-gold/40");
  });
  it("shows an active toggle with a tinted ring in its context colour", () => {
    render(
      <Button active tone="warn">
        Ask Juno
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Ask Juno" });
    expect(b.hasAttribute("data-active")).toBe(true);
    expect(b.className).toContain("tone-status-warn");
  });
  it("fires onClick from the keyboard", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    b.focus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it("is busy and refuses clicks while loading, but keeps focus (WCAG 2.4.3)", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button icon={Plus} onClick={onClick}>
        Working
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Working" });
    b.focus();
    // Turning busy under the keyboard: a `disabled` button would drop focus to <body>.
    rerender(
      <Button loading icon={Plus} onClick={onClick}>
        Working
      </Button>,
    );
    expect((b as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(b);
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.querySelector("svg.animate-spin")).not.toBeNull();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(b, { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not submit its form while loading", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="Name" />
        <Button type="submit" loading>
          Save
        </Button>
      </form>,
    );
    screen.getByRole("textbox", { name: "Name" }).focus();
    await userEvent.keyboard("{Enter}");
    screen.getByRole("button", { name: "Save" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
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
  it("sizes map to the 28/32/40/48 px tokens and the px padding tokens", () => {
    const { rerender } = render(<Button size="sm">A</Button>);
    expect(screen.getByRole("button").className).toContain("h-control-sm");
    expect(screen.getByRole("button").className).toContain("px-btn-sm");
    rerender(<Button size="md">A</Button>);
    expect(screen.getByRole("button").className).toContain("h-control-md");
    rerender(<Button size="lg">A</Button>);
    expect(screen.getByRole("button").className).toContain("h-control-lg");
    rerender(<Button size="xl">A</Button>);
    expect(screen.getByRole("button").className).toContain("h-control-xl");
  });

  describe("two-line options", () => {
    it("carries a consequence line under the label and grows instead of clipping", () => {
      render(
        <Button icon={Plus} description="Stock-out risk in Nov">
          Hold a week
        </Button>,
      );
      const b = screen.getByRole("button", { name: /Hold a week/ });
      expect(b.className).toContain("h-auto");
      expect(b.className).toContain("min-h-control-lg");
      expect(b.className).toContain("whitespace-normal");
      expect(screen.getByText("Stock-out risk in Nov").className).toContain("btn-desc");
    });
    it("renders an inline caps tag", () => {
      render(
        <Button variant="primary" tag="Recommended" description="£18,600 deposit today">
          Approve
        </Button>,
      );
      expect(screen.getByText("Recommended").className).toContain("btn-tag");
    });
    it("lets a long label wrap to two lines with lines={2}", () => {
      render(<Button lines={2}>Order two SKUs now, the serum after its stability review</Button>);
      const b = screen.getByRole("button");
      expect(b.className).toContain("whitespace-normal");
      expect(b.className).toContain("min-h-control-md");
    });
  });

  describe("fit", () => {
    it("wraps the label in FitText and lets the button shrink below its label", () => {
      render(
        <Button fit icon={Plus}>
          Settings · Departments
        </Button>,
      );
      const b = screen.getByRole("button", { name: "Settings · Departments" });
      expect(b.className).toContain("min-w-0");
      expect(b.querySelector("[data-fit-box]")).not.toBeNull();
      expect(b.getAttribute("data-fit")).toBe("fits");
    });
  });

  describe("generate", () => {
    it("at rest: the light slab, the brand core tile with the Fan glyph, the sheen, the key hint", () => {
      render(
        <Button variant="generate" size="xl" kbd="⌘↵">
          Draft 12 concepts
        </Button>,
      );
      const b = screen.getByRole("button", { name: /Draft 12 concepts/ });
      expect(b.getAttribute("data-variant")).toBe("generate");
      expect(b.className).toContain("gen-slab");
      expect(b.className).toContain("sheen");
      expect(b.className).toContain("rounded-gen");
      const core = b.querySelector("[data-gen-core]") as HTMLElement;
      expect(core.className).toContain("size-gen-core");
      expect(core.querySelector("svg")?.getAttribute("class")).toContain("lucide-fan");
      expect(b.querySelector("kbd")?.textContent).toBe("⌘↵");
      expect(b.hasAttribute("data-running")).toBe(false);
    });
    it("running: a dark slab with an orbiting edge, the fan turning, real progress and the count; clicks are ignored", async () => {
      const onClick = vi.fn();
      render(
        <Button variant="generate" running progress={0.25} count="3 of 12" kbd="⌘↵" onClick={onClick}>
          Drafting concepts
        </Button>,
      );
      const b = screen.getByRole("button", { name: /Drafting concepts/ });
      expect(b.hasAttribute("data-running")).toBe(true);
      expect(b.getAttribute("aria-busy")).toBe("true");
      expect(b.className).toContain("orbit");
      expect(b.className).not.toContain("sheen");
      expect(b.style.getPropertyValue("--gen-progress")).toBe("0.25");
      expect(b.querySelector(".gen-fill")).not.toBeNull();
      expect(b.querySelector(".gen-rail")).not.toBeNull();
      expect(b.querySelector("[data-gen-core] svg")?.getAttribute("class")).toContain("animate-fan");
      expect(screen.getByText("3 of 12").className).toContain("gen-count");
      expect(b.querySelector("kbd")).toBeNull();
      expect((b as HTMLButtonElement).disabled).toBe(false);
      await userEvent.click(b);
      expect(onClick).not.toHaveBeenCalled();
    });
    it("running without a known progress: an indeterminate rail, never a fake fill", () => {
      render(
        <Button variant="generate" running>
          Drafting
        </Button>,
      );
      const b = screen.getByRole("button");
      expect(b.hasAttribute("data-indeterminate")).toBe(true);
      expect(b.style.getPropertyValue("--gen-progress")).toBe("");
    });
    it("GenerateControl pairs it with Stop while running", async () => {
      const onGenerate = vi.fn();
      const onStop = vi.fn();
      const { rerender } = render(<GenerateControl label="Draft 12 concepts" runningLabel="Drafting concepts" onGenerate={onGenerate} onStop={onStop} />);
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: /Draft 12 concepts/ }));
      expect(onGenerate).toHaveBeenCalledTimes(1);
      rerender(<GenerateControl label="Draft 12 concepts" runningLabel="Drafting concepts" running progress={0.5} count="6 of 12" onGenerate={onGenerate} onStop={onStop} />);
      expect(screen.getByRole("button", { name: /Drafting concepts/ }).hasAttribute("data-running")).toBe(true);
      await userEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("Drafting concepts, 6 of 12");
    });
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
      expect(a.className).toContain("btn-primary");
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
  it("exposes pressed state and draws it as an active toggle", () => {
    render(<IconButton icon={Plus} label="Pin" pressed tooltip={false} />);
    const b = screen.getByRole("button", { name: "Pin" });
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(b.hasAttribute("data-active")).toBe(true);
  });
  it("is square at every size", () => {
    const { rerender } = render(<IconButton icon={Plus} label="Add" size="sm" tooltip={false} />);
    expect(screen.getByRole("button").className).toContain("w-control-sm");
    rerender(<IconButton icon={Plus} label="Add" size="xl" tooltip={false} />);
    expect(screen.getByRole("button").className).toContain("w-control-xl");
  });
});
