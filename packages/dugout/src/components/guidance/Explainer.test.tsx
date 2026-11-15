import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EXPLAINER_LABELS, Explainer } from "./Explainer";
import { ExplainPageButton } from "./ExplainPageButton";
import { GuidanceProvider } from "./GuidanceProvider";
import { PageExplainProvider } from "./PageExplain";

const props = {
  screenId: "home",
  purpose: "Your business at a glance: what the team did and what it needs from you.",
  action: "Read the notes in the Inbox, then press Continue to run a cycle.",
  watchFor: "The runway tile turning amber.",
};

const BUTTON = /^Explain this page/;

function Page({ children, guidance }: { children?: React.ReactNode; guidance?: Parameters<typeof GuidanceProvider>[0] }) {
  return (
    <GuidanceProvider {...guidance}>
      <PageExplainProvider>
        <header>
          <ExplainPageButton />
        </header>
        <main>{children}</main>
      </PageExplainProvider>
    </GuidanceProvider>
  );
}

describe("Explainer with a page provider", () => {
  it("renders nothing in place and shows no button until a screen registers", () => {
    const { container } = render(
      <Page>
        <section data-testid="screen">
          <Explainer {...props} />
        </section>
      </Page>,
    );
    expect(screen.getByTestId("screen").textContent).toBe("");
    expect(container.querySelector("[data-explainer]")?.tagName).toBe("BUTTON");
    expect(screen.queryByText(EXPLAINER_LABELS.purpose)).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("has no button before any Explainer registers, and none again after it unmounts", () => {
    const { rerender } = render(<Page />);
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
    rerender(
      <Page>
        <Explainer {...props} />
      </Page>,
    );
    expect(screen.getByRole("button", { name: BUTTON })).toBeTruthy();
    rerender(<Page />);
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
  });

  it("draws a ghost, small button with the tour anchor, and opens the three labeled lines and Close", async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <Explainer {...props} />
      </Page>,
    );
    const button = screen.getByRole("button", { name: BUTTON });
    expect(button.getAttribute("data-variant")).toBe("ghost");
    expect(button.getAttribute("data-coachmark")).toBe("explainer");
    expect(button.getAttribute("data-explainer")).toBe("home");
    expect(button.textContent).toContain("Explain this page");
    expect(screen.queryByText(props.purpose)).toBeNull();
    await user.click(button);
    for (const label of Object.values(EXPLAINER_LABELS)) expect(screen.getByText(label).className).toContain("t-data");
    expect(screen.getByText(props.purpose)).toBeTruthy();
    expect(screen.getByText(props.action)).toBeTruthy();
    expect(screen.getByText(props.watchFor)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show me an example" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText(props.purpose)).toBeNull());
  });

  it("offers Show me an example when given, and calls the latest handler", async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Page>
        <Explainer {...props} onExample={first} />
      </Page>,
    );
    rerender(
      <Page>
        <Explainer {...props} onExample={second} />
      </Page>,
    );
    await user.click(screen.getByRole("button", { name: BUTTON }));
    await user.click(screen.getByRole("button", { name: "Show me an example" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("marks the screen seen when opened, never on its own, and the unread dot goes", async () => {
    const user = userEvent.setup();
    const markExplainerSeen = vi.fn();
    render(
      <Page guidance={{ actions: { markExplainerSeen } }}>
        <Explainer {...props} />
      </Page>,
    );
    const button = screen.getByRole("button", { name: "Explain this page (new)" });
    expect(screen.getByTestId("explain-unread-dot")).toBeTruthy();
    expect(markExplainerSeen).not.toHaveBeenCalled();
    expect(screen.queryByText(props.purpose)).toBeNull();
    await user.click(button);
    expect(markExplainerSeen).toHaveBeenCalledTimes(1);
    expect(markExplainerSeen).toHaveBeenCalledWith("home");
    expect(screen.queryByTestId("explain-unread-dot")).toBeNull();
    expect(screen.getByRole("button", { name: "Explain this page" })).toBeTruthy();
  });

  it("shows no dot for a screen already seen, and does not mark it again as unread", () => {
    render(
      <Page guidance={{ value: { explainersSeen: { home: true } } }}>
        <Explainer {...props} />
      </Page>,
    );
    expect(screen.getByRole("button", { name: "Explain this page" })).toBeTruthy();
    expect(screen.queryByTestId("explain-unread-dot")).toBeNull();
  });

  it("closes on Escape and gives the focus back to the button", async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <Explainer {...props} />
      </Page>,
    );
    const button = screen.getByRole("button", { name: BUTTON });
    await user.click(button);
    expect(screen.getByText(props.purpose)).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText(props.purpose)).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("opens from the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <Page>
        <Explainer {...props} />
      </Page>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: BUTTON }));
    await user.keyboard("{Enter}");
    expect(screen.getByText(props.watchFor)).toBeTruthy();
  });

  it("shows nothing with guidance off, and waits for the account's answer (F28)", () => {
    const { rerender } = render(
      <Page guidance={{ value: { guidance: "off" } }}>
        <Explainer {...props} />
      </Page>,
    );
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
    rerender(
      <Page guidance={{ value: { loaded: false } }}>
        <Explainer {...props} />
      </Page>,
    );
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
    rerender(
      <Page guidance={{ value: { loaded: true } }}>
        <Explainer {...props} />
      </Page>,
    );
    expect(screen.getByRole("button", { name: BUTTON })).toBeTruthy();
  });

  it("with two Explainers the last mounted wins, and the one below takes over when it unmounts", () => {
    const second = { ...props, screenId: "home/second", purpose: "The second screen." };
    const { rerender } = render(
      <Page>
        <Explainer {...props} />
        <Explainer {...second} />
      </Page>,
    );
    expect(screen.getAllByRole("button", { name: BUTTON })).toHaveLength(1);
    expect(screen.getByRole("button", { name: BUTTON }).getAttribute("data-explainer")).toBe("home/second");
    rerender(
      <Page>
        <Explainer {...props} />
      </Page>,
    );
    expect(screen.getByRole("button", { name: BUTTON }).getAttribute("data-explainer")).toBe("home");
  });
});

describe("Explainer without a page provider", () => {
  it("falls back to the same button in place, and opens the same panel", async () => {
    const user = userEvent.setup();
    const markExplainerSeen = vi.fn();
    render(
      <GuidanceProvider actions={{ markExplainerSeen }}>
        <Explainer {...props} className="mb-3" data-testid="inline" />
      </GuidanceProvider>,
    );
    expect(screen.getByTestId("inline").className).toContain("mb-3");
    await user.click(screen.getByRole("button", { name: BUTTON }));
    expect(screen.getByText(props.purpose)).toBeTruthy();
    expect(markExplainerSeen).toHaveBeenCalledWith("home");
    // No banner: nothing is a region or draws "Got it".
    expect(screen.queryByRole("button", { name: "Got it" })).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("is not rendered with guidance off", () => {
    render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <Explainer {...props} data-testid="inline" />
      </GuidanceProvider>,
    );
    expect(screen.getByTestId("inline").textContent).toBe("");
  });
});
