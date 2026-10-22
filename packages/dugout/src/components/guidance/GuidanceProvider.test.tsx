/**
 * GuidanceProvider: the value travels in two contexts (perf audit item 8). A "Got it", a finished tour or the
 * checklist's dismissal changes only the progress context, so the mode readers (Term, DataTable, PlainFigure) do not
 * render again; GuidanceTermsProvider replaces the map below it and keeps the rest.
 */
import { render, screen } from "@testing-library/react";
import { act, memo, useState } from "react";
import { describe, expect, it } from "vitest";
import { GuidanceProvider, GuidanceTermsProvider, useGuidance, useGuidanceMode, useGuidanceProgress, useGuided, useTerm, type GuidanceActions, type GuidanceState } from "./GuidanceProvider";

const TERMS = { runway: { id: "runway", word: "Runway", short: "How many months your cash lasts at today's spending." } };
const renders = { mode: 0, progress: 0 };

// Memoized, as a screen below the host is: only a context change renders them again.
const ModeReader = memo(function ModeReader() {
  renders.mode += 1;
  const { guidance, terms } = useGuidanceMode();
  return (
    <p data-testid="mode">
      {guidance} {terms.runway?.word ?? "?"}
    </p>
  );
});

const ProgressReader = memo(function ProgressReader() {
  renders.progress += 1;
  const { explainersSeen } = useGuidanceProgress();
  return <p data-testid="progress">{Object.keys(explainersSeen).join(",") || "-"}</p>;
});

let setState: (next: Partial<GuidanceState>) => void = () => undefined;
const actions: Partial<GuidanceActions> = { markExplainerSeen: () => undefined };

function Host() {
  const [value, set] = useState<Partial<GuidanceState>>({ guidance: "on", terms: TERMS, explainersSeen: {} });
  setState = (next) => set((prev) => ({ ...prev, ...next }));
  return (
    <GuidanceProvider value={value} actions={actions}>
      <ModeReader />
      <ProgressReader />
    </GuidanceProvider>
  );
}

describe("GuidanceProvider", () => {
  it("renders the mode readers again only when the mode changes, not on progress", () => {
    renders.mode = 0;
    renders.progress = 0;
    render(<Host />);
    expect(screen.getByTestId("mode").textContent).toBe("on Runway");
    expect(renders).toEqual({ mode: 1, progress: 1 });
    act(() => setState({ explainersSeen: { home: true } }));
    expect(screen.getByTestId("progress").textContent).toBe("home");
    expect(renders).toEqual({ mode: 1, progress: 2 });
    act(() => setState({ guidance: "off" }));
    expect(screen.getByTestId("mode").textContent).toBe("off Runway");
    expect(renders.mode).toBe(2);
  });

  it("useGuidance still hands the whole value, defaults outside a provider", () => {
    let seen: ReturnType<typeof useGuidance> | null = null;
    function Probe() {
      seen = useGuidance();
      return null;
    }
    render(<Probe />);
    expect(seen).toMatchObject({ guidance: "on", textSize: "standard", explainersSeen: {}, toursDone: {}, checklistDismissedAt: null, terms: {}, loaded: true });
    render(
      <GuidanceProvider value={{ guidance: "off", toursDone: { home: true }, loaded: false }}>
        <Probe />
      </GuidanceProvider>,
    );
    expect(seen).toMatchObject({ guidance: "off", toursDone: { home: true }, loaded: false });
  });

  it("GuidanceTermsProvider replaces the map below it and keeps the switch and the actions", () => {
    let mode: ReturnType<typeof useGuidanceMode> | null = null;
    function Probe() {
      mode = useGuidanceMode();
      const term = useTerm("runway");
      const guided = useGuided();
      return <p data-testid="probe">{`${guided} ${term?.word ?? "?"}`}</p>;
    }
    const markTourDone = () => undefined;
    render(
      <GuidanceProvider value={{ guidance: "off", terms: TERMS }} actions={{ markTourDone }}>
        <GuidanceTermsProvider terms={{ runway: { ...TERMS.runway, word: "Months of cash" } }}>
          <Probe />
        </GuidanceTermsProvider>
      </GuidanceProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("false Months of cash");
    expect(mode!.markTourDone).toBe(markTourDone);
  });
});
