import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Search, X } from "lucide-react";
import { Input } from "./Input";
import { IconButton } from "./IconButton";

describe("Input", () => {
  it("draws the field on the wrapper at the md height, with a borderless input inside", () => {
    render(<Input aria-label="Business name" />);
    const el = screen.getByRole("textbox", { name: "Business name" });
    const field = el.parentElement!;
    expect(field.hasAttribute("data-input-wrapper")).toBe(true);
    expect(field.className).toContain("h-control-md");
    // The well (black at 30 %, a strong hairline ring, an inset shadow) with its focus-within light (controls.css).
    expect(field.className).toContain("field-well");
    expect(el.className).toContain("flex-1");
    expect(el.className).toContain("border-0");
  });

  it("lays the icon, prefix, suffix and trailing slot out in the flow, so they never overlap the value", () => {
    render(<Input aria-label="Budget" icon={Search} prefix="£" suffix="GBP" trailing={<span>⌘K</span>} numeric defaultValue="60000" />);
    const el = screen.getByRole("textbox", { name: "Budget" });
    const field = el.parentElement!;
    expect(field.querySelector("svg")).not.toBeNull();
    const parts = Array.from(field.children).map((c) => c.getAttribute("data-input-prefix") !== null ? "prefix" : c.getAttribute("data-input-suffix") !== null ? "suffix" : c.tagName.toLowerCase());
    expect(parts).toEqual(["span", "prefix", "input", "suffix", "span"]);
    for (const child of Array.from(field.children)) expect(child.className).not.toContain("absolute");
    expect(screen.getByText("GBP").className).toContain("shrink-0");
    expect(screen.getByText("⌘K")).toBeTruthy();
  });

  it("offers form heights: lg 36 and xl 46 (with the 8 px radius)", () => {
    const { rerender } = render(<Input aria-label="Name" controlSize="lg" />);
    const field = () => screen.getByRole("textbox", { name: "Name" }).parentElement!;
    expect(field().className).toContain("h-field");
    expect(field().getAttribute("data-size")).toBe("lg");
    rerender(<Input aria-label="Name" controlSize="xl" />);
    expect(field().className).toContain("h-field-lg");
    expect(field().className).toContain("rounded-track");
  });

  it("draws a suffix as its own segment behind a hairline when asked, and announces it with the value", () => {
    render(<Input aria-label="Spend cap" suffix="GBP" suffixVariant="segment" aria-describedby="hint" />);
    const el = screen.getByRole("textbox", { name: "Spend cap" });
    const suffix = screen.getByText("GBP");
    expect(suffix.className).toContain("field-affix");
    expect(el.getAttribute("aria-describedby")).toBe(`hint ${suffix.id}`);
  });

  it("puts the warning tone on the field; invalid wins over it", () => {
    const { rerender } = render(<Input aria-label="Instruction" tone="warn" />);
    const field = () => screen.getByRole("textbox", { name: "Instruction" }).parentElement!;
    expect(field().getAttribute("data-tone")).toBe("warn");
    rerender(<Input aria-label="Instruction" tone="warn" invalid />);
    expect(field().hasAttribute("data-tone")).toBe(false);
    expect(field().hasAttribute("data-invalid")).toBe(true);
  });

  it("marks invalid state through aria-invalid and on the field", () => {
    render(<Input aria-label="Amount" invalid />);
    const el = screen.getByRole("textbox", { name: "Amount" });
    expect(el.getAttribute("aria-invalid")).toBe("true");
    expect(el.parentElement?.hasAttribute("data-invalid")).toBe(true);
  });

  it("keeps the same input element and focus when a trailing clear button appears (wave-2 web issue)", async () => {
    const user = userEvent.setup();
    function Field() {
      const [value, setValue] = useState("");
      return <Input aria-label="Tags" value={value} onChange={(e) => setValue(e.target.value)} trailing={value ? <IconButton size="sm" icon={X} label="Clear" tooltip={false} onClick={() => setValue("")} /> : undefined} />;
    }
    render(<Field />);
    const before = screen.getByRole("textbox", { name: "Tags" });
    before.focus();
    await user.keyboard("ab");
    const after = screen.getByRole("textbox", { name: "Tags" });
    expect(after).toBe(before);
    expect(document.activeElement).toBe(after);
    expect((after as HTMLInputElement).value).toBe("ab");
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("textbox", { name: "Tags" })).toBe(before);
    expect((before as HTMLInputElement).value).toBe("");
  });
});
