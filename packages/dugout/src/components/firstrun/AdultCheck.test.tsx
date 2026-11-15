import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ADULT_CHECK_LABEL, AdultCheck } from "./AdultCheck";

function Controlled({ onChange }: { onChange: (v: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <AdultCheck
      checked={checked}
      onCheckedChange={(v) => {
        setChecked(v);
        onChange(v);
      }}
      hint="You confirm this once."
    />
  );
}

describe("AdultCheck", () => {
  it("names the age, and the label toggles the box", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: ADULT_CHECK_LABEL });
    expect(ADULT_CHECK_LABEL).toBe("I am 18 or older");
    expect(box.getAttribute("aria-checked")).toBe("false");
    await user.click(screen.getByText(ADULT_CHECK_LABEL));
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(box.getAttribute("aria-checked")).toBe("true");
    await user.click(box);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("describes the box with its hint, and announces an error", () => {
    render(<AdultCheck checked={false} onCheckedChange={() => undefined} hint="You confirm this once." error="Tick the box to continue." id="age" />);
    const box = screen.getByRole("checkbox", { name: ADULT_CHECK_LABEL });
    expect(box.getAttribute("aria-describedby")).toBe("age-hint age-error");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Tick the box to continue.");
  });

  it("can be disabled while the confirmation is on its way", () => {
    render(<AdultCheck checked onCheckedChange={() => undefined} disabled />);
    expect((screen.getByRole("checkbox", { name: ADULT_CHECK_LABEL }) as HTMLButtonElement).disabled).toBe(true);
  });
});
