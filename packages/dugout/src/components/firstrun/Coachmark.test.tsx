import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { GuidanceProvider, type GuidanceState } from "../guidance/GuidanceProvider";
import { Callout, Coachmark, findCoachmarkTarget, isCoachmarkPaused, type CoachmarkStep } from "./Coachmark";

const steps: CoachmarkStep[] = [
  { targetId: "journey", title: "Your story on one line", body: "Revenue, customers and milestones on one time axis." },
  { targetId: "missing-panel", title: "Never shown", body: "This target is not on the page." },
  { targetId: "continue", title: "This is how you move forward", body: "Press it when you have answered what needs you." },
];

function Page({ value, actions, onDone, children }: { value?: Partial<GuidanceState>; actions?: { markTourDone?: (id: string) => void }; onDone?: (o: "done" | "skipped") => void; children?: React.ReactNode }) {
  return (
    <GuidanceProvider value={value} actions={actions}>
      <section id="journey">Journey</section>
      <button type="button" data-coachmark="continue">
        Continue
      </button>
      {children ?? <Coachmark tourId="home" steps={steps} onDone={onDone} />}
    </GuidanceProvider>
  );
}

const card = () => screen.getByRole("dialog", { name: /./ });

describe("Coachmark", () => {
  it("starts on the first step with a target, rings it, counts, skips a missing target, and marks the tour done at the end", async () => {
    const user = userEvent.setup();
    const markTourDone = vi.fn();
    const onDone = vi.fn();
    render(<Page actions={{ markTourDone }} onDone={onDone} />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(document.getElementById("journey")?.hasAttribute("data-coachmark-active")).toBe(true);
    expect(document.querySelector("[data-coachmark-ring]")).toBeTruthy();
    // Nothing modal: no backdrop, the page is not inert.
    expect(document.querySelector("[data-radix-popper-content-wrapper]")).toBeTruthy();
    expect(document.querySelector("[aria-hidden='true'][data-aria-hidden]")).toBeNull();
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Next" }));
    // The second step's target is missing, so the third shows next; the count still says where it is in the tour.
    await screen.findByRole("dialog", { name: "This is how you move forward" });
    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect(document.getElementById("journey")?.hasAttribute("data-coachmark-active")).toBe(false);
    expect(document.querySelector("[data-coachmark='continue']")?.hasAttribute("data-coachmark-active")).toBe(true);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(markTourDone).toHaveBeenCalledWith("home");
    expect(onDone).toHaveBeenCalledWith("done");
    expect(document.querySelector("[data-coachmark-active]")).toBeNull();
  });

  it("moves with the arrow keys and skips with Esc, marking the tour done", async () => {
    const user = userEvent.setup();
    const markTourDone = vi.fn();
    const onDone = vi.fn();
    render(<Page actions={{ markTourDone }} onDone={onDone} />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
    expect(document.activeElement).toBe(card());
    await user.keyboard("{ArrowRight}");
    await screen.findByRole("dialog", { name: "This is how you move forward" });
    await user.keyboard("{ArrowLeft}");
    await screen.findByRole("dialog", { name: "Your story on one line" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(markTourDone).toHaveBeenCalledWith("home");
    expect(onDone).toHaveBeenCalledWith("skipped");
  });

  it("Skip tour ends it without finishing", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<Page onDone={onDone} />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onDone).toHaveBeenCalledWith("skipped");
  });

  it("never starts when the tour is done, when guidance is off, or with autoStart off until open", async () => {
    const { unmount } = render(<Page value={{ toursDone: { home: true } }} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    const off = render(<Page value={{ guidance: "off" }} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    off.unmount();
    function Manual() {
      const [open, setOpen] = useState(false);
      return (
        <Page>
          <button type="button" onClick={() => setOpen(true)}>
            Replay the tour
          </button>
          <Coachmark tourId="home" steps={steps} autoStart={false} open={open} />
        </Page>
      );
    }
    render(<Manual />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Replay the tour" }));
    await screen.findByRole("dialog", { name: "Your story on one line" });
  });

  it("waits while something on the page asks tours to pause, and starts once it clears", async () => {
    function Paused() {
      const [busy, setBusy] = useState(true);
      return (
        <Page>
          {busy ? <div data-coachmark-pause="">Continue is processing</div> : null}
          <button type="button" onClick={() => setBusy(false)}>
            Finish processing
          </button>
          <Coachmark tourId="home" steps={steps} />
        </Page>
      );
    }
    render(<Paused />);
    expect(isCoachmarkPaused()).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Finish processing" }));
    await screen.findByRole("dialog", { name: "Your story on one line" });
  });

  it("waits while any dialog is open, and starts once it closes", async () => {
    function WithDialog() {
      const [open, setOpen] = useState(true);
      return (
        <Page>
          {open ? (
            <div role="dialog" aria-label="Rename dashboard">
              A dialog
            </div>
          ) : null}
          <button type="button" onClick={() => setOpen(false)}>
            Close the dialog
          </button>
          <Coachmark tourId="home" steps={steps} />
        </Page>
      );
    }
    render(<WithDialog />);
    expect(isCoachmarkPaused()).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog", { name: "Your story on one line" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close the dialog" }));
    await screen.findByRole("dialog", { name: "Your story on one line" });
  });

  it("never starts when none of its targets is on the page, and nothing breaks", async () => {
    render(
      <GuidanceProvider>
        <Coachmark tourId="nowhere" steps={[{ targetId: "no-such-target", title: "Never", body: "Never shown." }]} />
      </GuidanceProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-coachmark-ring]")).toBeNull();
  });

  it("moves on when the current target leaves the page", async () => {
    function Vanishing() {
      const [shown, setShown] = useState(true);
      return (
        <GuidanceProvider>
          {shown ? <section id="journey">Journey</section> : null}
          <button type="button" data-coachmark="continue" onClick={() => setShown(false)}>
            Continue
          </button>
          <Coachmark tourId="home" steps={steps} />
        </GuidanceProvider>
      );
    }
    render(<Vanishing />);
    await screen.findByRole("dialog", { name: "Your story on one line" });
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("dialog", { name: "This is how you move forward" });
  });

  it("finds a target by id or by data-coachmark", () => {
    render(
      <div>
        <p id="by-id">a</p>
        <p data-coachmark="by-attr">b</p>
      </div>,
    );
    expect(findCoachmarkTarget("by-id")?.textContent).toBe("a");
    expect(findCoachmarkTarget("by-attr")?.textContent).toBe("b");
    expect(findCoachmarkTarget("nowhere")).toBeNull();
  });
});

describe("Callout", () => {
  it("is one step with a Got it and no count, marking its tour done", async () => {
    const markTourDone = vi.fn();
    render(
      <GuidanceProvider actions={{ markTourDone }}>
        <button type="button" id="continue-button">
          Continue
        </button>
        <Callout tourId="first-continue" targetId="continue-button" title="This is how you move forward" body="Press it when you have answered what needs you." />
      </GuidanceProvider>,
    );
    await screen.findByRole("dialog", { name: "This is how you move forward" });
    expect(screen.queryByText(/of 1/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip tour" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(markTourDone).toHaveBeenCalledWith("first-continue");
  });
});
