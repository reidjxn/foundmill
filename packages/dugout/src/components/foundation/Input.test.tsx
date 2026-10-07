import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Search, X } from "lucide-react";
import { Input } from "./Input";
import { IconButton } from "./IconButton";

describe("Input", () => {
  it("renders a plain input with the md height and padding tokens", () => {
    render(<Input aria-label="Business name" />);
    const el = screen.getByRole("textbox", { name: "Business name" });
    expect(el.className).toContain("h-control-md");
    expect(el.className).toContain("pl-2");
    expect(el.className).toContain("pr-2");
  });

  it("pads for a leading icon and a trailing slot", () => {
    render(<Input aria-label="Search" icon={Search} trailing={<span>⌘K</span>} />);
    const el = screen.getByRole("textbox", { name: "Search" });
    expect(el.className).toContain("pl-7");
    expect(el.className).toContain("pr-8");
    expect(el.parentElement?.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("⌘K")).toBeTruthy();
  });

  it("marks invalid state through aria-invalid", () => {
    render(<Input aria-label="Amount" invalid />);
    expect(screen.getByRole("textbox", { name: "Amount" }).getAttribute("aria-invalid")).toBe("true");
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
