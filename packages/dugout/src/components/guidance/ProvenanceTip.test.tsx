import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { PROVENANCE_SENTENCE, ProvenanceChip } from "../foundation/Chip";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../foundation/Dialog";
import { GuidanceProvider } from "./GuidanceProvider";
import { FIXTURE_TERMS } from "./fixtures";
import { resetKeyboardFocus } from "./keyboardFocus";

/** A dialog whose first focusable is the chip: Radix auto-focuses it when the dialog opens. */
function ChipDialog({ terms }: { terms?: typeof FIXTURE_TERMS }) {
  const body = (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button">Open the plan</button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Plan</DialogTitle>
        <DialogDescription>
          Runway 7 months <ProvenanceChip kind="estimate" />
        </DialogDescription>
        <button type="button">Confirm</button>
      </DialogContent>
    </Dialog>
  );
  return terms ? <GuidanceProvider value={{ terms }}>{body}</GuidanceProvider> : body;
}

beforeEach(resetKeyboardFocus);

describe("ProvenanceChip's explanation (finding D3: a native title became a real tooltip)", () => {
  it("is a focusable word whose meaning opens as a tooltip on focus, without a native title", async () => {
    const user = userEvent.setup();
    render(<ProvenanceChip kind="forecast" />);
    const chip = screen.getByRole("button", { name: "Forecast" });
    expect(chip.getAttribute("title")).toBeNull();
    expect(chip.className).toContain("est-chip");
    await user.tab();
    expect(document.activeElement).toBe(chip);
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toBe(PROVENANCE_SENTENCE.forecast);
  });

  it("opens the definition card with Learn more when the definitions map holds the kind, even with guidance off", async () => {
    const user = userEvent.setup();
    render(
      <GuidanceProvider value={{ guidance: "off", terms: FIXTURE_TERMS }}>
        <ProvenanceChip kind="estimate" appearance="word" />
      </GuidanceProvider>,
    );
    const word = screen.getByRole("button", { name: "Estimate" });
    expect(word.className).toContain("text-tertiary");
    await user.hover(word);
    await screen.findByText(FIXTURE_TERMS.estimate!.short, {}, { timeout: 2000 });
    expect(screen.getByRole("link", { name: "Learn more" }).getAttribute("href")).toBe("/settings/integrations");
  });

  it("stays closed when a dialog's auto-focus lands on it, so the first Escape closes the dialog; Tab still opens it", async () => {
    const user = userEvent.setup();
    render(<ChipDialog />);
    await user.click(screen.getByRole("button", { name: "Open the plan" }));
    const dialog = await screen.findByRole("dialog");
    const chip = screen.getByRole("button", { name: "Estimate" });
    await waitFor(() => expect(document.activeElement).toBe(chip));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("tooltip")).toBeNull();
    // The person moves focus with the keyboard: the tooltip opens as before.
    await user.tab();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(chip);
    await screen.findByRole("tooltip");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    expect(screen.getByRole("dialog")).toBe(dialog);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opened with Enter, the dialog's auto-focus still does not open the definition card, and one Escape closes the dialog", async () => {
    const user = userEvent.setup();
    render(<ChipDialog terms={FIXTURE_TERMS} />);
    screen.getByRole("button", { name: "Open the plan" }).focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog");
    const chip = screen.getByRole("button", { name: "Estimate" });
    await waitFor(() => expect(document.activeElement).toBe(chip));
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText(FIXTURE_TERMS.estimate!.short)).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a script's focus never opens it (focus handed back after a close); a key that moves focus does", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before</button>
        <ProvenanceChip kind="estimate" />
      </>,
    );
    const chip = screen.getByRole("button", { name: "Estimate" });
    act(() => chip.focus());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("tooltip")).toBeNull();
    screen.getByRole("button", { name: "Before" }).focus();
    await user.tab();
    expect(document.activeElement).toBe(chip);
    await screen.findByRole("tooltip");
  });

  it("renders the chip on the server (the tooltip is the client piece)", () => {
    const html = renderToStaticMarkup(<ProvenanceChip kind="estimate" />);
    expect(html).toContain("est-chip");
    expect(html).toContain("Estimate");
    expect(html).not.toContain("title=");
  });
});
