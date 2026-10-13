// @vitest-environment happy-dom
/**
 * The settings Save row keeps keyboard focus through a save (A11Y-07): busy while saving, then "nothing to save" once
 * the form is clean, without ever turning into a disabled button that drops focus to <body>.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SaveBar } from "../shared";

vi.mock("@/lib/trpc", () => ({ errorMessage: (e: unknown) => String(e) }));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ isAdmin: true, data: { role: "owner" } }) }));

describe("SaveBar", () => {
  it("stays focused while saving and once there is nothing left to save, and refuses presses meanwhile", () => {
    const onSave = vi.fn();
    const { rerender } = render(<SaveBar onSave={onSave} />);
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    save.focus();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender(<SaveBar onSave={onSave} saving />);
    expect(document.activeElement).toBe(save);
    expect(save.disabled).toBe(false);
    expect(save.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender(<SaveBar onSave={onSave} disabled />);
    expect(document.activeElement).toBe(save);
    expect(save.disabled).toBe(false);
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
