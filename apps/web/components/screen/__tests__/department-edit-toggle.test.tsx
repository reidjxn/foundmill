// @vitest-environment happy-dom
/**
 * The department widget-layout editor: its Edit toggle shows the E key cap only with guidance off (DESIGN §5.9, §7.7,
 * as Home does) and always names the shortcut for assistive tech; and only people who may change things get the
 * editor at all (viewers, advisors and example viewers would only meet the server's refusal on save).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuidanceProvider } from "@foundmill/dugout";
import "@foundmill/modules";
import { canEditLayout, EditToggle } from "../DepartmentScreen";

afterEach(cleanup);

const renderToggle = (guidance: "on" | "off", editing = false, onToggle = () => {}) =>
  render(
    <GuidanceProvider value={{ guidance }}>
      <EditToggle editing={editing} onToggle={onToggle} />
    </GuidanceProvider>,
  );

describe("department Edit toggle", () => {
  it("hides the E key cap while guidance is on and keeps aria-keyshortcuts", () => {
    renderToggle("on");
    const button = screen.getByTestId("edit-layout");
    expect(button.querySelector("kbd")).toBeNull();
    expect(button.getAttribute("aria-keyshortcuts")).toBe("E");
    expect(button.textContent).toBe("Edit");
  });

  it("shows the E key cap with guidance off", () => {
    const onToggle = vi.fn();
    renderToggle("off", true, onToggle);
    const button = screen.getByTestId("edit-layout");
    expect(button.querySelector("kbd")?.textContent).toBe("E");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("canEditLayout", () => {
  const base = { hasScreen: true, isModuleScreen: false, modulePending: false };
  it("offers the editor on a widget layout to someone who may change things", () => {
    expect(canEditLayout({ ...base, access: { canChange: true } })).toBe(true);
  });
  it("never offers it to viewers, advisors or example viewers", () => {
    expect(canEditLayout({ ...base, access: { canChange: false } })).toBe(false);
  });
  it("never offers it on a module screen, a pending module or a missing screen", () => {
    expect(canEditLayout({ ...base, isModuleScreen: true, access: { canChange: true } })).toBe(false);
    expect(canEditLayout({ ...base, modulePending: true, access: { canChange: true } })).toBe(false);
    expect(canEditLayout({ ...base, hasScreen: false, access: { canChange: true } })).toBe(false);
  });
});
