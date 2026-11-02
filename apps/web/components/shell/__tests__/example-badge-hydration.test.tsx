import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExampleBadge } from "../BusinessShell";

describe("the Example chip hydrates without a mismatch", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("hydrates server markup with no React error, and the chip keeps its look after mount", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = renderToString(<ExampleBadge />);
    expect(html).toContain('data-testid="example-chip"');
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const before = host.querySelector('[data-testid="example-chip"]');
    await act(async () => {
      hydrateRoot(host, <ExampleBadge />);
    });
    expect(errors).not.toHaveBeenCalled();
    // The chip is still there after mount (the tooltip joined it), same text and classes, so nothing shifts.
    const after = host.querySelector('[data-testid="example-chip"]');
    expect(after?.className).toBe(before?.className);
    expect(host.textContent).toBe("Example");
  });
});
