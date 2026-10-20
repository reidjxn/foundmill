import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { ShellLinkProvider } from "../shell/ShellLink";
import { NextStep } from "./NextStep";
import type { NextStepItem } from "./nextSteps";

const three: NextStepItem[] = [
  { id: "read", label: "Read what the team drafted", href: "/vision", done: true },
  { id: "answer", label: "Answer the 2 notes in the Inbox", href: "/inbox" },
  { id: "go", label: "Press Continue", onGo: () => {} },
];

describe("NextStep", () => {
  it("renders the label, numbered rows, a check for a done row, and a Go for each row that has somewhere to go", () => {
    render(<NextStep steps={three} />);
    expect(screen.getByText("Next step")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    // The done row: a check, no Go, the label dimmed.
    expect(within(rows[0] as HTMLElement).getByRole("img", { name: "Done" })).toBeTruthy();
    expect(within(rows[0] as HTMLElement).queryByRole("link")).toBeNull();
    // The second row keeps its number and links.
    expect((rows[1] as HTMLElement).textContent).toContain("2");
    expect(within(rows[1] as HTMLElement).getByRole("link", { name: "Go: Answer the 2 notes in the Inbox" }).getAttribute("href")).toBe("/inbox");
    // The third row has an action, so it is a button.
    expect(within(rows[2] as HTMLElement).getByRole("button", { name: "Go: Press Continue" })).toBeTruthy();
  });

  it("links through the shell link renderer, so the app's router link is used", () => {
    const renderLink = vi.fn(({ href, children, className, "aria-label": label }) => (
      <a href={href} className={className} aria-label={label} data-router-link="">
        {children}
      </a>
    ));
    render(
      <ShellLinkProvider render={renderLink}>
        <NextStep steps={[{ id: "answer", label: "2 notes need your answer", href: "/inbox" }]} />
      </ShellLinkProvider>,
    );
    expect(renderLink).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Go: 2 notes need your answer" }).getAttribute("data-router-link")).toBe("");
  });

  it("is a single line with one row: no number, the label beside the title", () => {
    render(<NextStep steps={[{ id: "one", label: "Nothing waiting · press Continue when ready" }]} />);
    const strip = document.querySelector("[data-next-step]") as HTMLElement;
    expect(strip.getAttribute("data-rows")).toBe("1");
    expect(strip.className).toContain("flex-wrap");
    expect(screen.getByRole("listitem").textContent).toBe("Nothing waiting · press Continue when ready");
  });

  it("calls the step's action from Go", async () => {
    const onGo = vi.fn();
    render(<NextStep steps={[{ id: "go", label: "Press Continue", onGo }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Go: Press Continue" }));
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it("cuts the strip to three rows and accepts a title", () => {
    render(<NextStep title="Up next" steps={[...three, { id: "four", label: "A fourth" }]} />);
    expect(screen.getByText("Up next")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("renders nothing when guidance is off, or with no steps", () => {
    const { container, rerender } = render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <NextStep steps={three} />
      </GuidanceProvider>,
    );
    expect(container.innerHTML).toBe("");
    rerender(<NextStep steps={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
