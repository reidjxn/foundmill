// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { LogoPicker, type LogoActions, type LogoPickerProps } from "../LogoPicker";

const mark = (fill: string) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512"><rect width="100" height="100" fill="${fill}"/></svg>`)}`;
const SET = {
  options: [
    { id: "o1", name: "Orbit", concept: "A ring.", dataUrl: mark("#1f6f5f"), colours: ["#1f6f5f", "#e8c56b"] },
    { id: "o2", name: "Stack", concept: "Bars.", dataUrl: mark("#2b6cb0"), colours: ["#2b6cb0"] },
  ],
  cost: { amountMinor: 0.4, currency: "USD", label: "Estimate" as const },
  remaining: 1,
  mode: "mock" as const,
};

function setup(over: Partial<LogoPickerProps> = {}, actions: Partial<LogoActions> = {}) {
  const props: LogoPickerProps = {
    name: "Ledgerly",
    kit: { primary: "#1f6f5f", secondary: "#e8c56b" },
    value: null,
    onChange: vi.fn(),
    onUseColours: vi.fn(),
    actions: { prepare: vi.fn(async (d: string) => ({ dataUrl: d, colours: [] })), generate: vi.fn(async () => SET), ...actions },
    ...over,
  };
  render(
    <TooltipProvider>
      <LogoPicker {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe("LogoPicker", () => {
  it("shows the initials mark and the upload rules when there is no logo", () => {
    setup();
    expect(screen.getByTestId("logo-picker").getAttribute("data-logo-source")).toBe("initials");
    expect(screen.getByTestId("logo-preview").querySelector("text")?.textContent).toBe("LE");
    expect(screen.getByTestId("logo-picker").textContent).toMatch(/PNG, JPEG, WebP or SVG up to 2 MB/);
    expect(screen.queryByTestId("logo-clear")).toBeNull();
    expect((screen.getByTestId("logo-file") as HTMLInputElement).accept).toBe("image/png,image/jpeg,image/webp,image/svg+xml,.svg");
  });

  it("labels the cost of a set as an Estimate, counts what is left, and hides the suggestion when the colours already match", async () => {
    const props = setup({ value: { source: "generated", dataUrl: SET.options[0]!.dataUrl, colours: SET.options[0]!.colours, label: "Orbit" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("logo-generate"));
    });
    expect(screen.getByTestId("logo-cost").textContent).toBe("This set: under US$0.01");
    expect(screen.getByTestId("logo-options").textContent).toMatch(/Estimate/);
    expect(screen.getByTestId("logo-options").textContent).toMatch(/1 more set this hour/);
    expect(screen.getAllByTestId("logo-option")[0]!.getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(screen.queryByTestId("logo-colour-suggestion")).toBeNull());
    expect(props.onUseColours).not.toHaveBeenCalled();
  });

  it("reports a generation failure (rate limit) without losing the current logo", async () => {
    const value = { source: "upload" as const, dataUrl: mark("#000000"), colours: [], label: "logo.png" };
    setup({ value }, { generate: vi.fn(async () => Promise.reject(new Error("Logo generation limit reached. Try again in 42 minutes."))) });
    await act(async () => {
      fireEvent.click(screen.getByTestId("logo-generate"));
    });
    expect(screen.getByTestId("logo-error").textContent).toBe("Logo generation limit reached. Try again in 42 minutes.");
    expect(screen.getByTestId("logo-preview").querySelector("img")?.getAttribute("src")).toBe(value.dataUrl);
  });

  it("goes back to the initials mark, and a failed save says why", async () => {
    const onChange = vi.fn(async () => Promise.reject(new Error("Your role (member) cannot perform administration")));
    setup({ value: { source: "upload", dataUrl: mark("#000000"), colours: [], label: "logo.png" }, onChange });
    await act(async () => {
      fireEvent.click(screen.getByTestId("logo-clear"));
    });
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.getByTestId("logo-error").textContent).toMatch(/cannot perform administration/);
  });

  it("disables every control while a choice is being saved", () => {
    setup({ saving: true, value: { source: "upload", dataUrl: mark("#000000"), colours: [], label: "logo.png" } });
    for (const id of ["logo-upload", "logo-generate", "logo-clear"]) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
  });
});
