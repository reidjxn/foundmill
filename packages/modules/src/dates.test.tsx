import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DateFormatProvider } from "@foundmill/dugout";
import { DateText, RelativeDateText } from "./dates";
import { DAY_FIRST_24H, ISO_24H, usDatesIn } from "./dates.testing";

afterEach(() => cleanup());

const NOW = new Date(2026, 9, 7, 15, 45);

describe("DateText and RelativeDateText", () => {
  it("read US dates outside a provider", () => {
    render(<DateText value="2026-10-07" />);
    expect(screen.getByText("Oct 7, 2026")).toBeTruthy();
  });

  it("follow the person's date format, form by form", () => {
    render(
      <DateFormatProvider value={ISO_24H}>
        <DateText value="2026-10-07" />
        <DateText value={NOW} form="dateTime" />
        <DateText value="2026-10-07" form="monthYear" />
        <DateText value={null} fallback="Not yet" />
      </DateFormatProvider>,
    );
    expect(screen.getByText("2026-10-07")).toBeTruthy();
    expect(screen.getByText("2026-10-07 15:45")).toBeTruthy();
    expect(screen.getByText("2026-10")).toBeTruthy();
    expect(screen.getByText("Not yet")).toBeTruthy();
  });

  it("keep relative words and put the date in the person's format on hover", () => {
    const { container } = render(
      <DateFormatProvider value={DAY_FIRST_24H}>
        <RelativeDateText
          value={new Date(NOW.getTime() - 3 * 60_000)}
          now={NOW}
          titleForm="dateTime"
        />
      </DateFormatProvider>,
    );
    const el = screen.getByText("3 min ago");
    expect(el.getAttribute("title")).toBe("7 Oct 2026, 15:42");
    expect(usDatesIn(container)).toEqual([]);
  });

  it("usDatesIn finds US dates and 12-hour times in text and hover titles", () => {
    const { container } = render(
      <p>
        Due Oct 7 <span title="Wed, Oct 7, 2026, 3:45 PM">soon</span> · Oct 2026 · 7 Oct 2026
      </p>,
    );
    expect(usDatesIn(container).sort()).toEqual(["3:45 PM", "Oct 7"]);
  });
});
