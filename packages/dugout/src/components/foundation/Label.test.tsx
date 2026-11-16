import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { Field } from "./Label";
import { Input } from "./Input";

describe("Field help", () => {
  it("puts an InfoTip beside the label, outside the <label>, named for the field", () => {
    render(
      <Field htmlFor="biz" label="Business name" help="The name customers see; you can rename it later.">
        <Input id="biz" />
      </Field>,
    );
    const tip = screen.getByRole("button", { name: "About Business name" });
    expect(tip.closest("label")).toBeNull();
    const label = screen.getByText("Business name");
    expect(label.tagName).toBe("LABEL");
    expect(label.parentElement?.contains(tip)).toBe(true);
    expect(screen.getByLabelText("Business name")).toBe(screen.getByRole("textbox"));
  });

  it("keeps the hint under the control and drops the tip when guidance is off", () => {
    render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <Field htmlFor="biz" label="Business name" hint="Shown on invoices." help="Why we ask.">
          <Input id="biz" />
        </Field>
      </GuidanceProvider>,
    );
    expect(screen.queryByRole("button", { name: "About Business name" })).toBeNull();
    expect(screen.getByText("Shown on invoices.").id).toBe("biz-hint");
    expect(screen.getByRole("textbox").getAttribute("aria-describedby")).toBe("biz-hint");
  });
});

describe("Field hint and error (WP-10 T5)", () => {
  it("an invalid field keeps its hint", () => {
    render(
      <Field htmlFor="cap" label="Spend line" hint="Per action, before it asks you" error="Enter an amount">
        <Input id="cap" />
      </Field>,
    );
    expect(document.getElementById("cap-hint")?.textContent).toBe("Per action, before it asks you");
    expect(document.getElementById("cap-error")?.textContent).toContain("Enter an amount");
    expect(screen.getByRole("textbox", { name: "Spend line" }).getAttribute("aria-describedby")).toBe("cap-hint cap-error");
  });
});
