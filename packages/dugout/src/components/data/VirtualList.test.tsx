import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { VirtualList, type VirtualListHandle } from "./VirtualList";

const items = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, label: `Row ${i}` }));

describe("VirtualList", () => {
  it("draws a short list whole and a long one only near the viewport, with spacers that hold the rest", () => {
    const short = render(<VirtualList items={items.slice(0, 20)} getKey={(r) => r.id} renderItem={(r) => <span>{r.label}</span>} />);
    expect(short.container.querySelectorAll("li[data-index]")).toHaveLength(20);
    expect(short.container.querySelector("[aria-hidden]")).toBeNull();
    short.unmount();

    const long = render(<VirtualList items={items} getKey={(r) => r.id} renderItem={(r, i, size) => <span data-pos={`${i + 1}/${size}`}>{r.label}</span>} estimateSize={50} fallbackHeight={400} overscan={2} />);
    const drawn = long.container.querySelectorAll("li[data-index]");
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(40);
    expect(long.getByText("Row 0").getAttribute("data-pos")).toBe("1/500");
    // The rows not drawn are still part of the scroll height: the end spacer carries them.
    const spacers = long.container.querySelectorAll<HTMLElement>("li[aria-hidden]");
    expect(spacers).toHaveLength(2);
    expect(parseFloat(spacers[1]!.style.height)).toBeGreaterThan(50 * 400);
  });

  it("scrollToIndex is safe for any index, drawn or not", () => {
    const ref = createRef<VirtualListHandle>();
    render(<VirtualList ref={ref} items={items} getKey={(r) => r.id} renderItem={(r) => <span>{r.label}</span>} />);
    expect(() => {
      ref.current?.scrollToIndex(400);
      ref.current?.scrollToIndex(-1);
      ref.current?.scrollToIndex(9_999);
    }).not.toThrow();
  });
});
