/**
 * A tour's product signal: `Tour` (stamps, the Coachmark and `useTourDone`) tells the host how the tour ended, with a
 * fake signal in place of GuidanceHost's: completed with the steps it could show, skipped with the step the founder
 * left on. The pure parts (`tourSignal`, `readTourStep`) are tested on their own. Fire and forget: a signal that throws
 * never stops the tour from closing.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidanceProvider } from "@foundmill/dugout";
import { GuidanceSignalProvider, type GuidanceSignalFn } from "@/components/providers/GuidanceHost";
import { HOME_TOUR } from "../definitions";
import { readTourStep, tourSignal } from "../signal";
import { Tour } from "../Tour";

/** Home as the tour sees it (as in tours.test.tsx). */
function HomeStandIn({ children, card = true }: { children?: React.ReactNode; card?: boolean }) {
  return (
    <>
      <nav aria-label="Primary" data-coachmark="sidebar">
        Sidebar
      </nav>
      <button type="button" data-coachmark="continue">
        Continue
      </button>
      <div role="status" data-coachmark="processing-strip" />
      <section data-widget="status_strip">Status</section>
      {card ? <section data-widget="department_card">Product</section> : null}
      {children}
    </>
  );
}

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

function mountTour(signal: GuidanceSignalFn, opts: { card?: boolean; onDone?: () => void } = {}) {
  const markTourDone = vi.fn();
  render(
    <GuidanceProvider actions={{ markTourDone }}>
      <GuidanceSignalProvider value={signal}>
        <HomeStandIn card={opts.card}>
          <Tour tour={HOME_TOUR} onDone={opts.onDone} />
        </HomeStandIn>
      </GuidanceSignalProvider>
    </GuidanceProvider>,
  );
  return markTourDone;
}

describe("Tour signals", () => {
  it("a finished tour sends tour_completed with the steps it showed, after marking itself done", async () => {
    const signal = vi.fn<GuidanceSignalFn>();
    const onDone = vi.fn();
    const markTourDone = mountTour(signal, { onDone });
    await screen.findByRole("dialog", { name: "Your areas" });
    for (const title of ["Continue", "The working light", "The status strip", "A department card"]) {
      click("Next");
      await screen.findByRole("dialog", { name: title });
    }
    expect(signal).not.toHaveBeenCalled();
    click("Done");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(markTourDone).toHaveBeenCalledWith("home");
    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal).toHaveBeenCalledWith("guidance.tour_completed", { tourId: "home", steps: 5 });
    expect(onDone).toHaveBeenCalledWith("done");
  });

  it("a tour with a step missing its target counts only the steps it could show", async () => {
    const signal = vi.fn<GuidanceSignalFn>();
    mountTour(signal, { card: false });
    await screen.findByRole("dialog", { name: "Your areas" });
    for (const title of ["Continue", "The working light", "The status strip"]) {
      click("Next");
      await screen.findByRole("dialog", { name: title });
    }
    click("Done");
    await waitFor(() => expect(signal).toHaveBeenCalledWith("guidance.tour_completed", { tourId: "home", steps: 4 }));
  });

  it("Skip tour sends tour_skipped with the step the founder left on", async () => {
    const signal = vi.fn<GuidanceSignalFn>();
    mountTour(signal);
    await screen.findByRole("dialog", { name: "Your areas" });
    click("Next");
    await screen.findByRole("dialog", { name: "Continue" });
    click("Skip tour");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(signal).toHaveBeenCalledWith("guidance.tour_skipped", { tourId: "home", atStep: 2, steps: 5 });
  });

  it("a signal that throws never keeps the tour open", async () => {
    const signal = vi.fn<GuidanceSignalFn>(() => {
      throw new Error("offline");
    });
    const onDone = vi.fn();
    mountTour(signal, { onDone });
    await screen.findByRole("dialog", { name: "Your areas" });
    click("Skip tour");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onDone).toHaveBeenCalledWith("skipped");
  });
});

describe("tour signal helpers", () => {
  it("tourSignal: completed with the steps shown, skipped with the step reached; bounded to 1–20", () => {
    expect(tourSignal("home", "done", 5, 5)).toEqual({ kind: "guidance.tour_completed", payload: { tourId: "home", steps: 5 } });
    expect(tourSignal("inbox", "skipped", 2, 4)).toEqual({ kind: "guidance.tour_skipped", payload: { tourId: "inbox", atStep: 2, steps: 4 } });
    // The step reached is never more than the steps counted, and nothing read counts as the first step.
    expect(tourSignal("inbox", "skipped", 4, 2)).toEqual({ kind: "guidance.tour_skipped", payload: { tourId: "inbox", atStep: 4, steps: 4 } });
    expect(tourSignal("example-start", "done", null, 0)).toEqual({ kind: "guidance.tour_completed", payload: { tourId: "example-start", steps: 1 } });
    expect(tourSignal("home", "skipped", 99, 99).payload).toEqual({ tourId: "home", atStep: 20, steps: 20 });
  });

  it("readTourStep: the card's data-step for that tour, or null", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div data-coachmark="" data-tour="inbox" data-step="3"></div><div data-coachmark="" data-tour="home"></div>';
    expect(readTourStep("inbox", root)).toBe(3);
    expect(readTourStep("home", root)).toBeNull();
    expect(readTourStep("department", root)).toBeNull();
  });
});
