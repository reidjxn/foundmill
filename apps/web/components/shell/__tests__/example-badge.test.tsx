/**
 * The Example chip beside the business name sits inside the business switcher's <button>. It must add no <button> of
 * its own (button in button is invalid HTML and logged as a hydration mismatch), and render the same markup on the
 * server and on the first client render.
 */
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({ default: () => () => null }));

const { ExampleBadge } = await import("../BusinessShell");

describe("ExampleBadge", () => {
  it("renders no button, so it can sit inside the switcher's button", () => {
    const html = renderToString(
      <button type="button">
        <ExampleBadge />
      </button>,
    );
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('data-testid="example-chip"');
    expect(html).toContain("Example");
  });

  it("matches the server markup on the first client render", () => {
    const server = renderToString(<ExampleBadge />);
    const { container } = render(<ExampleBadge />);
    expect(container.innerHTML).toBe(server);
  });
});
