import { describe, expect, it } from "vitest";
import { toastDuration } from "./Toast";

describe("toastDuration (WP-10 T12)", () => {
  it("keeps a warning or an error until it is dismissed", () => {
    expect(toastDuration({ tone: "warn" }, 5000)).toBe(Infinity);
    expect(toastDuration({ tone: "bad" }, 5000)).toBe(Infinity);
  });
  it("keeps a toast with an action until it is dismissed", () => {
    expect(toastDuration({ tone: "good", action: { label: "Undo", onClick: () => undefined } }, 5000)).toBe(Infinity);
  });
  it("times out the rest at the provider's default, and a toast's own duration always wins", () => {
    expect(toastDuration({ tone: "good" }, 5000)).toBe(5000);
    expect(toastDuration({}, 5000)).toBe(5000);
    expect(toastDuration({ tone: "bad", duration: 8000 }, 5000)).toBe(8000);
  });
});
