import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { useState } from "react";
import type { DateFormatPrefs } from "../../lib/date-preferences";
import { DateFormatPicker } from "./DateFormatPicker";
import { DateFormatProvider, useDateFormat, useFormatters } from "./DateFormatProvider";

const at = new Date(2026, 9, 7, 15, 45);

function Sample() {
  const { formatDate, formatDateShort, formatTime, formatDateTime, formatRange, formatHourOfDay } = useFormatters();
  const prefs = useDateFormat();
  return (
    <p data-testid="sample" data-prefs={`${prefs.date}.${prefs.time}`}>
      {[formatDate(at), formatDateShort(at), formatTime(at), formatDateTime(at), formatRange(new Date(2026, 9, 7), new Date(2026, 9, 21)), formatHourOfDay(15)].join(" | ")}
    </p>
  );
}

describe("DateFormatProvider", () => {
  it("reads US dates and 12-hour times outside a provider", () => {
    render(<Sample />);
    expect(screen.getByTestId("sample").textContent).toBe("Oct 7, 2026 | Oct 7 | 3:45 PM | Oct 7, 2026, 3:45 PM | Oct 7 – 21 | 3 PM");
  });

  it("hands the person's choice to every helper", () => {
    render(
      <DateFormatProvider value={{ date: "day_first", time: "24h" }}>
        <Sample />
      </DateFormatProvider>,
    );
    expect(screen.getByTestId("sample").textContent).toBe("7 Oct 2026 | 7 Oct | 15:45 | 7 Oct 2026, 15:45 | 7 – 21 Oct | 15:00");
  });

  it("renders the same on the server as on the first client render (no hydration mismatch)", () => {
    const tree = (
      <DateFormatProvider value={{ date: "iso", time: "24h" }}>
        <Sample />
      </DateFormatProvider>
    );
    const html = renderToString(tree);
    expect(html).toContain("2026-10-07 | 10-07 | 15:45 | 2026-10-07 15:45 | 10-07 – 10-21 | 15:00");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(tree, { container, hydrate: true });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    container.remove();
  });

  it("updates every date below it when the choice changes, without a remount", () => {
    let set: (p: DateFormatPrefs) => void = () => undefined;
    function Host() {
      const [prefs, setPrefs] = useState<DateFormatPrefs>({ date: "us", time: "12h" });
      set = setPrefs;
      return (
        <DateFormatProvider value={prefs}>
          <Sample />
        </DateFormatProvider>
      );
    }
    render(<Host />);
    const node = screen.getByTestId("sample");
    expect(node.dataset.prefs).toBe("us.12h");
    act(() => set({ date: "day_first", time: "24h" }));
    expect(screen.getByTestId("sample")).toBe(node);
    expect(node.dataset.prefs).toBe("day_first.24h");
    expect(node.textContent).toContain("7 Oct 2026, 15:45");
  });

  it("treats an unknown or partial value as the default for what is missing", () => {
    render(
      <DateFormatProvider value={{ date: "iso" }}>
        <Sample />
      </DateFormatProvider>,
    );
    expect(screen.getByTestId("sample").dataset.prefs).toBe("iso.12h");
  });
});

describe("DateFormatPicker", () => {
  function Controlled({ onChange }: { onChange: (p: DateFormatPrefs) => void }) {
    const [value, setValue] = useState<DateFormatPrefs>({ date: "us", time: "12h" });
    return (
      <DateFormatPicker
        now={at}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    );
  }

  it("shows each choice on a real moment and reports the whole new choice", async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const us = screen.getByRole("radio", { name: "US" });
    expect(us.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("date-format-day_first").textContent).toContain("7 Oct 2026");
    expect(screen.getByTestId("date-format-iso").textContent).toContain("2026-10-07");
    expect(screen.getByTestId("time-format-24h").textContent).toContain("15:45");

    await userEvent.click(screen.getByRole("radio", { name: "Day first" }));
    expect(onChange).toHaveBeenLastCalledWith({ date: "day_first", time: "12h" });
    await userEvent.click(screen.getByRole("radio", { name: "24-hour" }));
    expect(onChange).toHaveBeenLastCalledWith({ date: "day_first", time: "24h" });
    // The time cards show the time next to the chosen date format.
    expect(screen.getByTestId("time-format-24h").textContent).toContain("7 Oct 2026, 15:45");
    expect(screen.getByRole("radiogroup", { name: "Date format" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Time format" })).toBeTruthy();
  });
});
