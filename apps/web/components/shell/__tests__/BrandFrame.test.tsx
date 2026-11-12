// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import { MONOGRAM_HEIGHT, MONOGRAM_WIDTH } from "@foundmill/dugout/brand";
import { BrandFrame } from "../BrandFrame";

describe("BrandFrame (login and signed-out frames)", () => {
  it("leads with the wordmark and the tagline, and draws no FM monogram", () => {
    const { container } = render(
      <BrandFrame footer={<span>footer</span>}>
        <p>form</p>
      </BrandFrame>,
    );
    // The wordmark is the one image in the lock-up, named after the product (e2e/tests/smoke.spec.ts relies on that).
    const marks = screen.getAllByRole("img");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.getAttribute("aria-label")).toBe(APP_NAME);
    expect(marks[0]!.getAttribute("height")).toBe("28");
    expect(screen.getByText(APP_TAGLINE)).toBeTruthy();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(container.querySelector(`svg[viewBox="0 0 ${MONOGRAM_WIDTH} ${MONOGRAM_HEIGHT}"]`)).toBeNull();
    expect(container.querySelector("svg[data-variant]")).toBeNull();
    expect(screen.getByText("form")).toBeTruthy();
    expect(screen.getByText("footer")).toBeTruthy();
  });

  it("asks for a larger window below 1280 px instead of drawing an overflowing top bar (audit PAS-5)", () => {
    const before = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { value: 1279, configurable: true, writable: true });
      render(
        <BrandFrame >
          <p>body</p>
        </BrandFrame>,
      );
      expect(screen.getByTestId("needs-larger-window")).toBeTruthy();
      expect(screen.queryByText("body")).toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { value: before, configurable: true, writable: true });
    }
  });

  it("with smallScreen (the sign-in page) it renders at 390 px instead of asking for a larger window", () => {
    const before = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
      render(
        <BrandFrame smallScreen>
          <p>body</p>
        </BrandFrame>,
      );
      expect(screen.queryByTestId("needs-larger-window")).toBeNull();
      expect(screen.getByText("body")).toBeTruthy();
    } finally {
      Object.defineProperty(window, "innerWidth", { value: before, configurable: true, writable: true });
    }
  });
});
