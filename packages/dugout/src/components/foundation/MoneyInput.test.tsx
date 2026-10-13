import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoneyInput, rawCaret } from "./MoneyInput";

function Controlled({ initial = "60000", onRaw }: { initial?: string; onRaw?: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <MoneyInput
      aria-label="Budget"
      currency="GBP"
      value={v}
      onChange={(e) => {
        setV(e.target.value);
        onRaw?.(e.target.value);
      }}
    />
  );
}

describe("MoneyInput", () => {
  it("lays out [symbol] [amount] | CODE in the flow: the symbol from the currency, the code as its own segment", () => {
    render(<Controlled />);
    const el = screen.getByRole("textbox", { name: "Budget" });
    const field = el.parentElement!;
    expect(field.querySelector("[data-input-prefix]")?.textContent).toBe("£");
    const code = screen.getByText("GBP");
    expect(code.className).toContain("field-affix");
    expect(field.className).toContain("h-field-lg");
    expect(el.className).toContain("text-money");
    expect(el.getAttribute("inputmode")).toBe("decimal");
  });

  it("groups the amount at rest and shows exactly what was typed while focused", async () => {
    render(<Controlled />);
    const el = screen.getByRole("textbox", { name: "Budget" }) as HTMLInputElement;
    expect(el.value).toBe("60,000");
    el.focus();
    fireEvent.focus(el);
    expect(el.value).toBe("60000");
    fireEvent.blur(el);
    expect(el.value).toBe("60,000");
  });

  it("hands the caller the raw text, so shorthand parsers keep working, and expands it at rest", async () => {
    const onRaw = vi.fn();
    render(<Controlled initial="" onRaw={onRaw} />);
    const el = screen.getByRole("textbox", { name: "Budget" }) as HTMLInputElement;
    await userEvent.click(el);
    await userEvent.keyboard("25k");
    expect(onRaw).toHaveBeenLastCalledWith("25k");
    expect(el.value).toBe("25k");
    await userEvent.tab();
    expect(el.value).toBe("25,000");
  });

  it("selects the amount when focus arrives from the keyboard, so typing replaces it (a click keeps its caret)", async () => {
    const onRaw = vi.fn();
    render(<Controlled initial="60000" onRaw={onRaw} />);
    const el = screen.getByRole("textbox", { name: "Budget" }) as HTMLInputElement;
    await userEvent.tab();
    expect(document.activeElement).toBe(el);
    expect(el.value).toBe("60000");
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 5]);
    await userEvent.keyboard("75000");
    expect(onRaw).toHaveBeenLastCalledWith("75000");
    await userEvent.tab();
    expect(el.value).toBe("75,000");
  });

  it("maps a caret in the grouped text to the same place in the raw text", () => {
    expect(rawCaret("12,000", "12000", 3)).toBe(2); // just after the comma: between 2 and 0
    expect(rawCaret("12,000", "12000", 2)).toBe(2);
    expect(rawCaret("1,205,001", "1205001", 2)).toBe(1);
    expect(rawCaret("1,205,001", "1205001", 6)).toBe(4);
    expect(rawCaret("60,000.50", "60000.50", 8)).toBe(7);
    expect(rawCaret("12,000", "12,000", 3)).toBe(3); // typed with its comma: the comma is still there
    expect(rawCaret("12.000", "12000", 3, "de-DE")).toBe(2);
    // A shorthand is not the same text grouped: the caret goes to the end.
    expect(rawCaret("25,000", "25k", 4)).toBe(3);
  });

  it("a click keeps its caret beside the digit under the pointer when the grouping goes (GTM-33)", async () => {
    const onRaw = vi.fn();
    const user = userEvent.setup();
    render(<Controlled initial="12000" onRaw={onRaw} />);
    const el = screen.getByRole("textbox", { name: "Budget" }) as HTMLInputElement;
    expect(el.value).toBe("12,000");
    // Click just after the comma, then type 5: the digit lands there, giving 125,000 (not 120,500).
    await user.pointer({ keys: "[MouseLeft]", target: el, offset: 3 });
    await waitFor(() => expect(el.value).toBe("12000"));
    expect([el.selectionStart, el.selectionEnd]).toEqual([2, 2]);
    await user.keyboard("5");
    expect(onRaw).toHaveBeenLastCalledWith("125000");
    await user.tab();
    expect(el.value).toBe("125,000");
  });

  it("leaves text it cannot read as a number alone", () => {
    render(<MoneyInput aria-label="Budget" value="about 5k" onChange={() => {}} currency="EUR" />);
    expect((screen.getByRole("textbox", { name: "Budget" }) as HTMLInputElement).value).toBe("about 5k");
  });

  it("works uncontrolled, and drops the symbol on request or when the locale has none", async () => {
    const { rerender } = render(<MoneyInput aria-label="Cap" defaultValue="1250000000" currency="usd" symbol={false} controlSize="md" />);
    const el = screen.getByRole("textbox", { name: "Cap" }) as HTMLInputElement;
    expect(el.value).toBe("1,250,000,000");
    expect(el.parentElement!.querySelector("[data-input-prefix]")).toBeNull();
    expect(screen.getByText("USD")).toBeTruthy();
    expect(el.parentElement!.className).toContain("h-control-md");
    rerender(<MoneyInput aria-label="Cap" defaultValue="10" currency="CHF" controlSize="md" />);
    expect(screen.getByText("CHF")).toBeTruthy();
    expect(el.parentElement!.querySelector("[data-input-prefix]")).toBeNull();
  });
});
