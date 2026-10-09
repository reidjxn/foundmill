import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BusinessLogo, logoInitials, logoRadius } from "./BusinessLogo";
import { SAMPLE_LOGOS } from "./logo-samples";

describe("BusinessLogo", () => {
  it("renders a stored logo as an <img> of its data URL, named for the business", () => {
    render(<BusinessLogo src={SAMPLE_LOGOS.orbit} name="Ledgerly" primary="#1f6f5f" size={48} />);
    const logo = screen.getByRole("img", { name: "Ledgerly logo" });
    expect(logo.getAttribute("data-logo")).toBe("image");
    const img = logo.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(SAMPLE_LOGOS.orbit);
    expect(img.getAttribute("alt")).toBe("");
    expect(logo.querySelector("svg")).toBeNull();
    expect(logo.style.width).toBe("48px");
  });

  it("draws the neutral initials mark without a logo: a rounded square in the primary with on-primary letters", () => {
    render(<BusinessLogo name="Northwind Skincare" primary="#2b6cb0" size={96} />);
    const logo = screen.getByRole("img", { name: "Northwind Skincare logo" });
    expect(logo.getAttribute("data-logo")).toBe("initials");
    expect(logo.querySelector("img")).toBeNull();
    expect(logo.querySelector("rect")!.getAttribute("fill")).toBe("#2b6cb0");
    const text = logo.querySelector("text")!;
    expect(text.textContent).toBe("NS");
    expect(text.getAttribute("fill")).toBe("#FFFFFF");
    expect(logo.style.borderRadius).toBe("19px");
  });

  it("picks near-black letters on a light primary and honours a monogram", () => {
    render(<BusinessLogo name="Aurora Candles" primary="#f5b841" monogram="a" />);
    const text = screen.getByRole("img", { name: "Aurora Candles logo" }).querySelector("text")!;
    expect(text.textContent).toBe("A");
    expect(text.getAttribute("fill")).toBe("#0F1318");
  });

  it("never renders anything but a logo data URL: other sources fall back to the initials mark", () => {
    for (const src of ["https://evil.example/logo.png", "javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "data:image/svg+xml,<svg onload=alert(1)>", "blob:https://x/1"]) {
      const html = renderToStaticMarkup(<BusinessLogo src={src} name="Evil" primary="#000000" />);
      expect(html).not.toContain("<img");
      expect(html).toContain('data-logo="initials"');
    }
  });

  it("can be decorative and is pure (renders on the server, no shield path)", () => {
    const html = renderToStaticMarkup(<BusinessLogo name="Ledgerly" primary="#1f6f5f" title="" size={20} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
    expect(html).not.toMatch(/<path/);
  });

  it("radius and initials helpers", () => {
    expect([20, 32, 96].map(logoRadius)).toEqual([4, 6, 19]);
    expect(logoRadius(10)).toBe(3);
    expect(logoInitials("")).toBe("·");
    expect(logoInitials("ledgerly")).toBe("LE");
    expect(logoInitials("x", "abc")).toBe("AB");
  });
});
