import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { founderTaskOf, type FounderTaskFacts } from "@foundmill/shared/founder-task";
import { FounderTaskPanel } from "./FounderTaskPanel";

afterEach(cleanup);

const facts: FounderTaskFacts = { pagePublished: true, pageShared: false, planNoteOpen: true, outsideSignal: false, projectName: "Northwood", pitch: "Candles", url: "https://foundmill.test/p/northwood", overnight: true };

describe("FounderTaskPanel", () => {
  it("names the one thing, its reason and one button, then what happens next under a rule", () => {
    const onAction = vi.fn();
    const task = founderTaskOf(facts)!;
    render(<FounderTaskPanel task={task} onAction={onAction} />);
    expect(screen.getByText("Your one thing today")).toBeTruthy();
    expect(screen.getByTestId("founder-task-title").textContent).toBe("Send your page to three people");
    expect(screen.getByText(/What they say shapes what your team does next/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Share my page" }));
    expect(onAction).toHaveBeenCalledWith(task);
    expect(screen.getByTestId("founder-task-tomorrow").textContent).toBe("Tomorrow morning: what your team found overnight, and one thing to do.");
    expect(screen.getByTestId("founder-task").getAttribute("data-task")).toBe("share_page");
  });

  it("once a task is done today: Done for today, the next one named for tomorrow, no button", () => {
    render(<FounderTaskPanel task={founderTaskOf({ ...facts, overnight: false, doneToday: ["publish_page"] })!} />);
    expect(screen.getByTestId("founder-task-done").textContent).toBe("Done for today.");
    expect(screen.getByTestId("founder-task-next").textContent).toBe("Tomorrow: Send your page to three people");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("founder-task-tomorrow").textContent).toMatch(/^Come back when you have heard from someone/);
  });

  it("says what the button did, politely", () => {
    render(<FounderTaskPanel task={founderTaskOf({ ...facts, pageShared: true, planNoteOpen: false })!} status="Message copied" />);
    expect(screen.getByRole("status").textContent).toBe("Message copied");
  });
});
