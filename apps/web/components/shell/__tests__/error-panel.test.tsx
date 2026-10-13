// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorPanel } from "../ErrorPanel";

describe("ErrorPanel", () => {
  it("a section the person may not open is a plain 'No access' state with no Try again (audit RUI-05)", () => {
    const onRetry = vi.fn();
    render(<ErrorPanel title="Finance" message="No access to Finance. Ask an owner or admin if you need it." onRetry={onRetry} />);
    expect(screen.getByTestId("no-access-panel")).toBeTruthy();
    expect(screen.getByText("No access to Finance")).toBeTruthy();
    expect(screen.getByText("Ask an owner or admin if you need it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(screen.queryByTestId("error-panel")).toBeNull();
  });

  it("any other failure keeps its Try again", () => {
    const onRetry = vi.fn();
    render(<ErrorPanel title="Inbox" message="Internal server error" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
