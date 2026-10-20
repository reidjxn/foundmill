import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { ExampleFrame, ExampleToggle, exampleFrameClass } from "./ExampleToggle";

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
    expect(frame.querySelector("[data-chip]")?.textContent).toBe("Example");
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

  it("renders nothing, example included, when guidance is off", () => {
    const { container } = render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <ExampleToggle defaultShown example="x" />
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
