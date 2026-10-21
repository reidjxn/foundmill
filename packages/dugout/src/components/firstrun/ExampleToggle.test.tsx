import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { EXAMPLE_TAG, ExampleFrame, ExampleToggle, exampleFrameClass } from "./ExampleToggle";

describe("ExampleToggle", () => {
  it("shows the example in a dashed frame tagged Example, then hides it again", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ExampleToggle example={<p>A skincare brand for sensitive skin, sold online.</p>} onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: "Show me an example" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-example]")).toBeNull();
    await user.click(button);
    expect(onToggle).toHaveBeenLastCalledWith(true);
    const frame = document.querySelector("[data-example]") as HTMLElement;
    expect(frame.className).toContain("border-dashed");
    expect(frame.querySelector("[data-chip]")?.textContent).toBe(EXAMPLE_TAG);
    expect(frame.textContent).toContain("A skincare brand for sensitive skin, sold online.");
    const hide = screen.getByRole("button", { name: "Hide the example" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    await user.click(hide);
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(document.querySelector("[data-example]")).toBeNull();
  });

  it("hands the state to a render-prop child", async () => {
    render(<ExampleToggle>{(shown) => <output>{shown ? "example values" : "your values"}</output>}</ExampleToggle>);
    expect(screen.getByRole("status").textContent).toBe("your values");
    await userEvent.click(screen.getByRole("button", { name: "Show me an example" }));
    expect(screen.getByRole("status").textContent).toBe("example values");
  });

  it("can be controlled", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<ExampleToggle shown={false} onToggle={onToggle} example="x" />);
    await userEvent.click(screen.getByRole("button", { name: "Show me an example" }));
    expect(onToggle).toHaveBeenCalledWith(true);
    // Still hidden until the owner says so.
    expect(document.querySelector("[data-example]")).toBeNull();
    rerender(<ExampleToggle shown onToggle={onToggle} example="x" />);
    expect(document.querySelector("[data-example]")).toBeTruthy();
  });

  it("tells a form to fill on the way in and to clear on the way out (onFill / onClear), with its own labels", async () => {
    const user = userEvent.setup();
    const onFill = vi.fn();
    const onClear = vi.fn();
    render(<ExampleToggle onFill={onFill} onClear={onClear} showLabel="Show me an example founder" hideLabel="Hide the example founder" data-testid="profile-example" />);
    expect(screen.getByTestId("profile-example").hasAttribute("data-example-toggle")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Show me an example founder" }));
    expect(onFill).toHaveBeenCalledTimes(1);
    expect(onFill).toHaveBeenCalledWith();
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByTestId("profile-example").getAttribute("data-shown")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Hide the example founder" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onFill).toHaveBeenCalledTimes(1);
  });

  it("a group of examples: a chip fills with its id, the chosen chip again clears, and the group is controllable", async () => {
    const user = userEvent.setup();
    const onFill = vi.fn();
    const onClear = vi.fn();
    const onToggle = vi.fn();
    const options = [
      { id: "tutors", label: "Help independent tutors send parents a weekly recap" },
      { id: "skincare", label: "A subscription for refillable skincare" },
    ];
    const { rerender } = render(<ExampleToggle options={options} label="Try an example brief" onFill={onFill} onClear={onClear} onToggle={onToggle} />);
    const group = screen.getByRole("group", { name: "Try an example brief" });
    expect(group.textContent).toContain("Try an example brief");
    // No single button: the chips are the control.
    expect(screen.queryByRole("button", { name: "Show me an example" })).toBeNull();
    const skincare = screen.getByRole("button", { name: "A subscription for refillable skincare" });
    expect(skincare.getAttribute("aria-pressed")).toBe("false");
    await user.click(skincare);
    expect(onFill).toHaveBeenLastCalledWith("skincare");
    expect(onToggle).toHaveBeenLastCalledWith(true);
    expect(skincare.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-example-toggle]")?.getAttribute("data-shown")).toBe("true");
    // Another chip swaps the example without clearing first.
    await user.click(screen.getByRole("button", { name: /tutors/ }));
    expect(onFill).toHaveBeenLastCalledWith("tutors");
    expect(onClear).not.toHaveBeenCalled();
    expect(skincare.getAttribute("aria-pressed")).toBe("false");
    // The chosen chip again: out.
    await user.click(screen.getByRole("button", { name: /tutors/ }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(document.querySelector("[data-example-toggle]")?.hasAttribute("data-shown")).toBe(false);
    // Controlled: the owner decides which chip is pressed.
    rerender(<ExampleToggle options={options} label="Try an example brief" value="skincare" onFill={onFill} onClear={onClear} />);
    expect(screen.getByRole("button", { name: "A subscription for refillable skincare" }).getAttribute("aria-pressed")).toBe("true");
    rerender(<ExampleToggle options={options} label="Try an example brief" value={null} onFill={onFill} onClear={onClear} />);
    expect(screen.getByRole("button", { name: "A subscription for refillable skincare" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("disabled: nothing can be pressed, what is shown stays shown", async () => {
    render(<ExampleToggle shown disabled example="x" />);
    expect((screen.getByRole("button", { name: "Hide the example" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("[data-example]")).toBeTruthy();
    render(<ExampleToggle options={[{ id: "a", label: "An example" }]} disabled />);
    // A chip without a press is a plain chip, not a button.
    expect(screen.queryByRole("button", { name: "An example" })).toBeNull();
    expect(screen.getByText("An example")).toBeTruthy();
  });

  it("renders nothing, example included, when guidance is off", () => {
    const { container } = render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <ExampleToggle defaultShown example="x" />
        <ExampleToggle options={[{ id: "a", label: "An example" }]} defaultValue="a" example="y" />
      </GuidanceProvider>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("the frame is reusable on its own", () => {
    render(<ExampleFrame>body</ExampleFrame>);
    const frame = document.querySelector("[data-example]") as HTMLElement;
    for (const c of exampleFrameClass.split(" ")) expect(frame.className).toContain(c);
  });
});
