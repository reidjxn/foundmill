// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { applyLogoProgress, LogoPicker, type GeneratedLogoSet, type LogoActions, type LogoPickerProps, type LogoProgress } from "../LogoPicker";
import { readLogoStream, type LogoStreamEvent } from "../logo-stream";

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

  it("makes Generate logos the main action: the generate control, before Upload", () => {
    setup();
    const generate = screen.getByTestId("logo-generate");
    expect(generate.getAttribute("data-variant")).toBe("generate");
    expect(generate.getAttribute("data-size")).toBe("lg");
    expect(generate.textContent).toContain("Generate logos");
    // It comes before Upload, which stays a secondary action.
    const buttons = [...screen.getByTestId("logo-picker").querySelectorAll("button")].map((b) => b.getAttribute("data-testid"));
    expect(buttons.indexOf("logo-generate")).toBeLessThan(buttons.indexOf("logo-upload"));
    expect(screen.getByTestId("logo-upload").getAttribute("data-variant")).toBe("default");
  });

  it("shows each mark the moment it arrives, labels the slots still drawing, and lets the founder pick early", async () => {
    let progress: ((p: LogoProgress) => void) | undefined;
    let finish: ((set: GeneratedLogoSet) => void) | undefined;
    const generate = vi.fn((_round: number, onProgress?: (p: LogoProgress) => void) => {
      progress = onProgress;
      return new Promise<GeneratedLogoSet>((resolve) => {
        finish = resolve;
      });
    });
    const props = setup({}, { generate });
    await act(async () => {
      fireEvent.click(screen.getByTestId("logo-generate"));
    });
    // Before anything arrives: four labelled slots, all drawing.
    expect(screen.getAllByTestId("logo-slot").map((s) => s.textContent)).toEqual(["Monogram", "Geometric", "Negative space", "Abstract"]);
    expect(screen.getByTestId("logo-drafting").textContent).toMatch(/drawing four marks at once/);
    expect(screen.queryByTestId("logo-cost")).toBeNull();
    await act(async () => {
      progress!({ type: "started", slots: [{ index: 0, label: "Monogram" }, { index: 1, label: "Geometric" }, { index: 2, label: "Negative space" }, { index: 3, label: "Abstract" }] });
      progress!({ type: "option", index: 2, option: SET.options[0]! });
    });
    expect(screen.getAllByTestId("logo-option")).toHaveLength(1);
    expect(screen.getAllByTestId("logo-slot")).toHaveLength(3);
    expect(screen.getByTestId("logo-drafting").textContent).toBe("1 of 4 ready. Pick one now or wait for the rest.");
    // The first mark can be chosen while the others are drawn.
    await act(async () => {
      fireEvent.click(screen.getByTestId("logo-option"));
    });
    expect(props.onChange).toHaveBeenCalledWith({ source: "generated", dataUrl: SET.options[0]!.dataUrl, colours: SET.options[0]!.colours, label: "Orbit" });
    await act(async () => {
      progress!({ type: "failed", index: 0, message: "Not usable" });
    });
    expect(screen.getAllByTestId("logo-slot").find((s) => s.getAttribute("data-state") === "failed")?.textContent).toMatch(/Not usable/);
    await act(async () => {
      finish!(SET);
    });
    expect(screen.getAllByTestId("logo-option")).toHaveLength(2);
    expect(screen.queryByTestId("logo-slot")).toBeNull();
    expect(screen.getByTestId("logo-cost")).toBeTruthy();
  });

  it("folds progress into slots, and reads a streamed set", async () => {
    const started = applyLogoProgress([], { type: "started", slots: [{ index: 0, label: "Monogram" }, { index: 1, label: "Geometric" }] });
    expect(started.map((s) => [s.label, s.option, s.failed])).toEqual([["Monogram", null, false], ["Geometric", null, false]]);
    const got = applyLogoProgress(started, { type: "option", index: 1, option: SET.options[1]! });
    expect(got[1]!.option?.id).toBe("o2");
    // A late failure never hides a mark that arrived.
    expect(applyLogoProgress(got, { type: "failed", index: 1, message: "x" })[1]!.failed).toBe(false);

    async function* events(list: LogoStreamEvent[]) {
      for (const e of list) yield e;
    }
    const seen: LogoProgress[] = [];
    const set = await readLogoStream(events([{ type: "started", total: 1, slots: [{ index: 0, direction: "monogram", label: "Monogram" }], mode: "mock" }, { type: "option", index: 0, option: SET.options[0]! }, { type: "done", set: SET }]), (p) => seen.push(p));
    expect(set).toBe(SET);
    expect(seen.map((p) => p.type)).toEqual(["started", "option"]);
    await expect(readLogoStream(events([{ type: "started", total: 1, slots: [], mode: "mock" }]))).rejects.toThrow(/stopped before the set was finished/);
  });

  it("while a set is drawn the control shows the real count with Stop beside it; Stop keeps the marks already drawn", async () => {
    let progress: ((p: LogoProgress) => void) | undefined;
    let signal: AbortSignal | undefined;
    const generate = vi.fn((_round: number, onProgress?: (p: LogoProgress) => void, sig?: AbortSignal) => {
      progress = onProgress;
      signal = sig;
      return new Promise<GeneratedLogoSet>(() => undefined);
    });
    setup({}, { generate });
    await act(async () => {
      fireEvent.click(screen.getByTestId("logo-generate"));
    });
    const control = screen.getByTestId("logo-generate");
    expect(control.getAttribute("data-running")).not.toBeNull();
    expect(control.textContent).toContain("Drawing logos");
    expect(control.textContent).toContain("0 of 4");
    await act(async () => {
      progress!({ type: "option", index: 1, option: SET.options[1]! });
    });
    expect(screen.getByTestId("logo-generate").textContent).toContain("1 of 4");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });
    expect(signal?.aborted).toBe(true);
    expect(screen.getAllByTestId("logo-option")).toHaveLength(1);
    expect(screen.queryByTestId("logo-slot")).toBeNull();
    expect(screen.getByText("Stopped. The mark already drawn stays here.")).toBeTruthy();
    expect(screen.getByTestId("logo-generate").textContent).toContain("Generate again");
  });

  it("disables every control while a choice is being saved", () => {
    setup({ saving: true, value: { source: "upload", dataUrl: mark("#000000"), colours: [], label: "logo.png" } });
    for (const id of ["logo-upload", "logo-generate", "logo-clear"]) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
  });
});
